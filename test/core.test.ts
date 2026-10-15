import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { initialRun, assess, expectedFiles, debrief } from "../src/engine.ts";
import { baseline, proposals } from "../src/scenario.ts";
import { Store } from "../src/store.ts";
import { validSignature, command } from "../src/security.ts";
import { Judge } from "../src/judge.ts";
export function fixture() {
  const r = initialRun({
    id: "run",
    installation: 1,
    repository: 2,
    owner: "owner",
    repo: "game",
    player: 3,
  });
  r.phase = "active";
  r.master = 99;
  r.base = "main";
  r.baseline = "baseline";
  for (const [i, p] of proposals.entries())
    r.prs[p.id] = {
      number: i + 1,
      revision: 0,
      outcome: "open",
      head: "head-" + p.id,
      reviews: [],
    };
  return r;
}
test("good decisions complete milestone; prepared fix unlocks issue", () => {
  const r = fixture();
  for (const id of ["a", "c", "d"]) r.prs[id].outcome = "merged";
  r.prs.c.revision = 1;
  r.prs.d.revision = 1;
  r.prs.b.outcome = "closed";
  r.prs.f.outcome = "closed";
  const score = assess(r);
  assert.equal(score.success, true);
  assert.equal(score.points, 12);
  assert.match(debrief(r), /Not assessed/);
});
test("rejecting every contribution does not deliver milestone", () => {
  const r = fixture();
  Object.values(r.prs).forEach((x) => (x.outcome = "closed"));
  assert.equal(assess(r).success, false);
  assert.equal(assess(r).complete.length, 0);
});
test("unauthorized edit implementation prevents success", () => {
  const r = fixture();
  r.prs.c.outcome = "merged";
  assert.deepEqual(assess(r).harmful, ["c"]);
  assert.equal(assess(r).decisions.find((x) => x.id === "c")?.points, -2);
});
test("prepared alternative satisfies competing issue", () => {
  const r = fixture();
  r.prs.b.revision = 1;
  r.prs.b.outcome = "merged";
  r.prs.a.outcome = "closed";
  assert.ok(assess(r).complete.includes("likes"));
  assert.equal(assess(r).decisions[0].points, 2);
});
test("early finish defers open contributions", () => {
  const r = fixture();
  const score = assess(r);
  assert.ok(score.decisions.every((x) => x.outcome === "deferred"));
  assert.equal(score.success, false);
});
test("merged expected tree contains only authored effects", () => {
  const r = fixture();
  assert.deepEqual(expectedFiles(r), baseline);
  r.prs.c.revision = 1;
  r.prs.d.revision = 1;
  r.prs.c.outcome = "merged";
  assert.match(expectedFiles(r)["src/edit.ts"], /actor !== post.ownerId/);
});
test("rubric never enters public baseline", () => {
  assert.ok(baseline["src/server.ts"]);
  assert.ok(baseline["web/index.html"]);
  assert.ok(baseline["package.json"]);
  assert.ok(
    Object.keys(baseline).every(
      (p) => !p.includes("rubric") && !p.includes("private"),
    ),
  );
});
test("invalid revision rejected", () => {
  const r = fixture();
  r.prs.c.revision = 99;
  assert.throws(() => assess(r), /Unknown authored/);
});
test("webhook signatures bind raw bytes", () => {
  const raw = Buffer.from('{"a":1}'),
    sig = "sha256=" + createHmac("sha256", "secret").update(raw).digest("hex");
  assert.equal(validSignature(raw, sig, "secret"), true);
  assert.equal(validSignature(Buffer.from('{"a":2}'), sig, "secret"), false);
  for (const bad of [undefined, "bad", "sha256=00"])
    assert.equal(validSignature(raw, bad, "secret"), false);
});
test("commands require exact syntax", () => {
  assert.deepEqual(command("/game finish"), { kind: "finish" });
  assert.deepEqual(command("/game revise 12"), { kind: "revise", number: 12 });
  assert.equal(command("hello /game finish"), undefined);
  assert.equal(command("/game revise -1"), undefined);
});
test("SQLite deduplicates delivery IDs and persists runs", () => {
  const s = new Store(":memory:");
  try {
    s.save(fixture());
    assert.equal(s.get("run").repository, 2);
    assert.equal(s.enqueue("delivery", "push", "{}"), true);
    assert.equal(s.enqueue("delivery", "push", "{}"), false);
  } finally {
    s.close();
  }
});
test("budget reservation refuses overspend and duplicates", () => {
  const s = new Store(":memory:");
  try {
    assert.equal(s.reserve("one", 0.6, 1, "day"), true);
    assert.equal(s.reserve("two", 0.6, 1, "day"), false);
    assert.equal(s.reserve("one", 0.1, 1, "day"), false);
    assert.equal(s.reserve("three", 0.4, 1, "day"), true);
    assert.equal(s.reserve("four", 0.1, 1, "tomorrow"), true);
  } finally {
    s.close();
  }
});
test("judge disabled incurs no calls", async () => {
  const prev = process.env.JEV_CALIBRATED;
  delete process.env.JEV_CALIBRATED;
  const s = new Store(":memory:");
  try {
    const j = new Judge(s, async () => {
      throw new Error("must not call");
    });
    assert.equal(await j.evaluate("review", "concern", {}), undefined);
  } finally {
    s.close();
    if (prev !== undefined) process.env.JEV_CALIBRATED = prev;
  }
});
test("judge caches validated assessment; low confidence falls back", async () => {
  const vars = [
    "JEV_CALIBRATED",
    "JEV_API_KEY",
    "JEV_INPUT_USD_PER_MILLION",
    "JEV_CONFIDENCE_THRESHOLD",
    "AI_DAILY_BUDGET_USD",
  ];
  const before = Object.fromEntries(vars.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    JEV_CALIBRATED: "true",
    JEV_API_KEY: "test",
    JEV_INPUT_USD_PER_MILLION: "0.042",
    JEV_CONFIDENCE_THRESHOLD: "0.9",
    AI_DAILY_BUDGET_USD: "1",
  });
  const s = new Store(":memory:");
  let calls = 0;
  try {
    const j = new Judge(s, async () => {
      calls++;
      return new Response(
        JSON.stringify({
          answers: {
            identification: {
              type: "choice",
              choice: "identified",
              confidence: 1,
              probabilities: {
                absent: 0,
                vague: 0,
                identified: 1,
                consequence: 0,
              },
            },
          },
        }),
      );
    });
    assert.equal(
      await j.evaluate("ownership missing", "owner check", {}),
      "identified",
    );
    assert.equal(
      await j.evaluate("ownership missing", "owner check", {}),
      "identified",
    );
    assert.equal(calls, 1);
    const uncertain = new Judge(
      s,
      async () =>
        new Response(
          JSON.stringify({
            answers: {
              identification: {
                type: "choice",
                choice: "identified",
                confidence: 0.2,
              },
            },
          }),
        ),
    );
    assert.equal(await uncertain.evaluate("other", "concern", {}), undefined);
  } finally {
    s.close();
    for (const k of vars) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});

test("overengineered implementation delivers the feature but incurs maintainability penalty", () => {
  const r = fixture();
  r.prs.b.outcome = "merged";
  const score = assess(r);
  assert.ok(score.complete.includes("likes"));
  assert.ok(score.debt.includes("Unneeded reaction pipeline"));
  assert.equal(score.success, false);
});
