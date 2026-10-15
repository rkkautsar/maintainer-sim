# GitHub-native maintainer simulator — agreed MVP

## Codex task

Build a deterministic maintainer training game with GitHub as the interface and a GitHub App as game master. Start with the offline scenario engine, then GitHub integration, then optional Jev assessment. Deliver code, meaningful tests, and setup documentation. Use fixtures until the operator supplies credentials and a disposable target repository. No frontend.

## Purpose and scope

Train developers to review AI-generated contributions: correctness, requirements, overengineering, duplication, brittle tests, and scope/risk judgment. Players already know GitHub and TypeScript. They review contributions rather than write code.

The game controls baselines, milestones, issues, PRs, revisions, and expected outcomes. Initial PRs can be AI-generated during authoring but are predetermined and human-validated before release. Runtime revisions are prepared patches. Do not build arbitrary-code evaluation or live contributor AI.

Prototype: 1 stage, 1 milestone, 3 roadmap issues, 6 PRs, and a separate Game Master issue. Four PRs target issues, including one competing pair; two are unsolicited community fixes/improvements. Full stages target 5–7 issues and 10–15 PRs, roughly two thirds milestone-related. Later stages follow a coherent project roadmap but reset to known baselines.

## Player loop

1. Player creates a repository from our template (preferred) or forks the base, then installs the App on that selected repository. Operator CLI starts a run.
2. App seeds the milestone, issues, branches, PRs, and Game Master issue.
3. Player uses native reviews, comments, request changes, merge, and close. Approval alone does not apply code. Prepared revisions update the same open PR.
4. Stage ends automatically when every scenario PR is closed, merged or rejected. Player may finish early with `/game finish` on the Game Master issue.
5. Freeze assessment and publish one debrief. On early finish, open PRs count as deferred and unresolved requirements remain incomplete; do not automatically close or merge them.

## Authored scenario model

Each stage contains a public baseline and content plus a private answer sheet. Each PR/revision defines:

- Stable identity, public patch/body, optional target issue, dependencies, and competing alternatives.
- Acceptable actions for the current state: merge, close, request changes, defer.
- One primary concern for flawed PRs, with evidence and expected review concepts. Include sound contributions too; every PR must not be a trap.
- Prepared revision transitions, maximum rounds (default three), and authored effects on milestone progress, defects, and debt.
- Explicit points, success conditions, and prepared debrief text.

Every issue has at least one sound implementation, initially or through revision. Competing approaches may both be acceptable: merging one resolves the issue and closing its alternative is sensible. Penalize complexity only when its unnecessary cost is concrete. Unsolicited work may be useful or flawed; reasonable deferral is acceptable.

Choose independent patches where possible. Explicitly author and validate supported competing/overlapping merge and revision paths. Unexpected content/conflicts pause assessment instead of invoking general code analysis.

## Scoring

Report milestone completion, decision quality, and concern identification separately.

- Milestone completion follows authored implementations and acceptance criteria, not GitHub issue closure alone. Serious authored defects prevent a successful stage outcome.
- Decision quality follows authored state/action rules. Code calculates points and health effects; no universal inferred repository-health formula.
- Optional concern identification matches review comments to expected concerns. Give no credit for volume or merely invoking a revision command.

Review effort is informational; no tight budget in the first version. Debrief each PR with its revision at the time, expected concern, consequence, decision, and better review action. Preserve credit for identifying a defect before its fix. Reveal answers only after stage finish.

## Jev and deterministic fallback

Jev only classifies review text against the known concern, e.g. absent, vague, identified, identified with consequence. It does not discover ground truth, calculate milestone completion, or generate debrief prose. Send bounded relevant context rather than the entire repository each time. Validate typed responses; version configuration and establish confidence thresholds using human-labelled reviews.

A reliably matched request-changes review can unlock the next prepared revision. When assessment is unavailable or uncertain, authorized `/game revise <PR-number>` on the Game Master issue requests it. The command itself earns no reasoning credit. Explain exhausted revision paths.

Fallback: score PR outcomes and milestone completion, show prepared debrief, and label concern identification “not assessed,” without penalty. No judge dependency blocks completion.

