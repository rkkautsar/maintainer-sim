# Try the Jev review judge

The game always scores authored outcomes deterministically. Jev optionally matches a player's review text to an expected concern; it does not invent the rubric, score arbitrary code, or generate revisions.

Cloudflare's `typesafe/jev` model requires prepaid AI Gateway credits. A paid Workers plan alone did not satisfy this requirement in the live test: Cloudflare returned `2021: Insufficient AI Gateway credits`. Add credits through [AI Gateway Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/). Credentials remain in Wrangler's authenticated environment; no provider key is sent to the browser.

## Calibration

```bash
npm run judge:calibrate
```

This is a real, paid operator experiment using Wrangler's remote AI binding. It runs 20 labelled reviews against the published Forum code and curated concerns, including unrelated feedback, vague comments, specific mechanisms, consequences, and grading-injection attempts. It uses the same `CloudJudge` request, response validation and confidence threshold as gameplay.

The experiment has its own in-memory **$0.05 ceiling**, independent of the shared gameplay ledger. Each request reserves the cost of 32,000 input tokens; valid usage settles the reservation to actual cost. At the configured $0.042 per million input tokens, all 20 reservations total $0.02688. A new invocation starts a new experimental allowance. The runner stops on the first provider error and never changes deployed judge settings.

The ignored report is written to `var/judge-calibration.json`, including categories, confidence, abstentions, false credit and reserved/settled cost. A preliminary pass requires no credit for negative examples and at least 80% coverage of positive examples. This small authored set is a smoke test, not proof of general review accuracy. Inspect the report, especially abstentions and adjacent-category disagreements, before enabling.

## Enable for a playthrough

After billing works and results are acceptable, set `JEV_CALIBRATED` to `true` in `wrangler.jsonc` and deploy. Keep the shared `AI_DAILY_BUDGET_USD` cap at `1` and the initial confidence threshold at `0.9` while collecting evidence. Request-changes reviews that identify the expected concern can then trigger prepared revisions. `/game revise <PR-number>` remains available when matching abstains or cannot run.

Budget exhaustion, invalid responses, low confidence and provider failures leave review text unassessed; deterministic outcomes and debriefs still work. Finished stage results stay frozen. Test the live integration with a new review in an active stage, then check its prepared revision and eventual debrief.

The production budget and calibration allowance count Jev inference at the configured token rate. Credit-purchase fees and other Cloudflare services are separate. Check [current Jev pricing](https://developers.cloudflare.com/ai/models/typesafe/jev/) before changing the rate.

## Current live result

2026-10-15: the authenticated Cloudflare binding reached Jev but the first request failed with insufficient AI Gateway credits. Gameplay judging remains disabled. No accuracy or per-request usage result was returned.
