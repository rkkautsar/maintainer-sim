import { publicCharacter, renderLinks, scenarioFor } from "./packages.ts";
import type { Assessment, Run } from "./types.ts";
export function storyEnding(result: Assessment, run: Run): string {
  const s = scenarioFor(run);
  return result.success === null
    ? s.endings.partial
    : result.success
      ? s.endings.success
      : s.endings.incomplete;
}
export function revisionReply(run: Run, id: string): string {
  const p = scenarioFor(run).proposals.find((p) => p.id === id)!;
  return (
    publicCharacter(run, p.character) +
    (p.variants[run.prs[id].revision].reply ??
      "I have pushed the prepared revision. Please take another look.")
  );
}
export function contributorNote(run: Run, id: string) {
  return publicCharacter(
    run,
    scenarioFor(run).proposals.find((p) => p.id === id)?.character,
  );
}
export function followup(run: Run, id: string) {
  const p = scenarioFor(run).proposals.find((p) => p.id === id);
  return p?.followup
    ? publicCharacter(run, p.character) + p.followup
    : undefined;
}
export function storyBody(run: Run) {
  const stage = scenarioFor(run);
  return renderLinks(
    [
      `# ${stage.title}`,
      stage.intro,
      run.base
        ? `[Browse the current stage code](https://github.com/${run.owner}/${run.repo}/tree/${encodeURIComponent(run.base)}) — branch \`${run.base}\`. Pull this branch and restart the local app after merging.`
        : "",
      "## This milestone",
      ...stage.issues.map((i) => `- #${run.issues[i.id] ?? "?"}: ${i.title}`),
      "## Contributions",
      ...stage.proposals.map(
        (p) => `- #${run.prs[p.id]?.number ?? "?"}: ${p.title}`,
      ),
      "## Playing",
      "Review, merge, close, or request changes using GitHub. You do not need to write code. Contributor portraits identify fictional characters; all posts come from the game App.",
      "The stage ends when every scenario PR is closed. Comment `/game finish` here to release early. To request a prepared revision when automatic review matching is unavailable, comment `/game revise <PR-number>` here. Revisions are limited and requesting one alone does not earn concern credit.",
      "Unsupported code changes do not stop the stage: affected assessments are marked unscored.",
    ].join("\n\n"),
    run,
  );
}
