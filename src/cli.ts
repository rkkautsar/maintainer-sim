import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./store.ts";
import { Game } from "./game.ts";
import { initialRun, assess, debrief } from "./engine.ts";
import { baseline, proposals } from "./scenario.ts";
import { server } from "./server.ts";
const [cmd, ...args] = process.argv.slice(2);
function demo() {
  const run = initialRun({
    id: "demo",
    installation: 1,
    repository: 1,
    owner: "local",
    repo: "demo",
    player: 1,
  });
  run.phase = "active";
  for (const [i, p] of proposals.entries())
    run.prs[p.id] = {
      number: i + 1,
      revision: ["c", "d"].includes(p.id) ? 1 : 0,
      outcome: ["a", "c", "d", "e"].includes(p.id) ? "merged" : "closed",
      head: "fixture",
      reviews: [],
    };
  run.result = assess(run);
  console.log(debrief(run));
}
async function main() {
  if (cmd === "board") {
    const { createBoardServer } =
      await import("../scenario/public/src/server.ts");
    const app = createBoardServer();
    app.listen(3001, "127.0.0.1", () =>
      console.log("Pocket Board: http://localhost:3001"),
    );
    return;
  }
  if (cmd === "demo") {
    demo();
    return;
  }
  if (cmd === "export-template") {
    const dest = args[0];
    if (!dest) throw new Error("Provide an empty destination directory");
    if (existsSync(dest)) throw new Error("Destination must not exist");
    mkdirSync(dest, { recursive: true });
    for (const [file, content] of Object.entries(baseline)) {
      mkdirSync(join(dest, file, ".."), { recursive: true });
      writeFileSync(join(dest, file), content);
    }
    console.log("Template exported to " + dest);
    return;
  }
  const store = new Store(process.env.DATABASE_PATH),
    game = new Game(store);
  if (cmd === "serve") {
    // Resume interrupted publication without depending on another webhook.
    for (const r of store.all())
      if (r.phase === "finishing") await game.publish(r, await game.connect(r));
    const http = server(store, game, process.env.WEBHOOK_SECRET ?? "");
    http.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () =>
      console.log("Webhook service listening on localhost"),
    );
    process.once("SIGINT", () =>
      http.close(() => {
        store.close();
        process.exit(0);
      }),
    );
    return;
  }
  try {
    if (cmd === "seed") {
      const [installation, repository, owner, repo, player] = args;
      if (
        ![installation, repository, player].every(
          (x) => /^\d+$/.test(x ?? "") && Number(x) > 0,
        ) ||
        ![owner, repo].every((x) => /^[A-Za-z0-9_.-]+$/.test(x ?? ""))
      )
        throw new Error(
          "Usage: seed INSTALLATION_ID REPOSITORY_ID OWNER REPO PLAYER_ID",
        );
      if (process.env.DISPOSABLE_REPO_CONFIRMED !== "true")
        throw new Error(
          "Confirm this is a disposable game repository with DISPOSABLE_REPO_CONFIRMED=true",
        );
      if (store.all().some((r) => r.repository === Number(repository)))
        throw new Error(
          "Repository already has a run; use a fresh repository or resume",
        );
      const run = initialRun({
        id: randomUUID(),
        installation: Number(installation),
        repository: Number(repository),
        owner,
        repo,
        player: Number(player),
      });
      store.save(run);
      console.log("Run " + run.id);
      await game.seed(run);
      console.log("Stage ready");
    } else if (cmd === "resume") {
      const run = store.get(args[0]);
      if (run.phase === "seeding") await game.seed(run);
      else if (run.phase === "finishing")
        await game.publish(run, await game.connect(run));
      else
        throw new Error(
          "Only interrupted setup/publication can resume; paused runs require inspection and a fresh repository",
        );
    } else if (cmd === "status") {
      console.log(JSON.stringify(store.all(), null, 2));
    } else if (cmd === "retry-deliveries") {
      store.db
        .prepare(
          "UPDATE deliveries SET status='pending',attempts=0,next=0 WHERE status='failed'",
        )
        .run();
      console.log("Failed deliveries queued");
    } else
      throw new Error(
        "Commands: demo, export-template DIR, seed INSTALLATION REPOSITORY OWNER REPO PLAYER, resume RUN_ID, status, retry-deliveries, serve",
      );
  } finally {
    store.close();
  }
}
main().catch((error) => {
  console.error(
    error?.name === "HttpError"
      ? "GitHub request failed (HTTP " +
          error.status +
          "). Check permissions and target settings."
      : (error?.message ?? "Operation failed."),
  );
  process.exitCode = 1;
});
