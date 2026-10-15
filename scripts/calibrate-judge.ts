import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { CloudJudge, unwrapJudgeResponse } from "../src/cloudflare/judge.ts";
import { findPackage } from "../src/packages.ts";
import type { Env } from "../src/cloudflare/env.ts";
// Live, opt-in operator experiment. Uses the production classifier and request format.
// A separate in-memory budget limits this experiment; deployed settings are never changed.
const model = process.argv[3] ?? "@cf/cloudflare/clef-flash";
const models: Record<string, { rate: number; selector?: string }> = {
  "typesafe/jev": { rate: 0.042 },
  "@cf/cloudflare/clef": { rate: 0.24, selector: "clef" },
  "@cf/cloudflare/clef-flash": { rate: 0.038, selector: "clef-flash" },
};
if (!models[model]) throw new Error("Unsupported decision model");
const rate = models[model].rate,
  limit = 0.05,
  reservation = (32000 * rate) / 1e6;
const fixtureSource = process.argv[2] ?? "test/fixtures/judge-reviews.json";
const fixturePaths =
  fixtureSource === "all"
    ? ["test/fixtures/judge-reviews.json", "test/fixtures/judge-heldout.json"]
    : [fixtureSource];
const fixtures = fixturePaths.flatMap((path) =>
  JSON.parse(readFileSync(path, "utf8")),
);
const coaching = process.env.CALIBRATE_COACHING === "true";
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
let last: any, failure: string | undefined, latencyMs: number | undefined;
try {
  const judge = new CloudJudge({
    ...proxy.env,
    JUDGE_ENABLED: "true",
    JUDGE_CONFIDENCE_THRESHOLD:
      process.env.CALIBRATION_THRESHOLD ??
      (model === "@cf/cloudflare/clef-flash" ? "0.2" : "0.9"),
    REVIEW_COACHING_ENABLED: "true",
    COACH_CONFIDENCE_THRESHOLD: "0.3",
    BUDGET: { idFromName: () => "calibration", get: () => budget } as any,
    AI: {
      run: async (...args: any[]) => {
        last = undefined;
        try {
          const started = performance.now();
          const { model: _selector, ...stateAndQuestions } = args[1];
          const input = models[model].selector
            ? { ...stateAndQuestions, model: models[model].selector }
            : stateAndQuestions;
          const raw = await (proxy.env.AI.run as any)(model, input, args[2]);
          latencyMs = performance.now() - started;
          last = unwrapJudgeResponse(raw);
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
    const actual = coaching
      ? await judge.coach(fixture.review, variant.files)
      : await judge.evaluate(fixture.review, variant.concern!, variant.files);
    results.push({
      id: fixture.id,
      expected: fixture.expected,
      actual: actual ?? "unassessed",
      coachingAnswers: coaching ? last?.answers : undefined,
      rawChoice: last?.answers?.identification?.choice,
      confidence: last?.answers?.identification?.confidence,
      probabilities: last?.answers?.identification?.probabilities,
      inputTokens: last?.usage?.input_tokens,
      latencyMs,
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
    model,
    fixturePaths,
    mode: coaching ? "coaching" : "concern",
    confidenceThreshold: coaching
      ? 0.3
      : Number(
          process.env.CALIBRATION_THRESHOLD ??
            (model === "@cf/cloudflare/clef-flash" ? "0.2" : "0.9"),
        ),
    scenarioDigest: pack.digest,
    failure,
    runBudgetUsd: limit,
    reservedOrSettledUsd: total(),
    cases: results.length,
    expectedCases: fixtures.length,
    medianLatencyMs: results
      .map((r) => r.latencyMs)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[Math.floor(results.length / 2)],
    rawMatches: results.filter((r) => r.expected === r.rawChoice).length,
    exactMatches: results.filter((r) => r.expected === r.actual).length,
    falseCredit: falseCredit.length,
    positiveHits,
    positiveCases: positives.length,
    coachingDimensions: coaching
      ? results.flatMap((r) =>
          Object.entries(r.expected).map(([key, expected]) => ({
            expected,
            actual: r.actual?.[key],
          })),
        )
      : undefined,
    preliminaryPass:
      !failure &&
      results.length === fixtures.length &&
      falseCredit.length === 0 &&
      positiveHits / positives.length >= 0.8,
    results,
  };
  if (coaching) {
    const dimensions = report.coachingDimensions!;
    const accepted = dimensions.filter((d) => d.actual !== undefined);
    report.preliminaryPass =
      !failure &&
      results.length === fixtures.length &&
      accepted.length / dimensions.length >= 0.7 &&
      accepted.every((d) => d.actual === d.expected);
    console.log(
      JSON.stringify({
        coachingAccepted: accepted.length,
        coachingTotal: dimensions.length,
        mismatches: accepted.filter((d) => d.actual !== d.expected),
      }),
    );
  }
  mkdirSync("var", { recursive: true });
  const reportPath = coaching
    ? "var/review-coaching-calibration.json"
    : model === "typesafe/jev"
      ? "var/judge-calibration.json"
      : "var/judge-calibration-" + models[model].selector + ".json";
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, results: undefined }));
  console.log(
    `Report: ${reportPath}. This command does not change gameplay judging.`,
  );
  if (!report.preliminaryPass) process.exitCode = 1;
} finally {
  await proxy.dispose();
}
