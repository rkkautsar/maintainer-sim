import { installationCandidates, startCandidate } from "../onboarding.ts";
import { DurableObject } from "cloudflare:workers";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { validSignature } from "../security.ts";
import { Game } from "../game.ts";
import { GitHub } from "../github.ts";
import { initialRun } from "../engine.ts";
import { CloudStore } from "./store.ts";
import { CloudJudge } from "./budget.ts";
import type { Env } from "./env.ts";
export { AIBudget } from "./budget.ts";
const events = new Set([
  "installation",
  "installation_repositories",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
  "issues",
  "push",
]);
async function limitedBody(request: Request, max = 1000000) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
function authorized(request: Request, token: string) {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get("Authorization") ?? "";
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256")
      .update("Bearer " + token)
      .digest(),
  );
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET")
        return new Response("ok");
      if (url.pathname === "/webhooks" && request.method === "POST") {
        const raw = await limitedBody(request);
        if (
          !validSignature(
            raw,
            request.headers.get("x-hub-signature-256") ?? undefined,
            env.WEBHOOK_SECRET,
          )
        )
          return new Response(null, { status: 401 });
        const id = request.headers.get("x-github-delivery"),
          event = request.headers.get("x-github-event");
        if (!id || id.length > 100 || !event)
          return new Response(null, { status: 400 });
        const payload = JSON.parse(raw.toString());
        if (
          !events.has(event) ||
          !Number.isSafeInteger(payload.installation?.id)
        )
          return new Response(null, { status: 202 });
        const object = env.GAMES.get(
          env.GAMES.idFromName(String(payload.installation.id)),
        );
        return await object.fetch("https://game/enqueue", {
          method: "POST",
          body: JSON.stringify({ id, event, payload }),
        });
      }
      if (url.pathname.startsWith("/admin/")) {
        if (!authorized(request, env.ADMIN_TOKEN))
          return new Response(null, { status: 401 });
        if (url.pathname === "/admin/status" && request.method === "GET") {
          const installation = Number(url.searchParams.get("installation"));
          if (!Number.isSafeInteger(installation) || installation <= 0)
            return new Response(null, { status: 400 });
          return env.GAMES.get(
            env.GAMES.idFromName(String(installation)),
          ).fetch("https://game/status");
        }
        if (
          request.method === "POST" &&
          ["/admin/seed", "/admin/retry", "/admin/resume"].includes(
            url.pathname,
          )
        ) {
          const input = JSON.parse(
            (await limitedBody(request, 16000)).toString(),
          );
          if (
            !Number.isSafeInteger(input.installation) ||
            input.installation <= 0
          )
            return new Response(null, { status: 400 });
          return env.GAMES.get(
            env.GAMES.idFromName(String(input.installation)),
          ).fetch("https://game/" + url.pathname.split("/").at(-1), {
            method: "POST",
            body: JSON.stringify(input),
          });
        }
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return new Response(
        error instanceof SyntaxError
          ? "Invalid JSON"
          : "Temporarily unavailable",
        { status: error instanceof SyntaxError ? 400 : 503 },
      );
    }
  },
} satisfies ExportedHandler<Env>;

