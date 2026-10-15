import { createHash } from "node:crypto";
import { expectedFiles } from "../engine.ts";
import type { GitHubPull } from "../github-schemas.ts";
import type { GitHub } from "../github.ts";
import { authoredVariant, scenarioFor } from "../packages.ts";
import type { Persistence } from "../persistence.ts";
import type { Run } from "../types.ts";
import { pinBaseline, runRoot, SnapshotChanged } from "./shared.ts";

export async function reconcileRun(
  store: Persistence,
  r: Run,
  gh: GitHub,
  reviewPR?: number,
) {
  const { issues, proposals } = scenarioFor(r);
  const variant = (id: string, revision: number) =>
    authoredVariant(r, id, revision);
  await pinBaseline(store, r, gh);
  const root = runRoot(r),
    snapshot: Record<string, GitHubPull> = {};
  r.warnings = [];
  r.unverifiedIssues = [];
  const before = (await gh.reference(root, r.base!)).object.sha;
  for (const p of proposals) {
    const state = r.prs[p.id],
      pr = await gh.pull(root, state.number);
    snapshot[p.id] = pr;
    delete state.unscored;
    if (
      pr.head.sha !== state.head ||
      pr.base.ref !== r.base ||
      pr.head.repo?.id !== r.repository
    )
      state.unscored =
        "The PR branch or target differs from its prepared revision.";
    // Seeded/prepared commit IDs are immutable and their content was authored here.
    if (pr.merged_by && pr.merged_by.id !== r.player)
      state.unscored =
        "Another collaborator merged this PR; the player decision was not assessed.";
    state.outcome = pr.merged
      ? "merged"
      : pr.state === "closed"
        ? "closed"
        : "open";
    if (reviewPR === undefined || state.number === reviewPR) {
      const reviews = await gh.listReviews(root, state.number);
      state.reviews = reviews
        .filter(
          (x) =>
            x.user?.id === r.player &&
            x.state !== "DISMISSED" &&
            x.submitted_at,
        )
        .map((x) => ({
          id: x.id,
          body: (x.body ?? "").slice(0, 12000),
          state: x.state,
          commit: x.commit_id,
          submitted: x.submitted_at!,
        }));
    }
  }
  const groups = new Map<string, string[]>();
  for (const p of proposals) {
    if (r.prs[p.id].outcome === "merged" && p.group)
      groups.set(p.group, [...(groups.get(p.group) ?? []), p.id]);
  }
  for (const ids of groups.values())
    if (ids.length > 1)
      for (const id of ids)
        r.prs[id].unscored =
          "Both competing implementations were merged; their combined behavior is not covered by the rubric.";
  const expected = expectedFiles(r);
  const hash = createHash("sha256")
    .update(JSON.stringify(Object.entries(expected).sort()))
    .digest("hex");
  let files: Record<string, string> | undefined;
  try {
    files =
      before === r.tree && r.observedFiles
        ? r.observedFiles
        : await gh.tree(root, before);
  } catch (error) {
    if (
      !/^(Unsupported file type|Unsupported truncated tree|Oversized file)$/.test(
        error instanceof Error ? error.message : "",
      )
    )
      throw error;
    r.warnings.push(
      "Repository content could not be compared within the exercise limits.",
    );
    for (const p of proposals)
      if (r.prs[p.id].outcome === "merged")
        r.prs[p.id].unscored =
          "Merged content could not be verified within the exercise limits.";
    r.unverifiedIssues = issues.map((i) => i.id);
  }
  const after = (await gh.reference(root, r.base!)).object.sha;
  if (before !== after)
    throw new SnapshotChanged("Repository changed during assessment");
  for (const pr of Object.values(snapshot)) {
    const latest = await gh.pull(root, pr.number);
    if (
      latest.head.sha !== pr.head.sha ||
      latest.state !== pr.state ||
      latest.merged !== pr.merged
    )
      throw new SnapshotChanged("PR changed during assessment");
  }
  if (files) {
    const changed = [
      ...new Set([...Object.keys(files), ...Object.keys(expected)]),
    ].filter((path) => files![path] !== expected[path]);
    if (changed.length)
      r.warnings.push(
        "Default-branch changes outside the prepared contributions were detected.",
      );
    for (const path of changed) {
      const owners = proposals.filter(
        (p) => path in variant(p.id, r.prs[p.id].revision).files,
      );
      for (const p of owners) {
        if (p.issue) r.unverifiedIssues.push(p.issue);
        if (r.prs[p.id].outcome === "merged")
          r.prs[p.id].unscored =
            "The resulting file differs from the prepared contribution.";
      }
      // Shared code/configuration can affect every feature. Documentation alone cannot.
      if (!owners.length && !/\.(md|txt)$/.test(path) && path !== "LICENSE") {
        r.unverifiedIssues.push(...issues.map((i) => i.id));
        for (const p of proposals)
          if (r.prs[p.id].outcome === "merged")
            r.prs[p.id].unscored =
              "Changes outside the prepared contributions may affect the merged behavior.";
      }
    }
  }
  for (const p of proposals)
    if (r.prs[p.id].unscored) {
      r.warnings.push(`PR #${r.prs[p.id].number}: ${r.prs[p.id].unscored}`);
      if (p.issue && r.prs[p.id].outcome === "merged")
        r.unverifiedIssues.push(p.issue);
    }
  r.unverifiedIssues = [...new Set(r.unverifiedIssues)];
  r.observedFiles = files;
  r.tree = before;
  r.contentHash = hash;
  store.save(r);
}
