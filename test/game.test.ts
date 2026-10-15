import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.ts";
import { Store } from "../src/store.ts";
import { baseline, proposals } from "../src/scenario.ts";
import { expectedFiles, initialRun } from "../src/engine.ts";
import type { GitHub } from "../src/github.ts";
import type { Run } from "../src/types.ts";
class Fake {
  files: Record<string, Record<string, string>> = { baseline: { ...baseline } };
  refs: Record<string, string> = { main: "baseline" };
  prs: any[] = [];
  issues: any[] = [];
  milestones: any[] = [];
  comments: any[] = [];
  commits = 0;
  failRevision = false;
  reviews: any[] = [];
  async get(path: string): Promise<any> {
    if (path === "/repos/owner/game") return { id: 2, default_branch: "main" };
    if (path.includes("/git/ref/heads/")) {
      const ref = path.split("/git/ref/heads/")[1];
      if (!this.refs[ref])
        throw Object.assign(new Error("missing"), { status: 404 });
      return { object: { sha: this.refs[ref] } };
    }
    if (/\/pulls\/\d+$/.test(path)) {
      const number = Number(path.split("/").at(-1));
      return this.prs.find((p) => p.number === number);
    }
    throw new Error("Unexpected GET " + path);
  }
  async list(path: string) {
    if (path.includes("/reviews")) return this.reviews;
    if (path.includes("/comments")) return this.comments;
    if (path.includes("/milestones")) return this.milestones;
    if (path.includes("/issues")) return this.issues;
    if (path.includes("/pulls")) return this.prs;
    throw new Error(path);
  }
  async tree(_root: string, sha: string) {
    return this.files[sha];
  }
  async commit(_root: string, parent: string, files: Record<string, string>) {
    const sha = "commit" + ++this.commits;
    this.files[sha] = { ...this.files[parent], ...files };
    return { sha };
  }
  async post(path: string, body: any) {
    if (path.endsWith("/git/refs")) {
      this.refs[body.ref.replace("refs/heads/", "")] = body.sha;
      return {};
    }
    if (path.endsWith("/milestones")) {
      const m = { ...body, number: 1 };
      this.milestones.push(m);
      return m;
    }
    if (path.endsWith("/issues")) {
      const i = { ...body, number: 1 + this.issues.length };
      this.issues.push(i);
      return i;
    }
    if (path.endsWith("/pulls")) {
      const p = {
        ...body,
        number: 1 + this.issues.length + this.prs.length,
        state: "open",
        merged: false,
        head: { sha: this.refs[body.head], ref: body.head, repo: { id: 2 } },
        base: { ref: body.base },
      };
      this.prs.push(p);
      return p;
    }
    if (path.endsWith("/comments")) {
      this.comments.push({ ...body, user: { type: "Bot" } });
      return {};
    }
    throw new Error(path);
  }
  async patch(path: string, body: any) {
    if (path.includes("/issues/")) {
      const issue = this.issues.find(
        (i) => i.number === Number(path.split("/").at(-1)),
      );
      Object.assign(issue, body);
      return issue;
    }
    const branch = path.split("/git/refs/heads/")[1];
    this.refs[branch] = body.sha;
    this.prs.find((p) => p.head.ref === branch).head.sha = body.sha;
    if (this.failRevision) {
      this.failRevision = false;
      throw Object.assign(new Error("network response lost"), { status: 500 });
    }
    return {};
  }
  merge(id: string, r: Run) {
    const pr = this.prs.find((p) => p.number === r.prs[id].number);
    pr.merged = true;
    pr.state = "closed";
    r.prs[id].outcome = "merged";
    this.files.final = expectedFiles(r);
    this.refs.main = "final";
  }
}
async function setup() {
  const s = new Store(":memory:"),
    fake = new Fake(),
    game = new Game(s, async () => fake as unknown as GitHub);
  const r = initialRun({
    id: "run",
    installation: 1,
    repository: 2,
    owner: "owner",
    repo: "game",
    player: 3,
  });
  s.save(r);
  await game.seed(r);
  return { s, fake, game, r };
}
function payload(r: Run, body?: string, user = 3) {
  return {
    installation: { id: 1 },
    repository: { id: 2 },
    action: "created",
    issue: { number: r.master },
    comment: { body, user: { id: user } },
  };
}
test("seeding resumes with exact object counts and no duplicate creation", async () => {
  const { s, fake, game, r } = await setup();
  try {
    r.phase = "seeding";
    s.save(r);
    await game.seed(r);
    assert.equal(fake.milestones.length, 1);
    assert.equal(fake.issues.length, 4);
    assert.equal(r.master, 1);
    assert.match(fake.issues[0].body, /Saturday launch/);
    assert.match(fake.issues[0].body, /Incoming contributions/);
    assert.equal(fake.prs.length, 6);
    assert.equal(s.get("run").phase, "active");
  } finally {
    s.close();
  }
});
test("authorized prepared revision updates same PR", async () => {
  const { s, fake, game, r } = await setup();
  try {
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.c.number}`),
    );
    assert.equal(s.get("run").prs.c.revision, 1);
    assert.equal(fake.prs.length, 6);
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.c.number}`),
    );
    assert.equal(s.get("run").prs.c.revision, 1);
  } finally {
    s.close();
  }
});
test("unauthorized finish ignored", async () => {
  const { s, game, r } = await setup();
  try {
    await game.process("issue_comment", payload(r, "/game finish", 9));
    assert.equal(s.get("run").phase, "active");
  } finally {
    s.close();
  }
});
test("early finish freezes and publishes once", async () => {
  const { s, fake, game, r } = await setup();
  try {
    await game.process("issue_comment", payload(r, "/game finish"));
    assert.equal(s.get("run").phase, "finished");
    assert.equal(s.get("run").result?.complete.length, 0);
    await game.process("issue_comment", payload(r, "/game finish"));
    assert.equal(
      fake.comments.filter((c) => c.body.includes("Stage debrief")).length,
      1,
    );
  } finally {
    s.close();
  }
});
test("closing every scenario PR finishes automatically", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.prs.forEach((p) => (p.state = "closed"));
    await game.process("pull_request", payload(r));
    assert.equal(s.get("run").phase, "finished");
  } finally {
    s.close();
  }
});
test("unexpected source changes pause without scoring", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.files.bad = { ...baseline, "evil.ts": "unexpected" };
    fake.refs.main = "bad";
    await game.process("push", payload(r));
    assert.equal(s.get("run").phase, "paused");
    assert.equal(s.get("run").result, undefined);
  } finally {
    s.close();
  }
});
test("known authored merged content works regardless of commit identity", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.merge("a", r);
    await game.process("pull_request", payload(r));
    assert.equal(s.get("run").phase, "active");
    assert.equal(s.get("run").prs.a.outcome, "merged");
  } finally {
    s.close();
  }
});
test("revision response loss recovers persisted intent", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.failRevision = true;
    await assert.rejects(() =>
      game.process(
        "issue_comment",
        payload(r, `/game revise ${r.prs.c.number}`),
      ),
    );
    assert.equal(s.get("run").prs.c.revision, 0);
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.c.number}`),
    );
    assert.equal(s.get("run").prs.c.revision, 1);
    assert.equal(s.get("run").phase, "active");
  } finally {
    s.close();
  }
});
test("installation removal disables run", async () => {
  const { s, game } = await setup();
  try {
    await game.process("installation", {
      installation: { id: 1 },
      action: "deleted",
    });
    assert.equal(s.get("run").phase, "inaccessible");
  } finally {
    s.close();
  }
});

test("complete winning session revises, merges, closes and debriefs automatically", async () => {
  const { s, fake, game, r } = await setup();
  try {
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.c.number}`),
    );
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.d.number}`),
    );
    const current = s.get("run");
    for (const id of ["a", "c", "d", "e"]) {
      fake.merge(id, current);
      await game.process("pull_request", payload(r));
    }
    fake.prs.find((p) => p.number === current.prs.b.number).state = "closed";
    fake.prs.find((p) => p.number === current.prs.f.number).state = "closed";
    await game.process("pull_request", payload(r));
    const finished = s.get("run");
    assert.equal(finished.phase, "finished");
    assert.equal(finished.result?.success, true);
    assert.equal(finished.result?.points, 12);
    assert.equal(
      fake.comments.filter((c) => c.body.includes("Stage debrief")).length,
      1,
    );
  } finally {
    s.close();
  }
});

test("missing webhook can be recovered through authoritative reconciliation", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.prs.forEach((p) => (p.state = "closed"));
    await game.process("push", payload(r));
    assert.equal(s.get("run").phase, "finished");
  } finally {
    s.close();
  }
});

test("identified native request-changes review triggers revision and preserves finding", async () => {
  const { s, fake, r } = await setup();
  const game = new Game(
    s,
    async () => fake as unknown as GitHub,
    { evaluate: async () => "consequence" },
    true,
  );
  try {
    fake.reviews = [
      {
        id: 50,
        user: { id: r.player },
        body: "actor is unchecked so anyone can edit another user post",
        state: "CHANGES_REQUESTED",
        commit_id: r.prs.c.head,
        submitted_at: "2026-10-15T00:00:00Z",
      },
    ];
    await game.process("pull_request_review", payload(r));
    assert.equal(s.get("run").prs.c.revision, 1);
    assert.equal(s.get("run").findings.c[0].revision, 0);
    await game.process("issue_comment", payload(r, "/game finish"));
    assert.match(
      fake.comments.at(-1).body,
      /review 50, revision 0: consequence/,
    );
  } finally {
    s.close();
  }
});

test("unavailable judge leaves revision command available without concern credit", async () => {
  const { s, fake, r } = await setup();
  const game = new Game(
    s,
    async () => fake as unknown as GitHub,
    { evaluate: async () => undefined },
    true,
  );
  try {
    fake.reviews = [
      {
        id: 50,
        user: { id: r.player },
        body: "Please check ownership",
        state: "CHANGES_REQUESTED",
        commit_id: r.prs.c.head,
        submitted_at: "2026-10-15T00:00:00Z",
      },
    ];
    await game.process("pull_request_review", payload(r));
    assert.equal(s.get("run").prs.c.revision, 0);
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.c.number}`),
    );
    assert.equal(s.get("run").prs.c.revision, 1);
    assert.deepEqual(s.get("run").findings, {});
  } finally {
    s.close();
  }
});

test("human exchanges are replay-safe and manual revisions do not imply concern credit", async () => {
  const { s, fake, game, r } = await setup();
  try {
    assert.equal(
      fake.comments.filter((c) => c.body.includes("another neighborhood asked"))
        .length,
      1,
    );
    assert.equal(
      fake.comments.filter((c) => c.body.includes("URL parameters")).length,
      1,
    );
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.d.number}`),
    );
    await game.process("push", payload(r));
    const replies = fake.comments.filter((c) =>
      c.body.includes("The revised helper rejects non-integers"),
    );
    assert.equal(replies.length, 1);
    assert.match(replies[0].body, /prepared revision you requested/);
    assert.doesNotMatch(replies[0].body, /Thanks for identifying/);
    await game.process("issue_comment", payload(r, "/game finish"));
    assert.match(fake.comments.at(-1).body, /Community update/);
    assert.match(fake.comments.at(-1).body, /clear handover/);
  } finally {
    s.close();
  }
});
