const [command, ...args] = process.argv.slice(2);
const url = process.env.WORKER_URL,
  token = process.env.ADMIN_TOKEN;
if (!url || !token) throw new Error("Set WORKER_URL and ADMIN_TOKEN in .env");
let path: string, body: any;
if (command === "seed") {
  const [installation, repository, owner, repo, player] = args;
  path = "/admin/seed";
  body = {
    installation: Number(installation),
    repository: Number(repository),
    owner,
    repo,
    player: Number(player),
    confirmDisposable: process.env.DISPOSABLE_REPO_CONFIRMED === "true",
  };
} else if (command === "status") {
  path = "/admin/status?installation=" + encodeURIComponent(args[0]);
} else if (command === "resume") {
  path = "/admin/resume";
  body = { installation: Number(args[0]), repository: Number(args[1]) };
} else if (command === "retry") {
  path = "/admin/retry";
  body = { installation: Number(args[0]) };
} else
  throw new Error(
    "Commands: seed INSTALLATION REPOSITORY OWNER REPO PLAYER, status INSTALLATION, retry INSTALLATION, resume INSTALLATION REPOSITORY",
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
