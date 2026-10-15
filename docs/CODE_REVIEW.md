# Code quality review

Reviewed on 2026-10-15. This records the remaining shortcuts after extracting the launcher into static files, adding repository formatting, and preparing CI/CD. These are concrete maintenance concerns, not confirmed security vulnerabilities. The deployment job still needs a dedicated Cloudflare API token before its first successful run.

## Fix next

1. **Typed integration boundaries.** `src/github.ts` returns `any` from every generic REST operation, and event/AI response handlers also use `any`. This weakens TypeScript exactly where external data enters the app. Introduce typed GitHub operations and explicit parsing of the webhook fields the game consumes. Validate AI output as `unknown` before narrowing it. Keep raw transport handling inside adapters.

2. **Application orchestration is concentrated.** `src/game.ts` handles seeding, reconciliation, review processing, revisions, progression, and publishing. `src/cloudflare/launch.ts` combines OAuth, sessions, quotas, job progression, and repository provisioning. Split by these responsibilities while keeping one explicit orchestration path. File length alone is not the problem: unrelated reasons to change are mixed together.

3. **Persistence exposes SQL to application logic.** The `Persistence` interface exposes `db.prepare()`, and `Game.revise()` writes delivery records directly. Replace that boundary with operations such as recording/recovering revision intents and managing queued deliveries. Keep SQL in the storage adapters. Do not add a general repository framework to achieve this.

4. **Failure handling loses diagnostic information.** GameSession retries failed deliveries without storing their error reason; the AI adapter catches failures and returns `undefined`. Gameplay fallback is appropriate, but operators cannot easily distinguish rate limits, missing permissions, budget exhaustion, invalid output, or provider failures. Add structured, redacted diagnostics and typed fallback reasons. Never log tokens, raw webhook bodies, or complete review/model payloads by default.

5. **Local and production AI implementations differ.** `src/judge.ts` uses the direct Jev API and local reservations; `src/cloudflare/judge.ts` uses Clef-flash, settled usage, and coaching. `Game` also selects its default judge from process environment variables. Make dependency wiring explicit at entry points and share classification/validation behavior. Either deliberately support the direct provider through an adapter or remove it; avoid maintaining two drifting implementations.

## Address before wider use

6. **State retention and evolution are implicit.** Completed delivery rows, charge/cache rows, and historical runs have no general pruning policy. Runs are JSON blobs without an explicit persisted-state schema version or migration path. Define retention windows and recovery behavior before changing stored fields. Keep daily spending accounting correct when expiring caches; do not simply delete current-day reservations.

7. **Reconciliation is deliberately broad.** Each event can iterate installation runs and fetch all stage PRs, reviews, and repository content. This favors correctness for the current scenario size but creates unnecessary GitHub requests as usage grows. Measure calls per event, route repository events to relevant runs, and use targeted refreshes while retaining periodic full reconciliation. Avoid claiming current scale capacity without measurements.

8. **Launcher rendering still contains a scenario-specific illustration.** `public/app.js` renders a hard-coded Forum mockup even though the catalog is generic. Move presentation data into the public scenario catalog when a second scenario is added. The page can remain vanilla JavaScript; a framework is not required.

## Keep

The deterministic assessment functions, version-pinned scenario packages, persisted mutation intents, replay-safe feedback publication, separate advisory coaching, and executable bug witnesses are useful foundations. Plain HTML/CSS/JavaScript, SQLite, and curated PRs fit the project’s scope. Replacing them with more frameworks or infrastructure would not by itself improve the code.

Existing tests cover meaningful behavior, including interrupted mutations, unsupported edits, score invariance, and authored defects. Maintain those tests through the refactors above. Add linting rules for unsafe typing and unused declarations alongside the typed-boundary cleanup, rather than treating a passing formatter as proof of code quality.
