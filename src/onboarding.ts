import { randomUUID } from "node:crypto";
import { initialRun, expectedFiles } from "./engine.ts";
import type { Game } from "./game.ts";
export type Candidate = {
  installation: number;
  repository: number;
  owner: string;
  repo: string;
  player: number;
};
export function installationCandidates(
  event: string,
  payload: any,
): Candidate[] {
  const repos =
    event === "installation" && payload.action === "created"
      ? payload.repositories
      : event === "installation_repositories" && payload.action === "added"
        ? payload.repositories_added
        : [];
  if (
    !Array.isArray(repos) ||
    !Number.isSafeInteger(payload.installation?.id) ||
    payload.installation.id <= 0 ||
    !Number.isSafeInteger(payload.sender?.id) ||
    payload.sender.id <= 0 ||
    payload.sender.type !== "User"
  )
    return [];
  return repos.flatMap((repo: any) => {
    const parts: string[] =
      typeof repo.full_name === "string" ? repo.full_name.split("/") : [];
    if (
      parts.length !== 2 ||
      !parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(p)) ||
      !Number.isSafeInteger(repo.id) ||
      repo.id <= 0 ||
      repo.full_name.toLowerCase() === "rkkautsar/pocket-board-template"
    )
      return [];
    return [
      {
        installation: payload.installation.id,
        repository: repo.id,
        owner: parts[0],
        repo: parts[1],
        player: payload.sender.id,
      },
    ];
  });
}
export async function startCandidate(game: Game, input: Candidate) {
  const existing = game.store
    .all()
    .find((r) => r.repository === input.repository);
  if (existing) {
    if (existing.phase === "seeding") await game.seed(existing);
    return;
  }
  const run = initialRun({ id: randomUUID(), ...input }),
    gh = await game.connect(run),
    root = game.root(run);
  const repo = await gh.get(root);
  if (
    repo.id !== input.repository ||
    repo.is_template ||
    repo.archived ||
    repo.disabled
  )
    return;
  const ref = await gh.get(root + "/git/ref/heads/" + repo.default_branch);
  const files = await gh.tree(root, ref.object.sha);
  if (
    JSON.stringify(Object.entries(files).sort()) !==
    JSON.stringify(Object.entries(expectedFiles(run)).sort())
  )
    return;
  if ((await gh.list(root + "/issues?state=all")).length) return;
  run.base = repo.default_branch;
  run.baseline = ref.object.sha;
  // An operator request can arrive while the read-only preflight awaits GitHub.
  if (game.store.all().some((r) => r.repository === input.repository)) return;
  game.store.save(run);
  await game.seed(run);
}
