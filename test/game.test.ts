import test from "node:test";
import assert from "node:assert/strict";
import { findPackage, selectScenario } from "../src/packages.ts";
import { Game } from "../src/game.ts";
import { Store } from "../src/store.ts";
const pack = findPackage("forum", "0.1.0");
const { baseline, proposals } = pack.stages[0];
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
  async commit(
    _root: string,
    parent: string,
    files: Record<string, string>,
    _message?: string,
    deletes: string[] = [],
  ) {
    const sha = "commit" + ++this.commits;
    this.files[sha] = { ...this.files[parent], ...files };
    for (const path of deletes) delete this.files[sha][path];
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
      const i = { ...body, number: 1 + this.issues.length + this.prs.length };
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
    if (path.includes("/milestones/")) {
      Object.assign(
        this.milestones.find(
          (m) => m.number === Number(path.split("/").at(-1)),
        ),
        body,
      );
      return {};
    }
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
    const sha = "merged" + ++this.commits;
    this.files.final = expectedFiles(r);
    this.files[sha] = this.files.final;
    this.refs[r.base ?? "main"] = sha;
  }
}
async function setup(selection: Run["scenario"] = selectScenario(pack)) {
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
    scenario: selection,
  });
  if (selection) {
    r.scenario = selection;
    fake.files.baseline = {
      ...findPackage(selection.id, selection.version).stages.find(
        (s) => s.id === selection.stage,
      )!.baseline,
    };
  }
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
    assert.equal(fake.issues.length, 6);
    assert.equal(r.master, 1);
    assert.match(fake.issues[0].body, /group chat/);
    assert.match(fake.issues[0].body, /Contributions/);
    assert.equal(fake.prs.length, 10);
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
      payload(r, `/game revise ${r.prs["comment-edit"].number}`),
    );
    assert.equal(s.get("run").prs["comment-edit"].revision, 1);
    assert.equal(fake.prs.length, 10);
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs["comment-edit"].number}`),
    );
    assert.equal(s.get("run").prs["comment-edit"].revision, 1);
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
test("unexpected source changes still allow finishing with partial assessment", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.files.bad = { ...baseline, "evil.ts": "unexpected" };
    fake.refs.main = "bad";
    await game.process("push", payload(r));
    assert.equal(s.get("run").phase, "active");
    await game.process("issue_comment", payload(r, "/game finish"));
    assert.equal(s.get("run").phase, "finished");
    assert.equal(s.get("run").result?.success, null);
    assert.deepEqual(s.get("run").result?.unverified, [
      ...pack.stages[0].issues.map((i) => i.id),
    ]);
    assert.ok(fake.comments.some((c) => c.body.includes("partially assessed")));
  } finally {
    s.close();
  }
});
test("known authored merged content works regardless of commit identity", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.merge("voting-simple", r);
    await game.process("pull_request", payload(r));
    assert.equal(s.get("run").phase, "active");
    assert.equal(s.get("run").prs["voting-simple"].outcome, "merged");
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
        payload(r, `/game revise ${r.prs["comment-edit"].number}`),
      ),
    );
    assert.equal(s.get("run").prs["comment-edit"].revision, 0);
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs["comment-edit"].number}`),
    );
    assert.equal(s.get("run").prs["comment-edit"].revision, 1);
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
      payload(r, `/game revise ${r.prs["comment-edit"].number}`),
    );
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs["pagination"].number}`),
    );
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.bookmarks.number}`),
    );
    const current = s.get("run");
    for (const id of [
      "voting-simple",
      "comment-edit",
      "pagination",
      "bookmarks",
      "search-simple",
      "empty-state",
    ]) {
      fake.merge(id, current);
      await game.process("pull_request", payload(r));
    }
    for (const pr of fake.prs) if (!pr.merged) pr.state = "closed";
    await game.process("pull_request", payload(r));
    const finished = s.get("run");
    assert.equal(finished.phase, "finished");
    assert.equal(finished.result?.success, true);
    assert.equal(finished.result?.points, 20);
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
        body: "The route trusts client authorId instead of stored comment.authorId, so another member can edit someone else’s comment.",
        state: "CHANGES_REQUESTED",
        commit_id: r.prs["comment-edit"].head,
        submitted_at: "2026-10-15T00:00:00Z",
      },
    ];
    await game.process("pull_request_review", payload(r));
    assert.equal(s.get("run").prs["comment-edit"].revision, 1);
    assert.equal(s.get("run").findings["comment-edit"][0].revision, 0);
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
        commit_id: r.prs["comment-edit"].head,
        submitted_at: "2026-10-15T00:00:00Z",
      },
    ];
    await game.process("pull_request_review", payload(r));
    assert.equal(s.get("run").prs["comment-edit"].revision, 0);
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs["comment-edit"].number}`),
    );
    assert.equal(s.get("run").prs["comment-edit"].revision, 1);
    assert.deepEqual(s.get("run").findings, {});
  } finally {
    s.close();
  }
});

test("authored contributor exchanges are replay-safe without implying concern credit", async () => {
  const { s, fake, game, r } = await setup();
  try {
    const proposal = proposals.find((p) => p.id === "pagination")!;
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${r.prs.pagination.number}`),
    );
    await game.process("push", payload(r));
    assert.equal(
      fake.comments.filter((c) => c.body.includes(proposal.variants[1].reply!))
        .length,
      1,
    );
    assert.deepEqual(s.get(r.id).findings, {});
    await game.process("issue_comment", payload(r, "/game finish"));
    assert.match(fake.comments.at(-1).body, /Stage debrief/);
  } finally {
    s.close();
  }
});
test("a merge during reconciliation retries instead of pausing the run", async () => {
  const { s, fake, game, r } = await setup();
  try {
    const get = fake.get.bind(fake);
    let merged = false;
    fake.get = async (path: string) => {
      if (!merged && path.endsWith("/pulls/" + r.prs["voting-simple"].number)) {
        merged = true;
        fake.merge("voting-simple", r);
      }
      return get(path);
    };
    await assert.rejects(
      game.process("push", payload(r)),
      /Repository changed during assessment/,
    );
    assert.equal(s.get(r.id).phase, "active");
    await game.process("push", payload(r));
    assert.equal(s.get(r.id).phase, "active");
    assert.equal(s.get(r.id).prs["voting-simple"].outcome, "merged");
  } finally {
    s.close();
  }
});