// One object per installation also receives installation-wide removal events.
// Only alarm() mutates game state asynchronously; ingress only persists jobs.
export class GameSession extends DurableObject<Env> {
  store: CloudStore;
  game: Game;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new CloudStore(ctx.storage.sql);
    this.game = new Game(
      this.store,
      (r) =>
        GitHub.fromKey(
          r.installation,
          r.repository,
          env.GITHUB_APP_ID,
          env.GITHUB_PRIVATE_KEY,
        ),
      new CloudJudge(env),
      env.JEV_CALIBRATED === "true",
    );
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/status") return Response.json(this.store.all());
    const input = (await request.json()) as any;
    if (path === "/seed") {
      if (
        input.confirmDisposable !== true ||
        ![input.repository, input.player].every(
          (x) => Number.isSafeInteger(x) && x > 0,
        ) ||
        ![input.owner, input.repo].every(
          (x) =>
            typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(x),
        )
      )
        return new Response(
          "Invalid target or missing disposable-repository confirmation",
          { status: 400 },
        );
      if (this.store.all().some((r) => r.repository === input.repository))
        return new Response(
          "Repository already has a run; retry or use a fresh repository",
          { status: 409 },
        );
      await this.ctx.storage.setAlarm(Date.now() + 100);
      const run = initialRun({
        id: randomUUID(),
        installation: input.installation,
        repository: input.repository,
        owner: input.owner,
        repo: input.repo,
        player: input.player,
      });
      let duplicate = false;
      this.ctx.storage.transactionSync(() => {
        if (this.store.all().some((r) => r.repository === input.repository)) {
          duplicate = true;
          return;
        }
        this.store.save(run);
        this.store.enqueue(
          "seed:" + run.id,
          "seed",
          JSON.stringify({ id: run.id }),
        );
      });
      if (duplicate)
        return new Response("Repository already has a run", { status: 409 });
      return Response.json(
        { runId: run.id, status: "queued" },
        { status: 202 },
      );
    }
    if (path === "/resume") {
      if (!Number.isSafeInteger(input.repository) || input.repository <= 0)
        return new Response("Invalid repository", { status: 400 });
      const run = this.store
        .all()
        .find((r) => r.repository === input.repository);
      if (!run || run.phase !== "paused")
        return new Response("No paused run for repository", { status: 409 });
      try {
        await this.game.resume(run);
      } catch {
        return new Response("Run could not be verified; remains paused", {
          status: 409,
        });
      }
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return Response.json({ status: "active", runId: run.id });
    }
    if (path === "/retry") {
      this.store.db
        .prepare(
          "UPDATE deliveries SET status='pending',attempts=0,next=0 WHERE status='failed'",
        )
        .run();
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return Response.json({ status: "queued" });
    }
    if (path === "/enqueue") {
      const candidates = installationCandidates(input.event, input.payload);
      if (candidates.length) {
        await this.ctx.storage.setAlarm(Date.now() + 100);
        for (const candidate of candidates)
          this.store.enqueue(
            "auto-start:" + candidate.repository + ":" + input.id,
            "auto-start",
            JSON.stringify(candidate),
          );
      }
      // Installation events can bootstrap a run; unrelated repository events cannot.
      if (!this.store.all().length) return new Response(null, { status: 202 });
      if (
        input.payload.repository &&
        !this.store
          .all()
          .some((r) => r.repository === input.payload.repository.id)
      )
        return new Response(null, { status: 202 });
      await this.ctx.storage.setAlarm(Date.now() + 100);
      this.store.enqueue(input.id, input.event, JSON.stringify(input.payload));
      return new Response(null, { status: 202 });
    }
    return new Response(null, { status: 404 });
  }
  async alarm() {
    const row = this.store.db
      .prepare(
        "SELECT * FROM deliveries WHERE status='pending' AND next<=? ORDER BY rowid LIMIT 1",
      )
      .get(Date.now());
    try {
      if (row) {
        try {
          if (row.event === "auto-start") {
            await startCandidate(this.game, JSON.parse(row.body));
          } else if (row.event === "seed") {
            const run = this.store.get(JSON.parse(row.body).id);
            if (run.phase === "seeding") await this.game.seed(run);
          } else await this.game.process(row.event, JSON.parse(row.body));
          this.store.db
            .prepare("UPDATE deliveries SET status='done' WHERE id=?")
            .run(row.id);
        } catch {
          const attempts = row.attempts + 1;
          this.store.db
            .prepare(
              "UPDATE deliveries SET attempts=?,next=?,status=? WHERE id=?",
            )
            .run(
              attempts,
              Date.now() + Math.min(60000, 1000 * 2 ** attempts),
              attempts >= 5 ? "failed" : "pending",
              row.id,
            );
        }
      } else {
        for (const r of this.store.all())
          if (["active", "finishing", "paused"].includes(r.phase))
            this.store.enqueue(
              "reconcile:" + r.id + ":" + Math.floor(Date.now() / 600000),
              "push",
              JSON.stringify({
                installation: { id: r.installation },
                repository: { id: r.repository },
              }),
            );
      }
    } finally {
      const pending = this.store.db
        .prepare(
          "SELECT MIN(next) AS due FROM deliveries WHERE status='pending'",
        )
        .get();
      if (pending?.due !== null && pending?.due !== undefined)
        await this.ctx.storage.setAlarm(
          Math.max(Date.now() + 100, pending.due),
        );
      else if (
        this.store
          .all()
          .some((r) => ["active", "finishing", "paused"].includes(r.phase))
      )
        await this.ctx.storage.setAlarm(Date.now() + 600000);
    }
  }
}
