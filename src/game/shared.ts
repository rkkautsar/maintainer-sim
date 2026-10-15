import type { GitHub } from "../github.ts";
import type { Persistence } from "../persistence.ts";
import type { Run } from "../types.ts";
export const runRoot = (run: Run) => "/repos/" + run.owner + "/" + run.repo;
export const runMarker = (run: Run, id: string) =>
  `<!-- maintainer-sim:${run.id}:${id} -->`;
export const equalFiles = (
  a: Record<string, string>,
  b: Record<string, string>,
) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());
export class SnapshotChanged extends Error {}
export async function pinBaseline(store: Persistence, r: Run, gh: GitHub) {
  if (!r.baselineFiles) {
    if (!r.baseline) throw new Error("Run has no validated baseline commit");
    // Existing runs were validated when created. Read their immutable commit,
    // never the current default branch or the latest published template.
    r.baselineFiles = await gh.tree(runRoot(r), r.baseline);
    store.save(r);
  }
}
