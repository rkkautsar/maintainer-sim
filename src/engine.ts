import { lessons } from "./lessons.ts";
import { storyEnding } from "./story.ts";
import { baseline, issues, proposals, variant } from "./scenario.ts";
import type { Run, Assessment } from "./types.ts";
export function initialRun(
  input: Pick<
    Run,
    "id" | "installation" | "repository" | "owner" | "repo" | "player"
  >,
): Run {
  return { ...input, phase: "seeding", issues: {}, prs: {}, findings: {} };
}
export function expectedFiles(run: Run): Record<string, string> {
  const files = { ...baseline };
  for (const p of proposals) {
    const state = run.prs[p.id];
    if (state?.outcome === "merged")
      Object.assign(files, variant(p.id, state.revision).files);
  }
  return files;
}
export function assess(run: Run): Assessment {
  if (!proposals.every((p) => run.prs[p.id]))
    throw new Error("Incomplete scenario");
  const complete = issues
    .filter((issue) =>
      proposals.some(
        (p) =>
          p.issue === issue.id &&
          run.prs[p.id].outcome === "merged" &&
          (variant(p.id, run.prs[p.id].revision).satisfiesIssue ??
            variant(p.id, run.prs[p.id].revision).sound),
      ),
    )
    .map((i) => i.id);
  const harmful: string[] = [],
    debt: string[] = [];
  const decisions = proposals.map((p) => {
    const state = run.prs[p.id],
      v = variant(p.id, state.revision);
    if (state.outcome === "merged" && !v.sound) {
      harmful.push(p.id);
      if (v.debt) debt.push(v.debt);
    }
    let points = 0;
    if (state.outcome === "merged") points = v.sound ? 2 : -2;
    else if (!v.sound) points = 2;
    else if (!p.issue || complete.includes(p.issue)) points = 2;
    return {
      id: p.id,
      outcome: state.outcome === "open" ? "deferred" : state.outcome,
      points,
      explanation: v.explanation,
    };
  });
  return {
    complete,
    total: issues.length,
    points: decisions.reduce((n, d) => n + d.points, 0),
    maximum: proposals.length * 2,
    success: complete.length === issues.length && harmful.length === 0,
    harmful,
    debt,
    decisions,
    reasoning: Object.keys(run.findings).length
      ? "Assessed reviews listed below; all others not assessed."
      : "Not assessed (outcome-only fallback).",
  };
}
export function debrief(run: Run): string {
  const r = run.result ?? assess(run);
  const lines = [
    "## Stage debrief",
    "",
    storyEnding(r),
    "",
    `Milestone: ${r.complete.length}/${r.total} requirements satisfied.`,
    `Decision quality: ${r.points}/${r.maximum}.`,
    `Stage: ${r.success ? "successful" : "incomplete or unhealthy"}.`,
    `Accepted concerns: ${r.harmful.length ? r.harmful.join(", ") : "none"}.`,
    `Maintainability debt: ${r.debt.length ? r.debt.join("; ") : "none"}.`,
    "",
    `Concern identification: ${r.reasoning}`,
    `Review effort: ${Object.values(run.prs).reduce((n, p) => n + p.reviews.length, 0)} submitted reviews (informational).`,
    "",
  ];
  for (const d of r.decisions) {
    const p = proposals.find((p) => p.id === d.id)!,
      state = run.prs[d.id],
      v = variant(d.id, state.revision);
    const recommendation = v.sound
      ? p.issue
        ? "Merge to deliver the issue, or close if a sound alternative already delivered it."
        : "Merge or defer this useful community improvement."
      : "Request the prepared fix or close/defer the flawed submission.";
    lines.push(
      `- PR ${state.number}, revision ${state.revision}: **${d.outcome}** (${d.points} points). ${d.explanation} ${v.concern ? "Expected concern: " + v.concern + " " : ""}Recommended action: ${recommendation} Code: ${Object.keys(v.files).join(", ")}.`,
    );
  }
  lines.push("", "## Review takeaways", "");
  for (const p of proposals)
    lines.push(`- PR ${run.prs[p.id].number}: ${lessons[p.id]}`);
  lines.push("");
  for (const [id, findings] of Object.entries(run.findings))
    for (const f of findings)
      lines.push(
        `- PR ${run.prs[id].number}, review ${f.reviewId}, revision ${f.revision}: ${f.category}. Expected concern: ${variant(id, f.revision).concern ?? "none"}`,
      );
  return lines.join("\n");
}
