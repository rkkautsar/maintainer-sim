import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { CloudJudge, unwrapJevResponse } from "../src/cloudflare/judge.ts";
import { findPackage } from "../src/packages.ts";
import type { Env } from "../src/cloudflare/env.ts";
// Live, opt-in operator experiment. Uses the production classifier and request format.
// A separate in-memory budget limits this entire experiment; production stays disabled.
const rate = 0.042,
  limit = 0.05,
  reservation = (32000 * rate) / 1e6;
const fixtures = JSON.parse(
  readFileSync("test/fixtures/judge-reviews.json", "utf8"),
);
const pack = findPackage("forum", "0.1.0");
const charges = new Map<
  string,
  { cost: number; result?: string; finalized?: boolean }
>();
const total = () =>
  [...charges.values()].reduce((sum, charge) => sum + charge.cost, 0);
const budget = {
  fetch: async (_url: string, options: any) => {
    const body = JSON.parse(options.body),
      prior = charges.get(body.key);
    if (body.action === "claim") {
      if (prior)
        return Response.json({ claimed: false, result: prior.result ?? null });
      if (total() + reservation > limit)
        return Response.json({ claimed: false });
      charges.set(body.key, { cost: reservation });
      return Response.json({ claimed: true });
    }
    if (prior && !prior.finalized) {
      prior.cost = (body.inputTokens * rate) / 1e6;
      prior.result = body.result;
      prior.finalized = true;
    }
    return Response.json({ ok: true });
  },
};
const proxy = await getPlatformProxy<Env>({
  configPath: "wrangler.jsonc",
  persist: false,
  remoteBindings: true,
});
const results: any[] = [];
let last: any, failure: string | undefined;
try {
  const judge = new CloudJudge({
    ...proxy.env,
    JEV_CALIBRATED: "true",
    JEV_CONFIDENCE_THRESHOLD: "0.9",
    AI_GATEWAY_ID: undefined,
    BUDGET: { idFromName: () => "calibration", get: () => budget } as any,
    AI: {
      run: async (...args: any[]) => {
        last = undefined;
        try {
          const raw = await (proxy.env.AI.run as any)(...args);
          last = unwrapJevResponse(raw);
          return raw;
        } catch (error: any) {
          failure = String(error?.message ?? "Inference failed").slice(0, 250);
          throw error;
        }
      },
    } as any,
  });
  for (const fixture of fixtures) {
    const proposal = pack.stages
      .flatMap((stage) => stage.proposals)
      .find((p) => p.id === fixture.proposal)!;
    const variant = proposal.variants[0];
    const actual = await judge.evaluate(
      fixture.review,
      variant.concern!,
      variant.files,
    );
    results.push({
      id: fixture.id,
      expected: fixture.expected,
      actual: actual ?? "unassessed",
      rawChoice: last?.answers?.identification?.choice,
      confidence: last?.answers?.identification?.confidence,
      inputTokens: last?.usage?.input_tokens,
    });
    console.log(JSON.stringify(results.at(-1)));
    if (failure) break; // Never retry billing or authentication failures across the fixture set.
  }
  const earnsCredit = (category: string) =>
    ["identified", "consequence"].includes(category);
  const positives = results.filter((r) => earnsCredit(r.expected));
  const falseCredit = results.filter(
    (r) => !earnsCredit(r.expected) && earnsCredit(r.actual),
  );
  const positiveHits = positives.filter((r) => earnsCredit(r.actual)).length;
  const report = {
    at: new Date().toISOString(),
    model: "typesafe/jev",
    scenarioDigest: pack.digest,
    failure,
    runBudgetUsd: limit,
    reservedOrSettledUsd: total(),
    cases: results.length,
    expectedCases: fixtures.length,
    exactMatches: results.filter((r) => r.expected === r.actual).length,
    falseCredit: falseCredit.length,
    positiveHits,
    positiveCases: positives.length,
    preliminaryPass:
      !failure &&
      results.length === fixtures.length &&
      falseCredit.length === 0 &&
      positiveHits / positives.length >= 0.8,
    results,
  };
  mkdirSync("var", { recursive: true });
  writeFileSync(
    "var/judge-calibration.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ ...report, results: undefined }));
  console.log(
    "Report: var/judge-calibration.json. This command does not enable gameplay judging.",
  );
  if (!report.preliminaryPass) process.exitCode = 1;
} finally {
  await proxy.dispose();
}
