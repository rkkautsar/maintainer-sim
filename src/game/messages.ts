import type { GitHub } from "../github.ts";
import type { Persistence } from "../persistence.ts";
import { followup, revisionReply } from "../story.ts";
import type { Run } from "../types.ts";
import { runMarker, runRoot } from "./shared.ts";

export async function sendStoryTouches(store: Persistence, r: Run, gh: GitHub) {
  r.storySent ??= {};
  for (const [id, state] of Object.entries(r.prs)) {
    const key =
      state.revision > 0 ? `reply-${id}-${state.revision}` : `context-${id}`;
    const body = state.revision > 0 ? revisionReply(r, id) : followup(r, id);
    if (!body || r.storySent[key]) continue;
    const marker = runMarker(r, key),
      path = runRoot(r) + "/issues/" + state.number + "/comments";
    const comments = await gh.listComments(path);
    if (
      !comments.some((x) => x.body?.includes(marker) && x.user?.type === "Bot")
    )
      await gh.createComment(path, body + "\n\n" + marker);
    r.storySent[key] = true;
    store.save(r);
  }
}

export async function postNotice(
  store: Persistence,
  r: Run,
  gh: GitHub,
  id: string,
  body: string,
) {
  const marker = runMarker(r, id),
    root = runRoot(r);
  const comments = await gh.listComments(
    root + "/issues/" + r.master + "/comments",
  );
  if (!comments.some((x) => x.body?.includes(marker) && x.user?.type === "Bot"))
    await gh.post(root + "/issues/" + r.master + "/comments", {
      body: body + "\n\n" + marker,
    });
}