test("edited PR is unscored, not judged or overwritten, and stage finishes once", async () => {
  const { s, fake, game, r } = await setup();
  try {
    let judgeCalls = 0;
    game.judgeEnabled = true;
    game.reviewer = {
      evaluate: async () => {
        judgeCalls++;
        return "identified";
      },
    };
    const pr = fake.prs.find((p) => p.number === r.prs["comment-edit"].number);
    pr.head.sha = "external-edit";
    fake.files[pr.head.sha] = {
      ...baseline,
      "features/comment-edit.ts": "custom implementation",
    };
    fake.reviews = [
      {
        user: { id: r.player },
        id: 99,
        state: "CHANGES_REQUESTED",
        submitted_at: "2026-10-15",
        commit_id: pr.head.sha,
        body: "Check ownership",
      },
    ];
    await game.process(
      "issue_comment",
      payload(r, `/game revise ${pr.number}`),
    );
    assert.equal(s.get(r.id).phase, "active");
    assert.ok(s.get(r.id).prs["comment-edit"].unscored);
    assert.equal(
      fake.refs[`game/${r.id}/comment-edit`],
      r.prs["comment-edit"].head,
    );
    assert.equal(s.get(r.id).prs["comment-edit"].revision, 0);
    assert.equal(judgeCalls, 0);
    pr.merged = true;
    pr.state = "closed";
    fake.refs.main = pr.head.sha;
    for (const other of fake.prs) other.state = "closed";
    await game.process("pull_request", payload(r));
    await game.process("pull_request", payload(r));
    const result = s.get(r.id).result!;
    assert.equal(s.get(r.id).phase, "finished");
    assert.equal(
      result.decisions.find((d) => d.id === "comment-edit")?.points,
      null,
    );
    assert.equal(result.maximum, 18);
    assert.equal(result.success, null);
    assert.ok(result.unverified?.includes("edit-comments"));
    assert.equal(
      fake.comments.filter((c) => c.body.includes("Stage debrief")).length,
      1,
    );
  } finally {
    s.close();
  }
});
test("both competing merges finish with unscored alternatives, not a pause", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.merge("voting-simple", r);
    fake.merge("voting-framework", r);
    for (const pr of fake.prs) pr.state = "closed";
    await game.process("pull_request", payload(r));
    const result = s.get(r.id).result!;
    assert.equal(s.get(r.id).phase, "finished");
    assert.equal(result.success, null);
    assert.ok(result.unverified?.includes("voting"));
    assert.equal(
      result.decisions.find((d) => d.id === "voting-simple")?.points,
      null,
    );
    assert.equal(
      result.decisions.find((d) => d.id === "voting-framework")?.points,
      null,
    );
    assert.equal(result.maximum, 16);
  } finally {
    s.close();
  }
});
test("documentation changes do not invalidate known milestone contributions", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.merge("voting-simple", r);
    fake.files.final["README.md"] = "Player notes";
    await game.process("push", payload(r));
    const current = s.get(r.id);
    assert.equal(current.phase, "active");
    assert.equal(current.prs["voting-simple"].unscored, undefined);
    assert.deepEqual(current.unverifiedIssues, []);
    assert.ok(current.warnings?.length);
  } finally {
    s.close();
  }
});
test("API failures retry without changing the game phase", async () => {
  const { s, fake, game, r } = await setup();
  try {
    const get = fake.get.bind(fake);
    fake.get = async () => {
      throw Object.assign(new Error("unavailable"), { status: 503 });
    };
    await assert.rejects(game.process("push", payload(r)), /unavailable/);
    assert.equal(s.get(r.id).phase, "active");
    fake.get = get;
    await game.process("push", payload(r));
    assert.equal(s.get(r.id).phase, "active");
  } finally {
    s.close();
  }
});
test("repository access restoration resumes processing and preserves finished results", async () => {
  const { s, fake, game, r } = await setup();
  try {
    await game.process("installation_repositories", {
      installation: { id: 1 },
      action: "removed",
      repositories_removed: [{ id: 2 }],
    });
    assert.equal(s.get(r.id).phase, "inaccessible");
    await game.process("installation_repositories", {
      installation: { id: 1 },
      action: "added",
      repositories_added: [{ id: 2 }],
    });
    assert.equal(s.get(r.id).phase, "active");
    await game.process("issue_comment", payload(r, "/game finish"));
    const result = s.get(r.id).result;
    await game.process("installation", {
      installation: { id: 1 },
      action: "deleted",
    });
    assert.equal(s.get(r.id).phase, "finished");
    assert.deepEqual(s.get(r.id).result, result);
  } finally {
    s.close();
  }
});
test("repository comparison limits produce a partial debrief without blocking finish", async () => {
  const { s, fake, game, r } = await setup();
  try {
    fake.merge("voting-simple", r);
    fake.tree = async () => {
      throw new Error("Unsupported file type");
    };
    for (const pr of fake.prs) pr.state = "closed";
    await game.process("push", payload(r));
    const finished = s.get(r.id);
    assert.equal(finished.phase, "finished");
    assert.equal(finished.result?.success, null);
    assert.equal(
      finished.result?.decisions.find((d) => d.id === "voting-simple")?.points,
      null,
    );
    assert.ok(
      finished.result?.warnings?.some((w) => w.includes("exercise limits")),
    );
  } finally {
    s.close();
  }
});

