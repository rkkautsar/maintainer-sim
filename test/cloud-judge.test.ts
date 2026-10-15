import test from "node:test";
import assert from "node:assert/strict";
import { CloudJudge } from "../src/cloudflare/judge.ts";
import type { Env } from "../src/cloudflare/env.ts";
function fixture(answer: any, claimed = true) {
  const calls: any[] = [];
  let requests = 0;
  const env = {
    JEV_CALIBRATED: "true",
    JEV_CONFIDENCE_THRESHOLD: "0.9",
    BUDGET: {
      idFromName: () => "global",
      get: () => ({
        fetch: async (_url: string, options: any) => {
          const body = JSON.parse(options.body);
          calls.push(body);
          return Response.json(
            body.action === "claim" ? { claimed } : { ok: true },
          );
        },
      }),
    },
    AI: {
      run: async () => {
        requests++;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  } as unknown as Env;
  return { env, calls, requests: () => requests, judge: new CloudJudge(env) };
}
const response = (confidence = 0.99) => ({
  answers: {
    identification: {
      type: "choice",
      choice: "consequence",
      confidence,
      probabilities: { absent: 0, vague: 0, identified: 0, consequence: 1 },
    },
  },
  usage: { input_tokens: 500 },
});
test("Cloudflare judge reserves before inference and settles actual tokens", async () => {
  const f = fixture(response());
  assert.equal(
    await f.judge.evaluate("A specific concern", "Expected concern", {}),
    "consequence",
  );
  assert.equal(f.requests(), 1);
  assert.deepEqual(
    f.calls.map((c) => c.action),
    ["claim", "complete"],
  );
  assert.equal(f.calls[1].inputTokens, 500);
  assert.equal(f.calls[1].result, "consequence");
});
test("disabled or exhausted Cloudflare judge makes no paid inference", async () => {
  const disabled = fixture(response());
  disabled.env.JEV_CALIBRATED = "false";
  assert.equal(
    await disabled.judge.evaluate("review", "concern", {}),
    undefined,
  );
  assert.equal(disabled.calls.length, 0);
  const exhausted = fixture(response(), false);
  assert.equal(
    await exhausted.judge.evaluate("review", "concern", {}),
    undefined,
  );
  assert.equal(exhausted.requests(), 0);
});
test("uncertain Cloudflare answer stays unassessed but settles its usage", async () => {
  const f = fixture(response(0.6));
  assert.equal(await f.judge.evaluate("review", "concern", {}), undefined);
  assert.equal(f.calls[1].result, null);
  assert.equal(f.calls[1].inputTokens, 500);
});
test("Cloudflare billing failure falls back without releasing its conservative reservation", async () => {
  const f = fixture(new Error("2021: Insufficient AI Gateway credits"));
  assert.equal(await f.judge.evaluate("review", "concern", {}), undefined);
  assert.deepEqual(
    f.calls.map((c) => c.action),
    ["claim"],
  );
});

test("live Cloudflare completion envelope is parsed and its actual usage settled", async () => {
  const f = fixture({ state: "Completed", result: response() });
  assert.equal(await f.judge.evaluate("review", "concern", {}), "consequence");
  assert.equal(f.calls[1].inputTokens, 500);
});
test("incomplete or failed Cloudflare envelopes cannot grant review credit", async () => {
  for (const state of ["Running", "Failed"]) {
    const f = fixture({ state, result: response() });
    assert.equal(await f.judge.evaluate("review", "concern", {}), undefined);
    assert.equal(f.calls.length, 1);
  }
});
