# Independent review — Cloudflare and gameplay

A separate reviewer agent inspected hosting correctness and the game design. Findings resolved:

- Feature delivery and maintainability were conflated. Overengineered likes now satisfy functional milestone criteria while retaining debt and decision penalties.
- Immutable-like acceptance wording contradicted the unchanged-object return path. Unchanged identity is now explicitly allowed.
- Fake GitHub numbering used independent issue and PR counters. Fixtures now share the repository number space.
- Enabled judge behavior lacked integration coverage. Tests now verify automatic prepared revision, preserved original concern finding, and unavailable-judge fallback.
- Seed operations exceed the Workers Free subrequest limit. The initial hosted pilot requires Workers Paid; README states that infrastructure is separate from inference cost.
- Frequent idle reconciliation risked installation rate limits. Hosted idle checks now run every ten minutes.
- Infrastructure failures incorrectly returned HTTP 400. Malformed JSON returns 400; temporary service failures return 503.
- Typechecks and bundling did not prove workerd compatibility. Local runtime tests now execute SQL transactions, concurrent budget claims/settlement, durable alarms, and GitHub App RSA signing.

The reviewer found no new budget-cap blocker after settlement changes: claims reserve maximum cost atomically, actual-usage settlement can reduce that amount only once, and missing usage retains the full reservation. Seed uniqueness is also rechecked transactionally after scheduling the alarm.

Verification: 31 game/service tests plus 3 Cloudflare runtime tests, TypeScript checks, deployment dry-run, and dependency audit. No live Cloudflare deployment, GitHub App installation, or paid Jev call was performed. Generated-review quality still requires human-labelled calibration before enabling semantic credit.
