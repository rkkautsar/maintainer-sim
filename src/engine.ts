import { coachingAdvice } from "./review-coaching.ts";
import { storyEnding } from "./story.ts";
import { scenarioFor, authoredVariant, applyVariant } from "./packages.ts";
import type { Run, Assessment } from "./types.ts";
export function initialRun(
  input: Pick<
    Run,
    | "id"
    | "installation"
    | "repository"
    | "owner"
    | "repo"
    | "player"
    | "scenario"
  >,
): Run {
  return { ...input, phase: "seeding", issues: {}, prs: {}, findings: {} };
}
export function expectedFiles(run: Run): Record<string, string> {
  const { baseline, proposals } = scenarioFor(run);
  const files = { ...(run.baselineFiles ?? baseline) };
  for (const p of proposals) {
    const state = run.prs[p.id];
    if (state?.outcome === "merged")
      applyVariant(files, authoredVariant(run, p.id, state.revision));
  }
  return files;
}
export function assess(run: Run): Assessment {
  const { issues, proposals } = scenarioFor(run);
  const variant = (id: string, revision: number) =>
    authoredVariant(run, id, revision);
  if (!proposals.every((p) => run.prs[p.id]))
    throw new Error("Incomplete scenario");
  const unverified = run.unverifiedIssues ?? [];
  const complete = issues
    .filter(
      (issue) =>
        !unverified.includes(issue.id) &&
        proposals.some(
          (p) =>
            p.issue === issue.id &&
            !run.prs[p.id].unscored &&
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
    if (!state.unscored && state.outcome === "merged" && !v.sound) {
      harmful.push(p.id);
      if (v.debt) debt.push(v.debt);
    }
    const unscored =
      state.unscored ||
      (p.issue &&
      unverified.includes(p.issue) &&
      v.sound &&
      state.outcome !== "merged"
        ? "Whether a sound alternative delivered this issue could not be verified."
        : undefined);
    let points = 0;
    if (state.outcome === "merged") points = v.sound ? 2 : -2;
    else if (!v.sound) points = 2;
    else if (!p.issue || complete.includes(p.issue)) points = 2;
    return {
      id: p.id,
      outcome: state.outcome === "open" ? "deferred" : state.outcome,
      points: unscored ? null : points,
      explanation: unscored ? "Unscored: " + unscored : v.explanation,
    };
  });
  return {
    complete,
    total: issues.length,
    points: decisions.reduce((n, d) => n + (d.points ?? 0), 0),
    maximum: decisions.filter((d) => d.points !== null).length * 2,
    success:
      unverified.length || decisions.some((d) => d.points === null)
        ? null
        : complete.length === issues.length && harmful.length === 0,
    unverified,
    warnings: run.warnings ?? [],
    harmful,
    debt,
    decisions,
    reasoning: Object.keys(run.findings).length
      ? "Assessed reviews listed below; all others not assessed."
      : "Not assessed (outcome-only fallback).",
  };
}
export function debrief(run: Run): string {
  const { proposals } = scenarioFor(run);
  const variant = (id: string, revision: number) =>
    authoredVariant(run, id, revision);
  const r = run.result ?? assess(run);
  const lines = [
    "## Stage debrief",
    "",
    storyEnding(r, run),
    "",
    `Milestone: ${r.complete.length}/${r.total} requirements satisfied.${r.unverified?.length ? " Not assessed: " + r.unverified.join(", ") + "." : ""}`,
    r.maximum
      ? `Decision quality: ${r.points}/${r.maximum}.`
      : "Decision quality: not assessed (no scorable decisions).",
    `Stage: ${r.success === null ? "partially assessed" : r.success ? "successful" : "incomplete or unhealthy"}.`,
    `Accepted concerns: ${r.harmful.length ? r.harmful.join(", ") : "none"}.`,
    `Maintainability debt: ${r.debt.length ? r.debt.join("; ") : "none"}.`,
    "",
    `Concern identification: ${r.reasoning}`,
    `Review effort: ${Object.values(run.prs).reduce((n, p) => n + p.reviews.length, 0)} submitted reviews (informational).`,
    "",
  ];
  for (const warning of r.warnings ?? [])
    lines.push(`Assessment note: ${warning}`);
  if (r.decisions.some((d) => d.points === null))
    lines.push(
      "Unscored decisions are excluded from the available points; a partial score is not a full-stage result.",
      "",
    );
  for (const d of r.decisions) {
    const p = proposals.find((p) => p.id === d.id)!,
      state = run.prs[d.id],
      v = variant(d.id, state.revision);
    if (d.points === null) {
      lines.push(
        `- PR ${state.number}: **${d.outcome}** (unscored). ${d.explanation}`,
      );
      continue;
    }
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
    lines.push(
      `- PR ${run.prs[p.id].number}: ${p.lesson ?? "Review the contribution against its linked requirements."}`,
    );
  lines.push("");
  for (const [id, findings] of Object.entries(run.findings).filter(
    ([id]) => !run.prs[id].unscored,
  ))
    for (const f of findings)
      lines.push(
        `- PR ${run.prs[id].number}, review ${f.reviewId}, revision ${f.revision}: ${f.category}. Expected concern: ${variant(id, f.revision).concern ?? "none"}`,
      );
  const coached = Object.entries(run.coaching ?? {})
    .filter(([id]) => run.prs[id] && !run.prs[id].unscored)
    .flatMap(([id, attempts]) =>
      attempts.filter((a) => a.feedback).map((a) => ({ id, ...a })),
    );
  if (coached.length) {
    lines.push(
      "",
      "## Review coaching (no score impact)",
      "",
      "Optional automated observations about the review message. These do not change points, concern credit, prepared revisions, or release success. Uncertain dimensions are omitted.",
      "",
    );
    for (const c of coached) {
      const messages = [c.feedback?.constructiveness, c.feedback?.focus]
        .filter(Boolean)
        .map((key) => coachingAdvice[key as keyof typeof coachingAdvice]);
      lines.push(
        `- PR ${run.prs[c.id].number}, [review ${c.reviewId}](https://github.com/${run.owner}/${run.repo}/pull/${run.prs[c.id].number}#pullrequestreview-${c.reviewId}), revision ${c.revision}: ${messages.join(" ")}`,
      );
    }
  }
  return lines.join("\n");
}
