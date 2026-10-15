import { selectScenario } from "./packages.ts";
import { localRegistry } from "./local-packages.ts";
const [command, ...args] = process.argv.slice(2);
const url = process.env.WORKER_URL,
  token = process.env.ADMIN_TOKEN;
if (!url || !token) throw new Error("Set WORKER_URL and ADMIN_TOKEN in .env");
let path: string, body: unknown;
if (command === "seed") {
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
  if (!scenario || !version)
    throw new Error("Provide SCENARIO VERSION [STAGE]");
  path = "/admin/seed";
  body = {
    installation: Number(installation),
    repository: Number(repository),
    owner,
    repo,
    player: Number(player),
    scenario: selectScenario(
      await localRegistry().pinned({ id: scenario, version }),
      stage,
    ),
    confirmDisposable: process.env.DISPOSABLE_REPO_CONFIRMED === "true",
  };
} else if (command === "status") {
  path = "/admin/status?installation=" + encodeURIComponent(args[0]);
} else if (command === "retry") {
  path = "/admin/retry";
  body = { installation: Number(args[0]) };
} else
  throw new Error(
    "Commands: seed INSTALLATION REPOSITORY OWNER REPO PLAYER SCENARIO VERSION [STAGE], status INSTALLATION, retry INSTALLATION",
  );
const response = await fetch(new URL(path, url), {
  method: body ? "POST" : "GET",
  headers: {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  },
  body: body ? JSON.stringify(body) : undefined,
});
if (!response.ok)
  throw new Error("Worker request failed (HTTP " + response.status + ")");
console.log(await response.text());
