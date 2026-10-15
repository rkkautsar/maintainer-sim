import { debrief, prDebrief } from "../engine.ts";
import type { GitHub } from "../github.ts";
import { scenarioFor } from "../packages.ts";
import type { Persistence } from "../persistence.ts";
import type { Run } from "../types.ts";
import { runMarker, runRoot } from "./shared.ts";

export async function publishResult(store: Persistence, r: Run, gh: GitHub) {
  const root = runRoot(r),
    marker = runMarker(r, "result");
  const feedbackLinks: Record<string, string> = {};
  // Markers survive a lost response or a crash between PR comments and the overview.
  // Publish details first so the overview never points at missing feedback.
  for (const p of scenarioFor(r).proposals) {
    const path = root + "/issues/" + r.prs[p.id].number + "/comments";
    const detailMarker = runMarker(r, "feedback-" + p.id);
    const thread = await gh.listComments(path);
    const existing = thread.find(
      (x) => x.body?.includes(detailMarker) && x.user?.type === "Bot",
    );
    const body = prDebrief(r, p.id) + "\n\n" + detailMarker;
    const comment = existing ?? (await gh.createComment(path, body));
    if (existing && existing.body !== body)
      await gh.patch(root + "/issues/comments/" + existing.id, { body });
    feedbackLinks[p.id] =
      `https://github.com/${r.owner}/${r.repo}/pull/${r.prs[p.id].number}#issuecomment-${comment.id}`;
  }
  const comments = await gh.listComments(
    root + "/issues/" + r.master + "/comments",
  );
  const existing = comments.find(
    (x) => x.body?.includes(marker) && x.user?.type === "Bot",
  );
  const body =
    debrief(r, feedbackLinks) +
    (scenarioFor(r).next
      ? "\n\n▶️ Comment `/game next` here to start the next stage. This stage’s result is frozen."
      : "") +
    "\n\n" +
    marker;
  if (!existing)
    await gh.post(root + "/issues/" + r.master + "/comments", { body });
  else if (existing.body !== body)
    await gh.patch(root + "/issues/comments/" + existing.id, { body });
  // GitHub closing keywords only close issues on the default branch. Later
  // authored stages use their own branches, so reflect verified delivery here.
  if (r.scenario) {
    for (const id of r.result!.complete)
      await gh.patch(root + "/issues/" + r.issues[id], { state: "closed" });
    if (r.result!.success)
      await gh.patch(root + "/milestones/" + r.milestone, {
        state: "closed",
      });
  }
  r.phase = "finished";
  store.save(r);
}
