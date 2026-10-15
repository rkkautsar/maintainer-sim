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
/** Detailed feedback is published only after the stage ends, in the PR thread. */
export function prDebrief(run: Run, id: string): string {
  const p = scenarioFor(run).proposals.find((p) => p.id === id)!;
  const state = run.prs[id];
  const result = run.result ?? assess(run);
  const decision = result.decisions.find((d) => d.id === id)!;
  const v = authoredVariant(run, id, state.revision);
  const lines = [
    "## 🔎 PR debrief",
    "",
    `**Decision:** ${decision.outcome} · **Revision:** ${state.revision} · **Points:** ${decision.points === null ? "unscored" : decision.points > 0 ? "+" + decision.points : decision.points}`,
    "",
    "### What happened",
    "",
    decision.explanation,
  ];
  if (decision.points !== null) {
    const recommendation = v.sound
      ? p.issue
        ? "Merge to deliver the issue, or close if a sound alternative already delivered it."
        : "This is a useful community improvement; weigh it against the milestone and review time."
      : "Request the prepared fix, or close/defer the flawed submission.";
    if (v.concern) lines.push("", `**Concern in this revision:** ${v.concern}`);
    lines.push(
      "",
      `**Recommended action:** ${recommendation}`,
      "",
      "### 💡 Takeaway",
      "",
      p.lesson ?? "Review the contribution against its linked requirements.",
    );
    const findings = run.findings[id] ?? [];
    if (findings.length) {
      lines.push("", "### Concern identification", "");
      for (const f of findings) {
        lines.push(
          `- review ${f.reviewId}, revision ${f.revision}: ${f.category}. Expected concern: ${authoredVariant(run, id, f.revision).concern ?? "none"}`,
        );
      }
    } else
      lines.push(
        "",
        "**Concern identification:** Not assessed (outcome-only fallback).",
      );
    const coached = (run.coaching?.[id] ?? []).filter((a) => a.feedback);
    if (coached.length) {
      lines.push(
        "",
        "### 💬 Review coaching (no score impact)",
        "",
        "Automated suggestions about your review wording. These can be imperfect; uncertain dimensions are omitted.",
        "",
      );
      for (const c of coached) {
        const messages = [c.feedback?.constructiveness, c.feedback?.focus]
          .filter(Boolean)
          .map((key) => coachingAdvice[key as keyof typeof coachingAdvice]);
        lines.push(
          `- [Review ${c.reviewId}](https://github.com/${run.owner}/${run.repo}/pull/${state.number}#pullrequestreview-${c.reviewId}), revision ${c.revision}: ${messages.join(" ")}`,
        );
      }
    }
    lines.push(
      "",
      "<details>",
      "<summary>Files in the authored change</summary>",
      "",
      ...[...Object.keys(v.files), ...(v.deletes ?? [])].map(
        (file) => `- \`${file}\``,
      ),
      "",
      "</details>",
    );
  }
  lines.push(
    "",
    `[← Stage overview](https://github.com/${run.owner}/${run.repo}/issues/${run.master})`,
  );
  return lines.join("\n");
}

export function debrief(
  run: Run,
  feedbackLinks: Record<string, string> = {},
): string {
  const { proposals, issues } = scenarioFor(run);
  const r = run.result ?? assess(run);
  const link = (id: string) =>
    feedbackLinks[id] ??
    `https://github.com/${run.owner}/${run.repo}/pull/${run.prs[id].number}`;
  const lines = [
    "## 🏁 Stage debrief",
    "",
    storyEnding(r, run),
    "",
    "| Milestone | Decision quality | Release |",
    "| :-- | :-- | :-- |",
    `| ${r.complete.length}/${r.total} requirements satisfied | ${r.maximum ? `${r.points}/${r.maximum}` : "Not assessed"} | ${r.success === null ? "⚪ partially assessed" : r.success ? "🟢 Ready" : "🟠 Needs work"} |`,
    "",
  ];
  const missing = issues.filter((i) => !r.complete.includes(i.id));
  if (missing.length)
    lines.push(
      `**Still needed:** ${missing.map((i) => i.title).join("; ")}.`,
      "",
    );
  if (r.harmful.length)
    lines.push(
      `**⚠️ Shipped concerns:** ${r.harmful.map((id) => `[#${run.prs[id].number}](${link(id)})`).join(", ")}.`,
      "",
    );
  if (r.debt.length)
    lines.push(`**Maintenance debt:** ${r.debt.join("; ")}.`, "");
  const lessons = [...r.decisions]
    .filter((d) => d.points !== null)
    .sort((a, b) => a.points! - b.points!)
    .slice(0, 3);
  if (lessons.length) {
    lines.push("### 💡 Take into the next stage", "");
    for (const d of lessons) {
      const p = proposals.find((p) => p.id === d.id)!;
      lines.push(
        `- ${p.lesson ?? "Check the contribution against its linked requirements."} ([#${run.prs[d.id].number}](${link(d.id)}))`,
      );
    }
    lines.push("");
  }
  lines.push(
    "### 📋 Your decisions",
    "",
    "Open a PR debrief for the explanation, code takeaway, and any review coaching.",
    "",
    "| PR | Outcome | Points | Feedback |",
    "| :-- | :-- | --: | :-- |",
  );
  for (const d of r.decisions) {
    const state = run.prs[d.id];
    const p = proposals.find((p) => p.id === d.id)!;
    lines.push(
      `| #${state.number} ${p.title.replaceAll("|", "\\|").replaceAll("\n", " ")} | ${d.outcome} | ${d.points === null ? "—" : d.points > 0 ? "+" + d.points : d.points} | [🔎 PR debrief](${link(d.id)}) |`,
    );
  }
  lines.push(
    "",
    `**Review assessment:** ${Object.keys(run.findings).length ? "Concern identification is recorded in the PR debriefs." : "Not assessed (outcome-only fallback)."} Automated coaching is advisory and does not change the score.`,
    "",
    "Requirements are verified against the scenario rubric; GitHub’s closed-issue count can differ.",
  );
  if (r.decisions.some((d) => d.points === null))
    lines.push(
      "",
      "⚪ Unscored decisions are excluded from available points; this is a partial assessment.",
    );
  for (const warning of r.warnings ?? [])
    lines.push("", `**Assessment note:** ${warning}`);
  return lines.join("\n");
}