test("published forum runs resolve their own content and advance idempotently", async () => {
  const pack = findPackage("forum", "0.1.0"),
    { s, fake, game, r } = await setup(selectScenario(pack));
  try {
    assert.equal(Object.keys(r.prs).length, 10);
    assert.ok(fake.issues[0].body.includes("group chat"));
    assert.ok(fake.prs.some((p) => p.body.includes("/portraits/")));
    await game.process("issue_comment", payload(r, "/game finish"));
    assert.equal(s.get(r.id).result?.maximum, 20);
    await game.process("issue_comment", payload(r, "/game next"));
    const child = s.all().find((x) => x.previousRun === r.id)!;
    assert.equal(child.scenario?.stage, "growing");
    assert.equal(child.phase, "active");
    assert.equal(child.master, 1);
    assert.equal(s.get(r.id).phase, "finished");
    assert.equal(fake.refs.main, "baseline");
    assert.ok(child.base?.startsWith("play/"));
    assert.equal(Object.keys(child.prs).length, 1);
    await game.process("issue_comment", payload(r, "/game next"));
    assert.equal(s.all().length, 2);
  } finally {
    s.close();
  }
});

test("interrupted next-stage seeding resumes on repeated next command", async () => {
  const { s, fake, game, r } = await setup(
    selectScenario(findPackage("forum", "0.1.0")),
  );
  try {
    await game.process("issue_comment", payload(r, "/game finish"));
    const post = fake.post.bind(fake);
    let fail = true;
    fake.post = async (path: string, body: any) => {
      if (fail && path.endsWith("/pulls")) {
        fail = false;
        throw Object.assign(Error("Temporary GitHub failure"), { status: 503 });
      }
      return post(path, body);
    };
    await assert.rejects(
      game.process("issue_comment", payload(r, "/game next")),
      /Temporary/,
    );
    assert.equal(s.all().find((x) => x.previousRun === r.id)?.phase, "seeding");
    await game.process("issue_comment", payload(r, "/game next"));
    const child = s.all().find((x) => x.previousRun === r.id)!;
    assert.equal(child.phase, "active");
    assert.equal(s.all().length, 2);
  } finally {
    s.close();
  }
});
