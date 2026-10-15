import { issues, proposals } from "./scenario.ts";
import type { Run, Assessment } from "./types.ts";
export const stageTitle = "Stage 1 — The Saturday launch";
export const contributorNotes: Record<string, string> = {
  a: "Maya, a volunteer frontend developer: “The residents asked for likes. I kept this small so we can ship before Saturday.”",
  b: "Theo, a regular contributor: “I took a different approach to likes. I had another neighborhood in mind when I wrote this, but I am open to a smaller version for Saturday.”",
  c: "Sam, helping with the launch: “Organizers keep spotting typos after posting. This adds the editing operation.”",
  d: "Priya, who runs a larger neighborhood group: “Our board already has more posts than one page can show. Here is the pagination helper.”",
  e: "Alex, a community user: “A few pasted titles have spaces around them. This is outside the launch checklist, but it bothered me enough to send a small fix.”",
  f: "Jo, a weekend contributor: “People want to see recently updated posts first. I added a sorting helper while looking through the library.”",
};
export function storyBody(run: Run): string {
  const lines = [
    `# ${stageTitle}`,
    "",
    "You have just taken over Pocket Board, a small open-source neighborhood noticeboard app. Its web UI and API already let residents read and create posts. Its original maintainer is away for a month. Your first message is from Lina, who organizes the local repair café:",
    "",
    "> “We are opening sign-ups on Saturday. Residents want to like useful posts, organizers need to correct their own titles, and the board needs to handle more than one page of posts. Can we get those basics ready without turning this into a rewrite?”",
    "",
    "Several volunteers have sent contributions. Two tackle the same feature in different ways; others spotted improvements outside the launch plan. You decide what belongs in this release and what should wait. Contributor names are fictional; all game PRs are posted by the App.",
    "",
    "## This milestone",
    "",
    "Deliver idempotent likes, owner-only edits, and bounded pagination. All three acceptance criteria must be satisfied. Keep the app small and safe; completing a checklist is not enough if the accepted changes introduce defects.",
    "",
  ];
  for (const issue of issues)
    lines.push(
      `- ${run.issues[issue.id] ? "#" + run.issues[issue.id] : issue.title}: ${issue.body}`,
    );
  if (run.milestone)
    lines.push(
      "",
      `[Milestone](https://github.com/${run.owner}/${run.repo}/milestone/${run.milestone})`,
    );
  lines.push("", "## Incoming contributions", "");
  for (const p of proposals)
    lines.push(
      `- ${run.prs[p.id] ? "#" + run.prs[p.id].number : p.title}: ${contributorNotes[p.id]}`,
    );
  lines.push(
    "",
    "## Your role",
    "",
    "Review the code, leave specific feedback, and merge or close contributions through GitHub. You are the maintainer: you do not need to write code. Do not edit the exercise branches directly. Approval alone does not merge a PR.",
    "",
    "Submit a request-changes review when something needs work. Comment `/game revise <PR-number>` here to ask for its next prepared revision when automatic comment assessment is unavailable. Asking for a revision does not by itself prove that you spotted the concern.",
    "",
    "The stage ends when all six scenario PRs are closed, merged or rejected. Comment `/game finish` here to release early; open PRs will count as deferred. The debrief explains what your decisions meant for the project. Review effort is informational; there is no ticking clock.",
    "",
    "This issue is your story hub. Read the individual issues for requirements and the PRs for proposed solutions. Later stages will continue the project story from a known baseline.",
  );
  return lines.join("\n");
}
export function storyEnding(result: Assessment): string {
  if (result.success)
    return "Lina can announce the Saturday release: residents can like posts, organizers can safely edit their own titles, and larger boards have pagination. You delivered the requested foundation without accepting the authored concerns. The project is ready for its next chapter.";
  if (result.harmful.length)
    return "The launch has a maintenance problem to resolve. Some accepted contributions brought the concerns described below into Pocket Board. Lina needs an honest release update: shipping features does not remove the responsibility to address those risks.";
  return "Lina has to narrow or postpone the Saturday announcement. Some launch requirements remain unfinished. You kept the stage free of accepted authored concerns, but the community still needs the missing features. The decisions below explain where delivery stalled.";
}

export const followups: Record<string, string> = {
  b: "**Theo:** “For context, another neighborhood asked me about emoji reactions last month. That is why I tried a pipeline. It is not committed to this release, though—happy to discuss whether the extra machinery earns its keep.”",
  d: "**Priya:** “One detail from our app: the page and size fields start as URL parameters before being converted to numbers. Most residents use the buttons, but people also share edited links. That is the path I would check as well as the normal first page.”",
};
export function revisionReply(run: Run, id: string): string {
  const identified = (run.findings[id] ?? []).some(
    (f) =>
      f.revision === 0 && ["identified", "consequence"].includes(f.category),
  );
  const acknowledgment = identified
    ? "Thanks for identifying the concern in your review."
    : "I have applied the prepared revision you requested.";
  const replies: Record<string, string> = {
    b: `**Theo:** “${acknowledgment} I have replaced the pipeline with a direct function. I can bring back a proposal for reactions if an actual issue calls for them.”`,
    c: `**Sam:** “${acknowledgment} The edit now checks who owns the post before changing it. Please give the revised permission boundary another look.”`,
    d: `**Priya:** “${acknowledgment} The revised helper rejects non-integers before checking bounds. I included that check for both offset and limit; please review the new version.”`,
    f: `**Jo:** “${acknowledgment} I found the shared ordering helper and now delegate to it. That keeps the feed and this helper on the same sorting policy.”`,
  };
  return replies[id] ?? "";
}
export function communityUpdate(run: Run): string {
  const result = run.result!;
  const lines = ["## Community update", ""];
  if (result.success)
    lines.push(
      "**Lina:** “I can send the Saturday announcement now. The like button, organizer edits, and longer boards have their foundation. Thank you for getting the essentials ready without turning launch week into a rewrite.”",
    );
  else if (result.harmful.length)
    lines.push(
      "**Lina:** “Let us hold the full announcement until the concerns in this debrief are resolved. I would rather explain a smaller release than ask the neighborhood to rely on something we already know needs attention.”",
    );
  else
    lines.push(
      "**Lina:** “I will update the repair café volunteers about what is ready and what still needs work. We can adjust the announcement. Please leave a clear handover for the remaining launch issues.”",
    );
  if (run.prs.a.outcome === "merged" && run.prs.b.outcome === "closed")
    lines.push(
      "",
      "**Theo:** “Maya’s version covers this milestone. I will keep the reaction idea for a separate proposal rather than hold up this release.”",
    );
  if (run.prs.e.outcome === "merged")
    lines.push(
      "",
      "**Alex:** “Glad the title cleanup made it in. It is a tiny change, but it saves us tidying up pasted notice titles.”",
    );
  else
    lines.push(
      "",
      "**Alex:** “The title cleanup can wait if the launch needs your attention. Please keep it on the community follow-up list.”",
    );
  lines.push(
    "",
    "These are scripted story responses to your decisions. They do not add points or claim that your review text was assessed.",
  );
  return lines.join("\n");
}
