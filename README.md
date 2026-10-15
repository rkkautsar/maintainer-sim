# Maintainer Sim

Practice maintaining a real open-source project through GitHub reviews. Follow the story in Game Master issue #1, inspect competing contributions, request prepared revisions, and decide what to merge or close. Each stage has a milestone, linked issues, unsolicited PRs, and a debrief about delivery, defects, and maintenance costs.

[Play](https://maintainer-sim.rkkautsar.workers.dev/) · [GitHub App](https://github.com/apps/maintainer-sim) · [App settings](https://github.com/settings/apps/maintainer-sim) · [Install App](https://github.com/apps/maintainer-sim/installations/new)

The first scenario is **Forum**: a runnable Node.js/SQLite forum with a browser UI, five initial roadmap issues, ten launch PRs, and a second notification stage. Its [authoring repository](https://github.com/rkkautsar/forum-scenario) holds real stage and contribution branches. Player repositories contain application code; the game service keeps the rubric and prepared answers.

## Play

1. Open the launcher and sign in with GitHub.
2. Choose a scenario and a new repository name. Repositories are private by default; public is an option.
3. Install the App or approve repository access when prompted, then retry setup.
4. Follow Game Master issue #1 in the created repository. Clone the repository and run its app to investigate behavior while reviewing.

A stage ends when all its PRs are merged or closed. Comment `/game finish` in issue #1 to end early, `/game revise <PR-number>` to request a prepared revision, or `/game next` after a stage finishes to advance. Each new stage starts from its authored baseline on a new branch and preserves earlier results.

Direct code edits remain possible on GitHub. Unsupported changes mark affected assessments unscored; they do not pause the game. Contributor portraits identify fictional characters. GitHub shows the App as the actual author.

## Run and verify

Requires Node.js 24 or newer.

```bash
npm install
npm run check
npm test
npm run test:cf
npm run demo
```

`demo` prints a deterministic Forum debrief without contacting GitHub or an AI service. `test:cf` builds the Worker and runs the Cloudflare runtime tests with mocked GitHub calls.

Copy `.env.example` to ignored `.env` for local configuration. Never commit credentials. For local Worker development:

```bash
npm run cf:dev
```

The Node webhook service is also available with `npm start`; the player launch page runs in the Worker. The Worker serves the launcher, OAuth callbacks, public catalog, contributor portraits, signed webhooks, and protected operator endpoints. Durable Objects persist sessions, launch jobs, game state, webhook retries, and the shared AI budget.

## GitHub App and deployment

See [launch configuration](docs/LAUNCH.md) for the App callback, setup URL, permissions, and secrets. Sign-in stays unavailable until the App client secret is configured. Existing installations must approve permission changes before repository creation works.

```bash
npm run cf:deploy
```

Contents, Issues, and Pull requests need write access; Metadata needs read access. The launcher also needs repository-creation permission through user authorization. Installation and repository-access events handle access changes; installing the App alone does not create a game.

Webhook payloads require a valid signature. Commands and review credit are restricted to the designated player. Tokens stay on the server, and player repository code is never executed in the game service. OAuth uses expiring one-use state, PKCE, a secure session cookie, and CSRF protection. New games are limited to five per authenticated account per UTC day. Repository creation and seeding are durable and retryable.

## Author scenarios

See [the authoring guide](docs/AUTHORING.md). A scenario is a real Git repository with `__scenario__` annotations, contributor portraits, stage baseline branches, initial PR branches, and revision branches. For example:

```text
stage/launch/base
stage/launch/comment-edit/initial
stage/launch/comment-edit/rev-1
```

The authoring CLI validates branch diffs and annotations, previews content, exports clean application code, and publishes immutable packages. The service resolves runs by scenario ID, version, stage, and digest. Retain released package versions while their playthroughs exist.

```bash
npm run scenario -- validate /path/to/scenario
npm run scenario -- preview /path/to/scenario
npm run scenario -- export /path/to/scenario /tmp/playthrough
```

Run `npm run scenario` for all commands and arguments. The Worker build bundles the published files in `scenario-packages/`.

## Scoring and AI

Roadmap progress and merge/close outcomes use the authored rubric. The debrief explains accepted defects, maintenance debt, and missed requirements. Review effort is informational. Without a calibrated judge, review wording is explicitly unassessed; requesting a revision alone does not earn concern-identification credit.

The deployed trial uses **Cloudflare Clef-flash** to match review text to curated concerns. Read [judge configuration and calibration](docs/JUDGE.md) for the measured results and limitations. A matching request-changes review can trigger its prepared revision; `/game revise <PR-number>` remains available when matching abstains.

Optional review coaching appears in the stage debrief: clarity and constructiveness, substantive concerns, subjective nits, and possible formatter/lint candidates. It is advisory and has no effect on points, concern credit, prepared revisions or release success. It covers submitted GitHub reviews and their attached inline comments, with at most four coaching attempts per PR. Uncertain dimensions are omitted.

All judge and coaching calls use bounded context, cached results and atomic reservations against the shared **$1 per UTC day** inference cap. At the cap or on model failure, deterministic outcomes and debriefs continue. Clef-flash uses the existing Workers AI binding and standard billing, eligible for the shared daily Neuron allowance. The cap conservatively counts list-price usage before that free allowance. There is no live AI code generation in this version.

## Operator commands

Set `WORKER_URL` and `ADMIN_TOKEN` in ignored `.env`:

```bash
npm run cf:cli -- status INSTALLATION_ID
npm run cf:cli -- retry INSTALLATION_ID
```

For manual troubleshooting, export the selected stage into a fresh disposable repository first, then seed with an explicit package:

```bash
DISPOSABLE_REPO_CONFIRMED=true npm run cf:cli -- seed INSTALLATION_ID REPOSITORY_ID OWNER REPO PLAYER_ID forum 0.1.0 launch
```

The local CLI provides equivalent `seed`, `status`, and `retry-deliveries` commands. `resume RUN_ID` retries interrupted local seeding or result publication.
