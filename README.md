# Maintainer Sim

A GitHub-native maintainer training game. Choose a scenario, create a playthrough in your own account, and review contributions using native GitHub reviews, merges, and closes. Versioned scenario repositories provide the runnable app, story, prepared revisions, portraits, and deterministic rubric. Optional Jev matching assesses review concerns within a global budget.

The first packaged scenario is **Forum**: two stages, five initial roadmap issues, ten launch PRs, and a later notification release. Source code and authoring branches live in `rkkautsar/forum-scenario`. The original Pocket Board scenario remains available for legacy runs.

## Player quickstart

1. Open [Maintainer Sim](https://maintainer-sim.rkkautsar.workers.dev/).
2. Choose a scenario, connect GitHub, and confirm a new personal repository name and visibility.
3. Wait for preparation, then open Game Master issue **#1**.

The launch flow needs the GitHub App authorization/creation settings described in [launch configuration](docs/LAUNCH.md). Until configured, the page displays the scenario with connection disabled. No template copy is required for this flow.

The legacy [Pocket Board template](https://github.com/rkkautsar/pocket-board-template) still works: create a fresh repository from it, then install/add Maintainer Sim access to start automatically. The Pocket Board-specific CLI and walkthrough examples below are retained for compatibility. New scenarios use the [authoring guide](docs/AUTHORING.md).

## Run locally

Requires Node.js 24 or newer and npm.

```bash
cd ~/personal/maintainer-sim
npm ci --ignore-scripts
npm run check
npm test
npm run demo
```

The demo shows a completed stage with good decisions and the outcome-only debrief. Tests use local GitHub fixtures and an actual local HTTP server; no GitHub or paid model calls are needed.

## Create the player repository

Export **only** the public exercise assets to a new directory:

```bash
npm run cli -- export-template /tmp/pocket-board-template
```

Initialize that exported directory as a separate Git repository and push it to a disposable player-owned repository. You can mark it as a GitHub template for subsequent players, or fork it. Its root must exactly match the export. Start with no previous issues or PRs (including deleted ones), so Game Master receives #1. Do not copy this game-master repository: `src/scenario.ts` contains the hidden rubric and prepared answers.

GitHub Actions may remain enabled. The current template has no workflows; future authored CI should run tests/lint with read-only permissions and no secrets. The App never executes repository workflows or supplies them with credentials; unsupported code/workflow changes can make parts of the assessment unavailable. Avoid rulesets that prevent App branch creation or player merges. The prototype does not bypass protections. Each new stage/run uses a fresh repository so previous work is preserved.

## Register the GitHub App

Create an App with a secret and webhook URL ending in `/webhooks`. Select repository permissions:

- Contents: read/write
- Issues: read/write
- Pull requests: read/write
- Metadata: read (mandatory)

Subscribe to `installation`, `installation_repositories`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `issues`, and `push`. Install on the selected disposable repository, not all repositories. Save the App private key outside this project and set restrictive file permissions.

Copy `.env.example` to `.env`; fill App ID, key path, webhook secret, and `DISPOSABLE_REPO_CONFIRMED=true` only after verifying the prerequisites. The App needs no Actions or Administration permissions; enabling Actions does not require additional App access.

```bash
npm run cli -- seed INSTALLATION_ID REPOSITORY_ID OWNER REPO PLAYER_GITHUB_ID
npm start
```

The seed command prints the run ID before setup. If interrupted, inspect and resume it:

```bash
npm run cli -- status
npm run cli -- resume RUN_ID
```

Use numeric repository/user/installation IDs, not names in the numeric arguments. Find installation IDs in App installation settings; repository and user IDs are available in GitHub API responses.

For local development, forward public HTTPS webhooks to `http://127.0.0.1:3000/webhooks` through your chosen tunnel or GitHub webhook forwarding tool. Update the App webhook URL and keep the secret identical. `/health` returns `ok`. The service binds localhost intentionally. A hosted pilot needs persistent storage and a reverse proxy with TLS.

## Play

Review the six PRs in GitHub. Issue #1 introduces the Saturday launch, contributor motivations, and milestone links. The milestone requires idempotent likes, owner-only edits, and bounded pagination. The debrief teaches specific review habits: numerical edge cases that pass ordinary tests, ownership checks, and searching existing repository helpers before accepting duplicated code. There is a competing implementation and two unsolicited contributions. PR quality is not disclosed before the debrief.

- Merge good implementations; close alternatives or harmful submissions.
- Request changes through a submitted GitHub review.
- With outcome-only mode, comment `/game revise 3` in the **Game Master issue**, replacing `3` with the target PR number. This applies its next prepared patch and earns no automatic concern credit.
- Prepared paths are finite; some sound PRs have no revision. The App explains when a path is exhausted.
- The stage automatically finishes when all six scenario PRs close. Comment `/game finish` in the Game Master issue to finish early; remaining PRs count as deferred.

Only the designated player's commands and reviews are accepted. A review approval is not a merge. Answers and the authored debrief appear at stage finish. Open community improvements can be deferred; missing milestone implementations remain incomplete.

The game continues when repository content differs from the prepared scenario. Edited PRs, collaborator merges, and competing implementations are marked unscored where the rubric no longer applies. Unverified milestone requirements are reported separately, and excluded decisions do not count toward the available points. Unrelated documentation changes produce a note. Automatic revisions never overwrite an edited branch. Temporary API failures and changing snapshots retry automatically; removing App access stops processing until access is restored. Older paused runs recover on their next reconciliation. Each run pins its starting baseline. For a replay, create a fresh repository; there is no destructive reset command.

## Optional Jev

Disabled by default. It classifies review text against a curated concern; it cannot change outcome scores or execute code. Without it, the complete game and prepared debrief still work.

Before enabling, compare provider results against human-labelled reviews (including vague, wrong, specific, consequence-aware, and adversarial examples). `scenario/private/judge-examples.json` supplies starter examples, not a validated benchmark. Only after calibration set:

```text
JEV_API_KEY=<provider key>
JEV_CALIBRATED=true
JEV_MODEL=jev-1.13.0
JEV_CONFIDENCE_THRESHOLD=0.9
JEV_INPUT_USD_PER_MILLION=<verified current input price>
AI_DAILY_BUDGET_USD=1
```

The threshold is provisional. Jev can get judgments wrong; this project does not claim measured grading accuracy. Current-head submitted reviews are assessed; previous findings survive prepared revisions. Inline comments attached to the submitted review are included. A confidently matched request-changes review applies its next prepared revision; review commands remain available when the judge cannot assess.

Budget days reset at **00:00 UTC**. SQLite atomically reserves a conservative 32K input-token charge for each request, which is limited to 24KB of serialized context. Reservations are retained even on failure or uncertainty; this favors under-spending over retries. There are no automatic judge retries. Assessments—including failed attempts—are keyed by bounded content, model, and classifier configuration. Repeated delivery processing cannot charge again for the same assessment. This is a conservative application gate, not a guarantee against provider pricing changes or other uses of the same API key. Hosting and GitHub costs are separate.

## Recovery and operations

SQLite in `var/game.sqlite` persists runs, queued deliveries, revision intents, and budget reservations. Back up the database with SQLite-aware tooling; keep one service process and avoid running seed/resume concurrently with the service. One worker serializes events; reconcile jobs run every minute to recover missed webhooks.

Transient GitHub failures retry at bounded exponential intervals (five attempts), then remain visible in the database. After fixing access/network issues:

```bash
npm run cli -- retry-deliveries
```

Interrupted revision publication records the intended commit before updating GitHub; retry reconciles that intent. Interrupted result publication resumes on service startup and finds the existing marked bot comment. GitHub writes cannot be fully transactional: changing snapshots retry, while stable unsupported edits produce partial assessments. Closing/reopening a PR after the final debrief does not alter its frozen result.

## Boundaries and validation

Implemented: deterministic scenario/scoring, prepared revisions, resumable seeding, installation-token authentication, signed durable webhooks, authorization, content reconciliation, early/automatic finish, optional judge with budget/fallback, and local tests.

Live GitHub App installation and automatic seeding have been verified on a disposable playthrough repository. A paid Jev call has not been verified yet. All code comparisons use exact authored tree content, so merge/squash/rebase identity does not determine scores. This is a learning game, not anti-cheat: content-equivalent edits and public answer sharing are outside the threat model.

Never execute player code in the service. The exercise's known source is tested locally during development; runtime assessment reads content only. App/model keys are not embedded in player assets or judge context. Public player repos expose contributions and discussion, so do not use sensitive source.

The prototype has one stage and one prepared fix per flawed PR (below the three-round cap). Add new stages by authoring fixed scenarios and validating supported paths before adding live generation. See `HANDOFF.md` for the agreed product design.

Reference: [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [TypeSafe API](https://docs.typesafe.ai/introduction/quickstart).

## Cloudflare deployment

The hosted implementation is in `src/cloudflare/worker.ts` with `wrangler.jsonc`. It uses one SQLite-backed Durable Object per **GitHub installation**, so installation-wide access-removal events can be handled without an extra registry. That object durably queues events and serializes game mutations through alarms. A separate, shared Durable Object coordinates the global AI budget.

Use **Workers Paid for the initial hosted pilot**: seeding and reconciliation can exceed the Free plan's subrequest limit. Infrastructure charges are separate from the AI budget. Idle reconciliation runs every ten minutes, rather than polling each repository every minute. GitHub rate limits still apply.

```bash
npm run test:cf
npm run cf:dev
```

The local runtime tests exercise workerd, real Durable Object SQL, concurrent budget claims, alarms, and RSA signing with a generated test key. External GitHub requests are intercepted; these tests make no paid AI calls. Copy `.dev.vars.example` to `.dev.vars` for local configuration. Local AI bindings may call a remote model when enabled, so leave `JEV_CALIBRATED=false` until you intentionally test the provider.

For deployment, authenticate Wrangler in your own Cloudflare account, then provision secrets:

```bash
npx wrangler login
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_PRIVATE_KEY < /path/to/app-private-key.pem
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_TOKEN
npm run cf:deploy
```

`ADMIN_TOKEN` must contain at least 32 random characters. The hosted App private key is a secret string, not a filesystem path. Use a PKCS8 PEM key; convert a GitHub PKCS1 key locally if necessary with `openssl pkcs8 -topk8 -nocrypt -in original.pem -out app-private-key.pem`. Store it outside the project. Change the GitHub App webhook URL to `https://YOUR_WORKER.workers.dev/webhooks`.

Set `WORKER_URL` and `ADMIN_TOKEN` in local `.env`, plus `DISPOSABLE_REPO_CONFIRMED=true` after verifying repository prerequisites. Start and inspect a hosted run:

```bash
npm run cf:cli -- seed INSTALLATION_ID REPOSITORY_ID OWNER REPO PLAYER_ID
npm run cf:cli -- status INSTALLATION_ID
npm run cf:cli -- retry INSTALLATION_ID
```

Hosted seeding returns a run ID immediately; its durable alarm completes setup. Retry requeues failed jobs without deleting player work. Operator endpoints require the admin token; players use GitHub commands. Status may contain private assessment data and must not be exposed publicly.

### Jev through Cloudflare

The hosted judge uses `env.AI.run('typesafe/jev', ...)`. Configure Cloudflare model access/billing and verify the current price before setting `JEV_CALIBRATED=true`. Set `AI_GATEWAY_ID` in Wrangler variables to route inference through your AI Gateway; request-body logging is disabled, caching is skipped, and Gateway retries are restricted to one attempt. Keep Gateway-level retries disabled as well. No provider key is sent to player repositories.

`AI_DAILY_BUDGET_USD` defaults to **$1 per day globally**, resetting at 00:00 UTC. Before a call, reserve the price of 32K input tokens for a request bounded to 24KB. After a response with valid usage, settle that reservation to its reported input tokens exactly once. Uncertain answers still settle valid usage; missing usage, crashes, or failures retain the full reservation and never automatically retry the same paid assessment.

When the next reservation cannot fit, concern identification is not assessed. PR outcome scoring, prepared revisions, milestone progress, and curated debrief continue. At $0.042/M, 1,000 stages with six 2K-token calls each estimate **$0.504 in inference**. Actual call count and context size matter. Gateway credit-purchase fees and hosting are outside the inference cap. The local direct-provider judge retains its earlier conservative reservation behavior; settlement is implemented in the hosted adapter.

This repository is deployment-ready locally, but live Cloudflare, GitHub, and Jev access still need the operator's account/credentials and a disposable walkthrough. No hosted resources have been provisioned by this implementation task.

### Human story exchanges

Contributor context appears as two scripted PR follow-ups: Theo explains his reaction-pipeline motivation, and Priya describes the real URL-input path that reviewers should investigate. Prepared revisions receive contributor replies. When semantic assessment is unavailable, replies acknowledge the requested revision without claiming the player identified a concern. Stage completion includes Lina's community update, with additional reactions determined by accepted/deferred work. Comments are marked and persisted to avoid duplicates on replay. These exchanges add no points and require no model calls.

## Run the player app

Pocket Board is now a runnable full-stack exercise: a vanilla browser UI, Node.js API, and SQLite database. From the simulator project, run `npm run board` and open http://localhost:3001. It lists seeded notices and lets demo users create posts before any PR is merged. Likes, editing, and pagination are pending milestone implementations. Restart after merging to load them.

The exported player repository also runs independently with `npm start`, with no package dependencies. Demo user selection is intentionally local role switching, not production authentication; the server binds localhost. Data is stored in ignored `data/board.sqlite`. Runtime files must not be committed into the exercise. The game master does not run submitted code; the player may run their disposable app locally.

The initial full-stack source is tested as a working baseline and with all authored fixes applied, including persistence across restart, like idempotency, API ownership enforcement, and malformed pagination. New app assets change the expected baseline: use a fresh template export for new runs rather than an older library-only repository.

## Automatic player onboarding

Create a fresh repository from `rkkautsar/pocket-board-template`, then install the configured GitHub App on it (or add the repository to an existing installation). The signed `installation.created` or `installation_repositories.added` webhook queues setup automatically. The human who installs/adds the repository becomes the designated player.

Before creating any milestone, issue or PR, onboarding checks the exact public baseline and that the repository has no existing issues/PRs. The template itself, archived repositories, unrelated codebases, and repositories already in a run are skipped. Retried setup resumes without duplicate stage objects. Actions may stay enabled. The operator seed CLI remains available for troubleshooting.

Automatic onboarding requires the GitHub App registration, installation webhook delivery, and App secrets to be configured in the Worker; publishing a template alone cannot grant repository access.

## Scenario repositories and the launch page

The Worker now serves a launch page at `/`. Players choose a scenario, connect GitHub, and create a personal playthrough repository without copying a template. GitHub App OAuth/client-secret and repository-creation permissions must be configured before this flow is available; see [launch configuration](docs/LAUNCH.md).

The first packaged scenario is **Forum**, a runnable community forum with posts, comments and SQLite. Its first stage has five roadmap issues and ten contributions: competing voting/search approaches, comment editing, pagination, bookmarks, and three unsolicited improvements. A second stage introduces personal reply notifications. Contributions include API/UI changes and plausible tests, with authored defect witnesses and bounded prepared revisions. Character portraits appear inside App-authored PRs and comments.

Author scenarios as real repositories with `__scenario__` Markdown/YAML and branches such as `stage/launch/base`, `stage/launch/comment-edit/initial`, and `stage/launch/comment-edit/rev-1`. See the [authoring guide](docs/AUTHORING.md). `npm run scenario -- validate REPO` checks structure and refs; `publish` writes an immutable package; `preview` exports a local runnable snapshot and review document. Publishing never executes source code.

The runtime resolves content through `src/packages.ts`; new runs pin scenario ID, version, stage and digest. The original Pocket Board package remains the fallback for legacy runs. Keep released package files when publishing a new version. Player history contains only clean application code, not `__scenario__`, rubrics, future fixes or authoring commits. After a packaged stage finishes, comment `/game next` in Game Master issue #1 to advance while preserving prior work and results.
