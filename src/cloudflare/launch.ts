import { DurableObject } from "cloudflare:workers";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { catalog, findPackage, selectScenario } from "../packages.ts";
import { GitHub } from "../github.ts";
import type { Env } from "./env.ts";
const secret = () => randomBytes(32).toString("hex");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const same = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export function sessionId(request: Request) {
  return /(?:^|;\s*)__Host-maintainer-session=([a-f0-9]{64})(?:;|$)/.exec(
    request.headers.get("cookie") ?? "",
  )?.[1];
}
export function originFor(env: Env, request: Request) {
  return env.PUBLIC_ORIGIN ?? new URL(request.url).origin;
}
export async function launchRoute(
  request: Request,
  env: Env,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    ![
      "/auth/start",
      "/auth/callback",
      "/api/session",
      "/api/logout",
      "/api/launch",
      "/api/launch/status",
      "/api/launch/retry",
    ].includes(path)
  )
    return;
  if (!env.LAUNCHES)
    return Response.json(
      { error: "Launch service is not configured." },
      { status: 503 },
    );
  if (path === "/auth/start" && request.method === "GET") {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)
      return Response.json(
        { error: "GitHub authorization is not configured yet." },
        { status: 503 },
      );
    const gate = env.LAUNCHES.get(
      env.LAUNCHES.idFromName(
        "auth-rate:" + hash(request.headers.get("cf-connecting-ip") ?? "local"),
      ),
    );
    const allowed = await gate.fetch("https://session/auth-limit", {
      method: "POST",
    });
    if (!allowed.ok) return allowed;
    const sid = sessionId(request) ?? secret(),
      stub = env.LAUNCHES.get(env.LAUNCHES.idFromName(hash(sid)));
    const result = await stub.fetch("https://session/start", {
      method: "POST",
      body: JSON.stringify({ origin: originFor(env, request) }),
    });
    const { location } = (await result.json()) as any;
    return new Response(null, {
      status: 302,
      headers: {
        location,
        "set-cookie": `__Host-maintainer-session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
        "cache-control": "no-store",
      },
    });
  }
  const sid = sessionId(request);
  if (!sid) {
    if (path === "/api/session")
      return Response.json({ ready: !!env.GITHUB_CLIENT_SECRET, user: null });
    return Response.json({ error: "Connect GitHub first." }, { status: 401 });
  }
  if (
    request.method === "POST" &&
    request.headers.get("origin") !== originFor(env, request)
  )
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    return Response.json({ error: "Request too large." }, { status: 413 });
  let body: string | undefined;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 16000) {
          await reader.cancel();
          return Response.json(
            { error: "Request too large." },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (body && body.length > 16000)
    return Response.json({ error: "Request too large." }, { status: 413 });
  return env.LAUNCHES.get(env.LAUNCHES.idFromName(hash(sid))).fetch(
    "https://session" + path + (path === "/auth/callback" ? url.search : ""),
    {
      method: request.method,
      redirect: "manual",
      headers: {
        "x-csrf-token": request.headers.get("x-csrf-token") ?? "",
        "content-type": "application/json",
      },
      body,
    },
  );
}
type User = { id: number; login: string };
type Job = {
  id: string;
  owner: number;
  quotaGranted?: boolean;
  connected?: boolean;
  scenario: string;
  version: string;
  name: string;
  private: boolean;
  state: string;
  attempts: number;
  repository?: number;
  installation?: number;
  url?: string;
  run?: string;
  createSent?: boolean;
  error?: string;
  createdAt: number;
  baseline?: string;
};
type Login = {
  user: User;
  token: string;
  expires: number;
  csrf: string;
  origin: string;
};
class LaunchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export class LaunchSession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url),
        path = url.pathname;
      if (path === "/auth-limit") {
        const ok = await this.ctx.storage.transaction(async (txn) => {
          const now = Date.now(),
            rate = (await txn.get<{ until: number; count: number }>(
              "rate",
            )) ?? { until: now + 3600000, count: 0 };
          if (rate.until < now) {
            rate.until = now + 3600000;
            rate.count = 0;
          }
          if (rate.count >= 60) return false;
          rate.count++;
          await txn.put("rate", rate);
          return true;
        });
        await this.ctx.storage.setAlarm(Date.now() + 3600000);
        return Response.json(
          ok
            ? { ok: true }
            : { error: "Too many sign-in attempts. Try again later." },
          { status: ok ? 200 : 429 },
        );
      }
      if (path === "/quota") {
        const { id } = (await request.json()) as any;
        const day = new Date().toISOString().slice(0, 10);
        const ok = await this.ctx.storage.transaction(async (txn) => {
          const value = (await txn.get<{ day: string; ids: string[] }>(
            "quota",
          )) ?? { day, ids: [] };
          if (value.day !== day) {
            value.day = day;
            value.ids = [];
          }
          if (value.ids.includes(id)) return true;
          if (value.ids.length >= 5) return false;
          value.ids.push(id);
          await txn.put("quota", value);
          return true;
        });
        if (!ok)
          return Response.json(
            { error: "You can create up to five playthroughs per day." },
            { status: 429 },
          );
        await this.ctx.storage.setAlarm(Date.now() + 86400000);
        return Response.json({ ok: true });
      }
      if (path === "/start") {
        const { origin } = (await request.json()) as any,
          state = secret(),
          verifier = secret();
        await this.ctx.storage.put("oauth", {
          state,
          verifier,
          expires: Date.now() + 600000,
          origin,
        });
        const due = await this.ctx.storage.getAlarm();
        if (!due || due > Date.now() + 600000)
          await this.ctx.storage.setAlarm(Date.now() + 600000);
        const target = new URL("https://github.com/login/oauth/authorize");
        target.search = new URLSearchParams({
          client_id: this.env.GITHUB_CLIENT_ID!,
          redirect_uri: origin + "/auth/callback",
          state,
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
          scope: "offline_access",
        }).toString();
        return Response.json({ location: target.href });
      }
      if (path === "/auth/callback") {
        const oauth = await this.ctx.storage.transaction(async (txn) => {
          const value = await txn.get<any>("oauth");
          await txn.delete("oauth");
          return value;
        });
        if (
          !oauth ||
          oauth.expires < Date.now() ||
          !same(url.searchParams.get("state") ?? "", oauth.state) ||
          !url.searchParams.get("code")
        )
          throw new LaunchError("GitHub sign-in expired. Start again.", 400);
        const response = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              client_id: this.env.GITHUB_CLIENT_ID,
              client_secret: this.env.GITHUB_CLIENT_SECRET,
              code: url.searchParams.get("code"),
              redirect_uri: oauth.origin + "/auth/callback",
              code_verifier: oauth.verifier,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const data = (await response.json()) as any;
        if (!response.ok || !data.access_token)
          throw new LaunchError(
            "GitHub authorization failed. Try connecting again.",
            401,
          );
        const user = await this.api(data.access_token, "GET", "/user");
        if (
          !Number.isSafeInteger(user.id) ||
          !/^[A-Za-z0-9-]+$/.test(user.login) ||
          user.type !== "User"
        )
          throw new LaunchError(
            "Use a personal GitHub account for this preview.",
            400,
          );
        const previousJob = await this.ctx.storage.get<Job>("job");
        if (previousJob && previousJob.owner !== user.id)
          await this.ctx.storage.delete("job");
        const login: Login = {
          user: { id: user.id, login: user.login },
          token: data.access_token,
          csrf: secret(),
          expires:
            Date.now() + Math.min(Number(data.expires_in ?? 3600), 3600) * 1000,
          origin: oauth.origin,
        };
        await this.ctx.storage.put("login", login);
        const job = await this.ctx.storage.get<Job>("job");
        await this.ctx.storage.setAlarm(
          job && !["ready", "failed", "waiting-access"].includes(job.state)
            ? Date.now() + 100
            : login.expires,
        );
        return new Response(null, {
          status: 302,
          headers: {
            location: oauth.origin + "/",
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        });
      }
      const login = await this.login();
      if (path === "/api/session")
        return Response.json({
          ready: !!this.env.GITHUB_CLIENT_SECRET,
          user: login?.user ?? null,
          csrf: login?.csrf,
        });
      if (!login)
        throw new LaunchError(
          "Your session expired. Connect GitHub again.",
          401,
        );
      if (
        request.method === "POST" &&
        !same(request.headers.get("x-csrf-token") ?? "", login.csrf)
      )
        throw new LaunchError("Invalid request token. Reload the page.", 403);
      if (path === "/api/logout" && request.method === "POST") {
        await this.ctx.storage.delete("login");
        return Response.json({ ok: true });
      }
      if (path === "/api/launch/status" && request.method === "GET")
        return Response.json(await this.publicJob());
      if (path === "/api/launch" && request.method === "POST") {
        const raw = await request.text();
        if (raw.length > 16000)
          throw new LaunchError("Request too large.", 413);
        const input = JSON.parse(raw),
          pack = findPackage(input.scenario, input.version);
        if (!catalog().some((p) => p.digest === pack.digest))
          throw new LaunchError(
            "Scenario is not available for new games.",
            400,
          );
        if (typeof input.private !== "boolean")
          throw new LaunchError("Choose repository visibility.", 400);
        const previous = await this.ctx.storage.get<Job>("job");
        if (previous && !["ready", "failed"].includes(previous.state))
          return Response.json(await this.publicJob(), { status: 202 });
        if (
          previous?.state === "failed" &&
          previous.createSent &&
          !previous.repository
        )
          throw new LaunchError(
            "Retry the existing launch before creating another repository.",
            409,
          );
        const id = randomUUID(),
          name = input.name || `maintainer-sim-${pack.id}-${id.slice(0, 8)}`;
        if (
          typeof name !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(name) ||
          name.endsWith(".git")
        )
          throw new LaunchError(
            "Use a repository name up to 80 letters, numbers, dots, underscores or hyphens.",
            400,
          );
        const job: Job = {
          id,
          owner: login.user.id,
          scenario: pack.id,
          version: pack.version,
          name,
          private: input.private,
          state: "creating",
          attempts: 0,
          createdAt: Date.now(),
        };
        let reserved = false;
        await this.ctx.storage.transaction(async (txn) => {
          const current = await txn.get<Job>("job");
          if (current && !["ready", "failed"].includes(current.state)) return;
          await txn.put("job", job);
          reserved = true;
        });
        if (!reserved)
          return Response.json(await this.publicJob(), { status: 202 });
        const quota = await this.env
          .LAUNCHES!.get(
            this.env.LAUNCHES!.idFromName("quota:" + login.user.id),
          )
          .fetch("https://launch/quota", {
            method: "POST",
            body: JSON.stringify({ id }),
          });
        if (!quota.ok) {
          job.state = "failed";
          job.error = "Daily playthrough limit reached.";
          await this.ctx.storage.put("job", job);
          return quota;
        }
        job.quotaGranted = true;
        await this.ctx.storage.put("job", job);
        await this.ctx.storage.setAlarm(Date.now() + 100);
        return Response.json(await this.publicJob(), { status: 202 });
      }
      if (path === "/api/launch/retry" && request.method === "POST") {
        const job = await this.ctx.storage.get<Job>("job");
        if (!job) throw new LaunchError("No playthrough to retry.", 404);
        if (job.state === "ready") return Response.json(await this.publicJob());
        if (!job.quotaGranted) {
          const quota = await this.env
            .LAUNCHES!.get(
              this.env.LAUNCHES!.idFromName("quota:" + login.user.id),
            )
            .fetch("https://launch/quota", {
              method: "POST",
              body: JSON.stringify({ id: job.id }),
            });
          if (!quota.ok) return quota;
          job.quotaGranted = true;
        }
        if (job.installation)
          await this.env.GAMES.get(
            this.env.GAMES.idFromName(String(job.installation)),
          ).fetch("https://game/retry", { method: "POST", body: "{}" });
        job.attempts = 0;
        job.state = job.repository ? "connecting" : "creating";
        delete job.error;
        await this.ctx.storage.put("job", job);
        await this.ctx.storage.setAlarm(Date.now() + 100);
        return Response.json(await this.publicJob(), { status: 202 });
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof LaunchError
              ? error.message
              : "The request could not be completed. Try again.",
        },
        { status: error instanceof LaunchError ? error.status : 400 },
      );
    }
  }
  async login() {
    const login = await this.ctx.storage.get<Login>("login");
    if (login && login.expires > Date.now()) return login;
    await this.ctx.storage.delete("login");
    return undefined;
  }
  async api(token: string, method: string, path: string, body?: unknown) {
    const response = await fetch("https://api.github.com" + path, {
      method,
      headers: {
        authorization: "Bearer " + token,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "maintainer-sim",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Object.assign(new Error("GitHub request failed"), {
        status: response.status,
      });
    return response.status === 204 ? {} : ((await response.json()) as any);
  }
  async publicJob() {
    const job = await this.ctx.storage.get<Job>("job");
    if (!job) return {};
    const labels: Record<string, [string, string]> = {
      creating: [
        "Creating your repository",
        "Preparing a new home for this playthrough.",
      ],
      connecting: [
        "Connecting the game master",
        "Checking GitHub App access to your new repository.",
      ],
      seeding: [
        "Contributors are arriving",
        "Adding the release brief, issues, and pull requests. This can take a minute or two.",
      ],
      ready: [
        "Your project is ready",
        "The release brief is waiting in Game Master issue #1.",
      ],
      "waiting-access": [
        "Connect the game master",
        job.repository
          ? "Install or update Maintainer Sim, select your new repository, then return and try again."
          : "Install Maintainer Sim on your personal GitHub account, then return and try again to create your repository.",
      ],
      failed: [
        "Setup needs another try",
        job.error ?? "Your repository is preserved. Retry to continue setup.",
      ],
    };
    return {
      id: job.id,
      state: job.state,
      title: labels[job.state]?.[0],
      message: labels[job.state]?.[1],
      url: job.url
        ? job.state === "ready"
          ? job.url + "/issues/1"
          : job.url
        : undefined,
      installUrl:
        job.state === "waiting-access"
          ? `https://github.com/apps/${this.env.GITHUB_APP_SLUG ?? "maintainer-sim"}/installations/new`
          : undefined,
    };
  }
  async alarm() {
    const login = await this.login(),
      job = await this.ctx.storage.get<Job>("job");
    if (!login) {
      await this.ctx.storage.delete("oauth");
      if (job && Date.now() < job.createdAt + 86400000)
        await this.ctx.storage.setAlarm(job.createdAt + 86400000);
      else await this.ctx.storage.deleteAll();
      return;
    }
    if (!job || ["ready", "failed", "waiting-access"].includes(job.state)) {
      await this.ctx.storage.setAlarm(login.expires);
      return;
    }
    try {
      await this.advance(job, login);
      job.attempts = 0;
      await this.ctx.storage.put("job", job);
      await this.ctx.storage.setAlarm(
        ["ready", "waiting-access"].includes(job.state)
          ? login.expires
          : Date.now() + 1500,
      );
    } catch (error: any) {
      job.attempts++;
      if (error.status === 401) {
        job.state = "failed";
        job.error = "GitHub access expired. Connect GitHub again.";
      } else if (job.attempts >= 5 || [403, 409, 422].includes(error.status)) {
        job.state = "failed";
        job.error =
          error.status === 409 || error.status === 422
            ? "That repository name is already taken or cannot be created. Existing repositories were left unchanged."
            : "Setup could not finish. Check App permissions, then retry.";
      }
      await this.ctx.storage.put("job", job);
      await this.ctx.storage.setAlarm(
        job.state === "failed"
          ? login.expires
          : Date.now() + Math.min(60000, 2000 * 2 ** job.attempts),
      );
    }
  }
  async advance(job: Job, login: Login) {
    const pack = findPackage(job.scenario, job.version),
      selection = selectScenario(pack),
      root = "/repos/" + login.user.login + "/" + job.name;
    if (!job.quotaGranted)
      throw Object.assign(Error("Launch quota not granted"), { status: 403 });
    if (job.owner !== login.user.id) throw Error("Wrong launch owner");
    if (!job.installation) {
      const installed = await this.api(
        login.token,
        "GET",
        "/user/installations?per_page=100",
      );
      const installation = installed.installations?.find(
        (i: any) =>
          i.app_id === Number(this.env.GITHUB_APP_ID) &&
          i.account?.id === login.user.id &&
          !i.suspended_at,
      );
      if (!installation) {
        job.state = "waiting-access";
        return;
      }
      job.installation = installation.id;
      return;
    }
    if (!job.repository) {
      if (!job.createSent) {
        // Refuse existing names before recording the creation intent.
        let existing: any;
        try {
          existing = await this.api(login.token, "GET", root);
        } catch (error: any) {
          if (error.status !== 404) throw error;
        }
        if (existing) {
          if (
            existing.owner?.id === login.user.id &&
            existing.description === "Maintainer Sim playthrough · " + job.id &&
            Date.parse(existing.created_at) >= job.createdAt - 60000
          ) {
            job.repository = existing.id;
            job.url = existing.html_url;
            job.state = "connecting";
            return;
          }
          throw Object.assign(new Error("Repository exists"), { status: 409 });
        }
        job.createSent = true;
        await this.ctx.storage.put("job", job);
        let repo: any;
        try {
          repo = await this.api(login.token, "POST", "/user/repos", {
            name: job.name,
            private: job.private,
            auto_init: true,
            description: "Maintainer Sim playthrough · " + job.id,
          });
        } catch (error: any) {
          if ([400, 401, 403, 422].includes(error.status)) {
            job.createSent = false;
            await this.ctx.storage.put("job", job);
          }
          throw error;
        }
        if (repo.owner?.id !== login.user.id || repo.name !== job.name)
          throw Error("Unexpected repository");
        job.repository = repo.id;
        job.url = repo.html_url;
        job.state = "connecting";
        return;
      }
      // A lost POST response is recoverable only for the exact empty repository we marked.
      let repo: any;
      try {
        repo = await this.api(login.token, "GET", root);
      } catch (error: any) {
        if (error.status === 404) {
          job.createSent = false;
          return;
        }
        throw error;
      }
      if (
        repo.owner?.id !== login.user.id ||
        repo.description !== "Maintainer Sim playthrough · " + job.id ||
        (repo.created_at && Date.parse(repo.created_at) < job.createdAt - 60000)
      )
        throw Object.assign(Error("Repository identity mismatch"), {
          status: 409,
        });
      job.repository = repo.id;
      job.url = repo.html_url;
      job.state = "connecting";
      return;
    }
    if (!job.connected) {
      try {
        await GitHub.fromKey(
          job.installation!,
          job.repository!,
          this.env.GITHUB_APP_ID,
          this.env.GITHUB_PRIVATE_KEY,
        );
      } catch (error: any) {
        if ([403, 404, 422].includes(error.status)) {
          job.state = "waiting-access";
          return;
        }
        throw error;
      }
      job.connected = true;
      return;
    }
    const gh = await GitHub.fromKey(
      job.installation,
      job.repository,
      this.env.GITHUB_APP_ID,
      this.env.GITHUB_PRIVATE_KEY,
    );
    if (!job.baseline) {
      const repo = await gh.get(root);
      if (repo.id !== job.repository || repo.owner.id !== login.user.id)
        throw Error("Unexpected repository identity");
      const branch = repo.default_branch || "main",
        ref = await gh.get(root + "/git/ref/heads/" + branch),
        current = await gh.tree(root, ref.object.sha),
        target = pack.stages[0].baseline;
      const matches =
        JSON.stringify(Object.entries(current).sort()) ===
        JSON.stringify(Object.entries(target).sort());
      if (matches) {
        job.baseline = ref.object.sha;
        job.state = "seeding";
        return;
      }
      const parent = await gh.get(root + "/git/commits/" + ref.object.sha);
      if (
        parent.parents?.length ||
        Object.keys(current).some((p) => p !== "README.md")
      )
        throw Error("Repository was edited during setup");
      const commit = await gh.commit(
        root,
        ref.object.sha,
        target,
        "Start " + pack.title + " · " + job.id,
      );
      await gh.patch(root + "/git/refs/heads/" + branch, {
        sha: commit.sha,
        force: false,
      });
      job.baseline = commit.sha;
      job.state = "seeding";
      return;
    }
    const stub = this.env.GAMES.get(
      this.env.GAMES.idFromName(String(job.installation)),
    );
    const status = await stub.fetch("https://game/status"),
      runs = (await status.json()) as any[],
      run = runs.find((r) => r.repository === job.repository);
    if (run) {
      if (run.phase === "active" || run.phase === "finished") {
        job.run = run.id;
        job.state = "ready";
      } else {
        const response = await stub.fetch(
            "https://game/progress?repository=" + job.repository,
          ),
          progress = (await response.json()) as any;
        if (progress.failed) {
          job.state = "failed";
          job.error =
            "Game setup could not finish. Check App permissions, then retry to resume.";
        }
      }
      return;
    }
    const response = await stub.fetch("https://game/seed", {
      method: "POST",
      body: JSON.stringify({
        installation: job.installation,
        repository: job.repository,
        owner: login.user.login,
        repo: job.name,
        player: login.user.id,
        confirmDisposable: true,
        scenario: selection,
      }),
    });
    if (!response.ok && response.status !== 409)
      throw Error("Could not queue game setup");
  }
}
