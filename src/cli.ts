import { randomUUID } from "node:crypto";
import { assess, debrief, initialRun } from "./engine.ts";
import { Game } from "./game.ts";
import { GitHub } from "./github.ts";
import {
  catalog,
  findPackage,
  scenarioFor,
  selectScenario,
} from "./packages.ts";
import { server } from "./server.ts";
import { Store } from "./store.ts";
const [cmd, ...args] = process.argv.slice(2);
function demo() {
  const pack = catalog()[0];
  const run = initialRun({
    id: "demo",
    installation: 1,
    repository: 1,
    owner: "local",
    repo: "demo",
    player: 1,
    scenario: selectScenario(pack),
  });
  run.phase = "active";
  const delivered = new Set<string>();
  for (const [i, p] of scenarioFor(run).proposals.entries()) {
    const revision = p.variants.findIndex((v) => v.sound);
    const merge = revision >= 0 && (!p.issue || !delivered.has(p.issue));
    if (merge && p.issue) delivered.add(p.issue);
    run.prs[p.id] = {
      number: i + 1,
      revision: Math.max(0, revision),
      outcome: merge ? "merged" : "closed",
      head: "fixture",
      reviews: [],
    };
  }
  run.result = assess(run);
  console.log(debrief(run));
}
async function main() {
  if (cmd === "demo") {
    demo();
    return;
  }
  const store = new Store(process.env.DATABASE_PATH),
    game = new Game(store, (run) =>
      GitHub.installation(run.installation, run.repository),
    );
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
      const [
        installation,
        repository,
        owner,
        repo,
        player,
        scenario,
        version,
        stage,
      ] = args;
      if (
        ![installation, repository, player].every(
          (x) => /^\d+$/.test(x ?? "") && Number(x) > 0,
        ) ||
        !scenario ||
        !version ||
        ![owner, repo].every((x) => /^[A-Za-z0-9_.-]+$/.test(x ?? ""))
      )
        throw new Error(
          "Usage: seed INSTALLATION_ID REPOSITORY_ID OWNER REPO PLAYER_ID SCENARIO VERSION [STAGE]",
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
        scenario: selectScenario(findPackage(scenario, version), stage),
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
      else throw new Error("Run is not interrupted");
    } else if (cmd === "status") {
      console.log(JSON.stringify(store.all(), null, 2));
    } else if (cmd === "retry-deliveries") {
      store.retryFailed();
      console.log("Failed deliveries queued");
    } else
      throw new Error(
        "Commands: demo, seed INSTALLATION REPOSITORY OWNER REPO PLAYER SCENARIO VERSION [STAGE], resume RUN_ID, status, retry-deliveries, serve",
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
