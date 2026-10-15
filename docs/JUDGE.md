# Try the Jev review judge

The game always scores authored outcomes deterministically. Jev optionally matches a player's review text to an expected concern; it does not invent the rubric, score arbitrary code, or generate revisions.

Cloudflare's `typesafe/jev` model requires prepaid AI Gateway credits. A paid Workers plan alone did not satisfy this requirement in the live test: Cloudflare returned `2021: Insufficient AI Gateway credits`. Add credits through [AI Gateway Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/). Credentials remain in Wrangler's authenticated environment; no provider key is sent to the browser.

## Calibration

```bash
npm run judge:calibrate
```

This is a real, paid operator experiment using Wrangler's remote AI binding. It runs 20 labelled reviews against the published Forum code and curated concerns, including unrelated feedback, vague comments, specific mechanisms, consequences, and grading-injection attempts. It uses the same `CloudJudge` request, response validation and confidence threshold as gameplay.

A fresh validation set is also available:

```bash
npm run judge:calibrate -- test/fixtures/judge-heldout.json
```

The experiment has its own in-memory **$0.05 ceiling**, independent of the shared gameplay ledger. Each request reserves the cost of 32,000 input tokens; valid usage settles the reservation to actual cost. At the configured $0.042 per million input tokens, all 20 reservations total $0.02688. A new invocation starts a new experimental allowance. The runner stops on the first provider error and never changes deployed judge settings.

The ignored report is written to `var/judge-calibration.json`, including categories, confidence, abstentions, false credit and reserved/settled cost. A preliminary pass requires no credit for negative examples and at least 80% coverage of positive examples. This small authored set is a smoke test, not proof of general review accuracy. Inspect the report, especially abstentions and adjacent-category disagreements, before enabling.

## Enable for a playthrough

After billing works and results are acceptable, set `JEV_CALIBRATED` to `true` in `wrangler.jsonc` and deploy. Keep the shared `AI_DAILY_BUDGET_USD` cap at `1` and the initial confidence threshold at `0.9` while collecting evidence. Request-changes reviews that identify the expected concern can then trigger prepared revisions. `/game revise <PR-number>` remains available when matching abstains or cannot run.

Budget exhaustion, invalid responses, low confidence and provider failures leave review text unassessed; deterministic outcomes and debriefs still work. Finished stage results stay frozen. Test the live integration with a new review in an active stage, then check its prepared revision and eventual debrief.

The production budget and calibration allowance count Jev inference at the configured token rate. Credit-purchase fees and other Cloudflare services are separate. Check [current Jev pricing](https://developers.cloudflare.com/ai/models/typesafe/jev/) before changing the rate.

## Current live result

2026-10-15: after loading AI Gateway credits, inference succeeded. The live binding wrapped results in `{state: "Completed", result: ...}`; the production parser now explicitly unwraps completed responses and rejects other states.

The baseline 20-case trial used 20,494 input tokens, estimated at $0.000860748 in Jev inference (excluding credit-purchase fees). Raw choices matched 19 of 20 labels. With the existing 0.9 confidence threshold, seven answers were accepted and thirteen stayed unassessed. Only three of ten positive reviews earned concern credit, below the 80% preliminary coverage requirement. No negative example earned credit. One grading-injection example produced the wrong raw choice with low confidence and was rejected by the threshold. This baseline did not meet the preliminary coverage requirement.

### Prompt revision and validation

The shared prompt now makes the four categories mutually exclusive: absent has no relevant feedback; vague names only a problem area; identified states a mechanism without its impact; consequence states both mechanism and impact. Instructions credit only evidence in the player review, treat the concern/code as reference, accept semantic paraphrases and corrective instructions, and ignore grading commands in the review. The PR code context and 0.9 confidence threshold were held constant during comparison.

| Run                               | Accepted | Abstained | Positive credit | False credit | Estimated inference |
| --------------------------------- | -------- | --------- | --------------- | ------------ | ------------------- |
| Original prompt, 20 examples      | 7/20     | 13/20     | 3/10            | 0            | $0.000861           |
| Revised prompt, same examples     | 18/20    | 2/20      | 8/10            | 0            | $0.001041           |
| Revised prompt, 12 fresh examples | 10/12    | 2/12      | 5/6             | 0            | $0.000599           |

The repeated 20-example run passed the preliminary gate before a further parser correction: one confident answer had rounded probabilities summing to 0.99. The parser now allows at most the rounding error of four two-decimal values while rejecting materially invalid distributions. The fresh set ran with this correction and included different wording, a wrong concern, grading commands, and a valid concern with an appended grading command.

These small authored sets demonstrate improvement on this scenario, not a general accuracy guarantee. Jev is enabled for the playthrough trial with the same 0.9 threshold and shared $1/day inference cap; uncertain or unavailable matches remain unassessed. No free provider or automatic provider fallback has been configured.

## Free access alternatives

[OpenCode Console](https://opencode.ai/v2/docs/console/models/) currently lists `jev-1.13-free` as a limited-time free model at its `/inference/v1/systemone` endpoint. This is separate from the Go subscription list. [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/pricing) includes $5/month free credits for eligible models; verify Jev eligibility in its catalog instead of assuming all models qualify. Cloudflare's Workers AI free Neuron allowance is separate from the third-party AI Gateway credit balance used by this integration.