Use a replaceable, optional judge adapter. Configure a US$1 global daily AI budget initially; declare reset timezone. Atomically reserve maximum request costs before dispatch, bound inputs/output where applicable, calls, retries, and concurrency, and cache assessments by run/PR/review-version/judge-config. Verify provider pricing when enabling it; do not hardcode assumed rates. Duplicate events must never incur duplicate charges.

## Architecture

Defaults: TypeScript/Node.js, Octokit, small HTTP service, SQLite, operator CLI, durable job table. Keep GitHub transport separate from a pure deterministic state/scoring engine.

Persist run/stage versions, installation/repository/player IDs, baseline and expected content identities, GitHub object IDs, actions/reviews, revisions, delivery IDs, assessments, budget reservations, and finish publication state. States: seeding, active, finishing, finished, paused, recoverable failure.

Seed with stable markers/checkpoints; resume partial failures without duplicates. Serialize mutations per run. Finish reconciles authoritative GitHub state, prevents queued revisions from publishing afterward, freezes a consistent snapshot, and posts one result. Detect concurrent changes rather than scoring a mixed snapshot.

Public assets and private rubric must be separate. Never put answers in player-visible history, branches, tests, comments, or logs.

## GitHub integration and security

Permissions: Contents read/write, Issues read/write, Pull requests read/write, mandatory Metadata read. Confirm endpoint requirements during implementation. No Administration, Workflows, Actions, organization, or user permissions.

Events: installation, installation_repositories, pull_request, pull_request_review, pull_request_review_comment, issue_comment, issues, push. Handle merged versus closed, reopen, synchronize, dismissed reviews, and access removal. Authorize commands to the designated player and expected Game Master issue. Ignore App feedback loops and non-scenario PRs for completion.

Verify raw-body HMAC-SHA256 signatures with constant-time comparison. Durably record validated deliveries, acknowledge promptly, then process. Deduplicate delivery IDs, reconcile missed/reordered events, and bound retries with rate-limit handling.

Keep App/provider credentials in the trusted service outside source control/logs. Scope short-lived installation tokens to the selected repository. Never execute player code in the App service. Judge inputs are untrusted data; its outputs cannot execute code or mutate repositories.

Use disposable game repositories. GitHub Actions may remain enabled; authored CI should use read-only permissions and no secrets. Validate the known baseline and reject unexpected workflow changes. Bound comments/patches, authorize runs, and rate-limit per player and globally.

Support merge/squash/rebase for known authored content without relying only on original commit ancestry. Associate reviews with revisions. Detect player edits, altered heads, unexpected collaborator changes, and reversions; pause scoring and offer a fresh-stage restart while preserving work.

## GitHub limitations

Template creation/forking is manual in v1; App installation/access is not inherited from upstream. Prefer independent template repositories. Branch protection/rulesets may block seeding or merging: report setup failures, never bypass them. API writes are nontransactional and require recovery. Public runs expose source/discussion; this is training, not tamper-proof competitive scoring. Use original licensed source or preserve verified reuse rights and attribution.

## Implementation milestones and acceptance

1. Offline scenario: author 3 issues/6 PRs, transition graph, private rubric, scoring, and debrief. Test good/harmful decisions, competing valid choices, unsolicited deferral, revisions, and early finish.
2. Seeding: start CLI and App setup guide. Exactly 1 milestone, 3 roadmap issues, 6 PRs, 1 Game Master issue. Interrupted setup resumes without duplicates or rubric leaks.
3. Events: signed endpoint, durable queue/ledger, reconciliation, revision commands, automatic/early finish. Duplicate/reordered events preserve scores and publication count. Supported merge methods work; unexpected edits pause scoring.
4. Optional Jev: validate against labelled reviews. Uncertainty, failure, or exhausted budget uses outcome-only fallback. Commands still unlock prepared revisions; concurrency respects budget reservations.
5. End-to-end: native review-to-finish walkthrough publishes one stable debrief. Restart and API failure recovery work. README covers permissions/events, local webhook forwarding, secret-free environment example, repository prerequisites, start/revise/finish/reset, and budget configuration.

## Delivery boundary

Implement locally first. External App installation, template publication, and repository seeding require an operator-supplied authorized target and credentials. Defer frontend, live contributor generation, arbitrary-code execution/evaluation, competitive anti-cheat, and complex infrastructure. Routine implementation choices can follow the defaults above.
