import { createHash } from "node:crypto";
import { report } from "../diagnostics.ts";
import type { GitHub } from "../github.ts";
import { authoredVariant, scenarioFor } from "../packages.ts";
import type { Persistence, Reviewer } from "../persistence.ts";
import type { Run } from "../types.ts";
import { revisePull } from "./revisions.ts";
import { runRoot } from "./shared.ts";

export async function assessReviews(
  store: Persistence,
  reviewer: Reviewer,
  enabled: boolean,
  r: Run,
  gh: GitHub,
  finishRequested: boolean,
) {
  const { proposals } = scenarioFor(r);
  const variant = (id: string, revision: number) =>
    authoredVariant(r, id, revision);
  const judge = reviewer;
  for (const p of proposals) {
    if (!enabled) break;
    const state = r.prs[p.id],
      v = variant(p.id, state.revision);
    if (state.unscored) continue;
    const review = state.reviews.filter((x) => x.commit === state.head).at(-1);
    if (!review) continue;
    const inline = await gh.listComments(
      runRoot(r) + "/pulls/" + state.number + "/comments",
    );
    const text =
      review.body +
      "\n" +
      inline
        .filter(
          (x) =>
            x.user?.id === r.player && x.pull_request_review_id === review.id,
        )
        .map((x) => x.body)
        .join("\n");
    if (!text.trim()) continue;
    const category = v.concern
      ? await judge.evaluate(text, v.concern, v.files)
      : undefined;
    // Coaching has no path into assess(), concern credit, or revision decisions.
    if (judge.coach && text.trim()) {
      r.coaching ??= {};
      const attempts = (r.coaching[p.id] ??= []);
      const fingerprint = createHash("sha256")
        .update(review.id + ":" + state.head + ":" + text)
        .digest("hex");
      if (
        attempts.length < 4 &&
        !attempts.some((a) => a.fingerprint === fingerprint)
      ) {
        const attempt = {
          reviewId: review.id,
          revision: state.revision,
          fingerprint,
        } as import("../types.ts").CoachingAttempt;
        attempts.push(attempt);
        store.save(r);
        try {
          attempt.feedback = await judge.coach(text, v.files);
        } catch (error) {
          report({
            component: "judge",
            event: "coaching_failed",
            reason:
              error instanceof Error ? "provider_error" : "unexpected_error",
            run: r.id,
          });
        }
        store.save(r);
      }
    }
    if (category) {
      r.findings[p.id] ??= [];
      if (!r.findings[p.id].some((f) => f.reviewId === review.id))
        r.findings[p.id].push({
          reviewId: review.id,
          category,
          revision: state.revision,
          reviewText: text.slice(0, 1000),
        });
      store.save(r);
    }
    if (
      !finishRequested &&
      review.state === "CHANGES_REQUESTED" &&
      state.outcome === "open" &&
      (category === "identified" || category === "consequence")
    )
      await revisePull(store, r, state.number, gh);
  }
}
