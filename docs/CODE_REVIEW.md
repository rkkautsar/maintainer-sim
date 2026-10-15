# Code quality review

Reviewed on 2026-10-15 against the current source tree. The earlier cleanup items have been addressed in the integrated refactor. Verification is recorded in GitHub Actions and the deployment probes.

## Resolved findings

- **External data has typed boundaries.** GitHub response wrappers and webhook parsing validate `unknown` values with Zod schemas before game logic consumes them. GitHub identifiers and nested response fields are checked at the adapter boundary. Persisted runs also pass a Zod schema when encoded and decoded.
- **Game and launch responsibilities are split into modules.** `src/game.ts` keeps the orchestration path while `src/game/` holds reconciliation, review assessment, revisions, progression, provisioning, messaging, and result publishing. `src/launch/` separates routes, authentication, authorization security, presentation, provisioning, error handling, and related types. The Worker remains the production entry point.
- **Persistence operations have named boundaries.** The `Persistence` interface exposes `save`, `get`, `all`, `forRepository`, `recordRevision`, `revisionIntents`, and `clearRevision`. SQL storage in `src/storage/sql-store.ts` owns delivery operations such as `enqueue`, `nextDelivery`, `completeDelivery`, `failDelivery`, `retryFailed`, and `prune`; game modules do not issue SQL directly.
- **Persisted state has an explicit envelope and migration path.** New records use `{ schemaVersion: 1, run }`; `decodeRun` also accepts the former bare `Run` as version zero. Unknown future envelope versions fail validation instead of being guessed. Completed pre-package prototype records are archived verbatim before leaving the current run index; they are not reinterpreted as current scenarios.
- **Failure diagnostics are structured and redacted.** `src/diagnostics.ts` maps errors to safe categories and serializes only allowlisted fields. The Worker exposes authenticated `/admin/diagnostics?installation=...`; game reconciliation logs structured events with GitHub request counts. Raw webhook bodies, credentials, and full provider responses are not included in these diagnostics.
- **Lint and CI cover source quality.** ESLint enforces `no-explicit-any` and unused declarations in `src/`. The CI workflow is configured for formatting, lint, TypeScript, tests, Cloudflare runtime checks, generated-package consistency, and a gated main-branch deployment with public health and asset probes.
- **The launcher preview is scenario data.** Cards render public catalog metadata through DOM operations, without a hard-coded Forum illustration or `innerHTML`.
- **AI dependency wiring is explicit.** The obsolete direct runtime provider is removed. Production and `cf:dev` use the same Cloudflare adapter; Node webhook mode is deliberately deterministic. Provider comparisons remain isolated in the calibration script.
- **Retention is explicit for disposable records.** Completed delivery deduplication records and AI cache/billing rows are retained for 30 days. Pending deliveries, failed deliveries, and revision mutation intents are not pruned by that policy. Historical runs are kept so earlier stages remain available to the `/game next` flow.

## Deliberate tradeoffs

- Reconciliation still refreshes scenario state from GitHub to recover missed events and verify authored changes. The implementation records GitHub request counts for diagnostics; no throughput or scale capacity is claimed here.
- The launcher remains plain HTML, CSS, and JavaScript; adding a frontend framework is not necessary for the current interface.
- Gameplay scoring is deterministic. The Cloudflare Worker can use its configured AI reviewer for concern matching and advisory coaching, but the Node webhook service defaults to unassessed review text. Missing or uncertain model output never decides score or blocks deterministic outcome handling.
- Scenario releases are immutable and version-pinned. Historical runs keep their original scenario identity, so published packages needed to resolve those runs must remain available.
- The boundary schemas validate the fields the service consumes and discard unrelated GitHub payload fields. They are intentionally adapters for this product's required data, not a general GitHub API client model.

Use the CI workflow and production probes for current test and deployment evidence.
