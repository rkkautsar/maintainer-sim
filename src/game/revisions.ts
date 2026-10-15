import type { GitHub } from "../github.ts";
import { applyVariant, scenarioFor } from "../packages.ts";
import type { Persistence } from "../persistence.ts";
import type { Run } from "../types.ts";
import { postNotice, sendStoryTouches } from "./messages.ts";
import { runRoot } from "./shared.ts";

export async function revisePull(
  store: Persistence,
  r: Run,
  number: number,
  gh: GitHub,
) {
  const { proposals } = scenarioFor(r);
  const p = proposals.find((p) => r.prs[p.id].number === number);
  if (!p) throw new Error("Not a scenario PR");
  const state = r.prs[p.id];
  if (state.outcome !== "open") return;
  if (state.unscored) {
    await postNotice(
      store,
      r,
      gh,
      "revision-skipped-" + p.id,
      "The branch for PR #" +
        number +
        " differs from the prepared exercise. Automatic revisions are unavailable for it, but you can still merge, close, or finish the stage. Its assessment will be marked unscored.",
    );
    return;
  }
  const next = p.variants[state.revision + 1];
  if (!next) {
    await postNotice(
      store,
      r,
      gh,
      "limit-" + p.id,
      "No further prepared revision is available for PR #" +
        number +
        ". You can still merge, close, or finish early.",
    );
    return;
  }
  const branch = `game/${r.id}/${p.id}`,
    root = runRoot(r);
  // Record the intended head before mutation: a retry can recover a failed response.
  const previous = applyVariant(
    { ...r.baselineFiles },
    p.variants[state.revision],
  );
  const target = applyVariant({ ...r.baselineFiles }, next);
  const files = Object.fromEntries(
    Object.entries(target).filter(
      ([path, content]) => previous[path] !== content,
    ),
  );
  const deletes = Object.keys(previous).filter((path) => !(path in target));
  const commit = await gh.commit(
    root,
    state.head,
    files,
    "Community revision",
    deletes,
  );
  store.recordRevision({
    run: r.id,
    id: p.id,
    old: state.head,
    head: commit.sha,
    revision: state.revision + 1,
  });
  await gh.patch(root + "/git/refs/heads/" + branch, {
    sha: commit.sha,
    force: false,
  });
  state.head = commit.sha;
  state.revision++;
  store.save(r);
  await sendStoryTouches(store, r, gh);
  store.clearRevision(r.id, p.id);
}

export async function recoverRevision(store: Persistence, r: Run, gh: GitHub) {
  for (const intent of store.revisionIntents(r.id)) {
    const branch = `game/${r.id}/${intent.id}`,
      root = runRoot(r),
      head = (await gh.reference(root, branch)).object.sha;
    if (head !== intent.head && head !== intent.old) {
      store.clearRevision(r.id, intent.id);
      continue; // Preserve external edits; reconcile marks this PR unscored.
    }
    if (head === intent.old)
      await gh.patch(root + "/git/refs/heads/" + branch, {
        sha: intent.head,
        force: false,
      });
    r.prs[intent.id].head = intent.head;
    r.prs[intent.id].revision = intent.revision;
    store.save(r);
    store.clearRevision(r.id, intent.id);
  }
}
