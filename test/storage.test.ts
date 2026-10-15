import "./fixtures/packages.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initialRun } from "../src/engine.ts";
import { findPackage, selectScenario } from "../src/packages.ts";
import { decodeRun, encodeRun } from "../src/storage/state.ts";
import { Store } from "../src/store.ts";
import type { Run } from "../src/types.ts";

function fixture(id: string): Run {
  const pack = findPackage("forum", "0.1.0");
  return initialRun({
    id,
    installation: 1,
    repository: 2,
    owner: "owner",
    repo: "game",
    player: 3,
    scenario: selectScenario(pack),
  });
}

test("legacy bare Run JSON remains readable and new state is versioned", () => {
  const run = fixture("state");
  assert.deepEqual(decodeRun(JSON.stringify(run)), run);
  const encoded = encodeRun(run);
  assert.deepEqual(JSON.parse(encoded), { schemaVersion: 1, run });
  assert.deepEqual(decodeRun(encoded), run);
});

test("run decoding rejects future schema versions and malformed state", () => {
  const run = fixture("invalid");
  assert.throws(() => decodeRun(JSON.stringify({ schemaVersion: 2, run })));
  assert.throws(() => decodeRun(JSON.stringify({ ...run, repository: -1 })));
  assert.throws(() => decodeRun("{"));
});

test("delivery failures persist safe categories and can be retried", () => {
  const store = new Store(":memory:");
  try {
    store.enqueue("delivery", "push", "{}");
    let now = 1000;
    for (let attempt = 0; attempt < 5; attempt++) {
      const delivery = store.nextDelivery(now);
      assert.ok(delivery);
      store.failDelivery(
        delivery,
        new Error("secret token and private payload"),
        now,
      );
      now += 100_000;
    }
    assert.equal(store.hasFailed("delivery"), true);
    const [failure] = store.failures();
    assert.equal(failure?.id, "delivery");
    assert.equal(failure?.event, "push");
    assert.equal(failure?.attempts, 5);
    assert.equal(failure?.last_error, "unexpected_error");
    assert.equal(JSON.stringify(failure).includes("secret token"), false);
    store.retryFailed();
    assert.equal(store.hasFailed("delivery"), false);
    assert.deepEqual(store.nextDelivery(10_000), {
      id: "delivery",
      event: "push",
      body: "{}",
      attempts: 0,
    });
  } finally {
    store.close();
  }
});

test("prune removes only completed deliveries older than 30 days", () => {
  const store = new Store(":memory:");
  try {
    const now = 40 * 86_400_000;
    const deliveries: [string, string, number][] = [
      ["old-done", "done", 31],
      ["recent-done", "done", 29],
      ["old-pending", "pending", 31],
      ["old-failed", "failed", 31],
      ["old-intent", "intent", 31],
    ];
    for (const [id, status, age] of deliveries) {
      store.enqueue(id, status, "{}");
      store.db
        .prepare("UPDATE deliveries SET status=?,created_at=? WHERE id=?")
        .run(status, now - age * 86_400_000, id);
    }
    store.prune(now);
    const remaining = store.db
      .prepare("SELECT id FROM deliveries ORDER BY id")
      .all()
      .map((row) => row.id);
    assert.deepEqual(remaining, [
      "old-failed",
      "old-intent",
      "old-pending",
      "recent-done",
    ]);
  } finally {
    store.close();
  }
});

test("revision intents stay scoped to their run and clear by run and id", () => {
  const store = new Store(":memory:");
  try {
    const first = {
      run: "one",
      id: "pr-1",
      old: "old-a",
      head: "head-a",
      revision: 1,
    };
    const second = {
      run: "two",
      id: "pr-1",
      old: "old-b",
      head: "head-b",
      revision: 2,
    };
    const other = {
      run: "one",
      id: "pr-2",
      old: "old-c",
      head: "head-c",
      revision: 3,
    };
    store.recordRevision(first);
    store.recordRevision(second);
    store.recordRevision(other);
    assert.deepEqual(store.revisionIntents("one"), [first, other]);
    assert.deepEqual(store.revisionIntents("two"), [second]);
    store.clearRevision("one", "pr-1");
    assert.deepEqual(store.revisionIntents("one"), [other]);
    assert.deepEqual(store.revisionIntents("two"), [second]);
  } finally {
    store.close();
  }
});

test("opening a legacy SQLite database adds delivery columns and preserves pending work", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintainer-sim-storage-"));
  const path = join(dir, "legacy.sqlite");
  const oldDb = new DatabaseSync(path);
  const legacyRun = fixture("legacy-run");
  legacyRun.result = {
    complete: [],
    total: 0,
    points: 0,
    maximum: 0,
    success: null,
    harmful: [],
    debt: [],
    decisions: [],
    reasoning: "saved before migration",
  };
  oldDb.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE deliveries(id TEXT PRIMARY KEY,event TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE charges(key TEXT PRIMARY KEY,day TEXT NOT NULL,reserved REAL NOT NULL,result TEXT);
    INSERT INTO deliveries(id,event,body,status,attempts,next) VALUES('kept','push','{"preserved":true}','pending',2,0);`);
  oldDb
    .prepare("INSERT INTO runs(id,data) VALUES(?,?)")
    .run(legacyRun.id, JSON.stringify(legacyRun));
  oldDb.close();
  try {
    const store = new Store(path);
    try {
      const columns = new Set(
        store.db
          .prepare("PRAGMA table_info(deliveries)")
          .all()
          .map((row) => row.name),
      );
      assert.ok(columns.has("created_at"));
      assert.ok(columns.has("last_error"));
      const runColumns = new Set(
        store.db
          .prepare("PRAGMA table_info(runs)")
          .all()
          .map((row) => row.name),
      );
      assert.ok(runColumns.has("repository"));
      const indexes = store.db.prepare("PRAGMA index_list(runs)").all();
      assert.ok(indexes.some((index) => index.name === "runs_by_repository"));
      assert.deepEqual(store.forRepository(legacyRun.repository), [legacyRun]);

      const secondRun = fixture("second-run");
      secondRun.repository = 99;
      store.save(secondRun);
      assert.deepEqual(store.forRepository(legacyRun.repository), [legacyRun]);
      assert.deepEqual(store.forRepository(secondRun.repository), [secondRun]);
      assert.deepEqual(store.get(legacyRun.id), legacyRun);
      store.save(legacyRun);
      assert.deepEqual(
        JSON.parse(
          String(
            store.db
              .prepare("SELECT data FROM runs WHERE id=?")
              .get(legacyRun.id)?.data,
          ),
        ),
        {
          schemaVersion: 1,
          run: legacyRun,
        },
      );
      store.db
        .prepare("UPDATE runs SET data=? WHERE id=?")
        .run(
          JSON.stringify({ schemaVersion: 2, run: legacyRun }),
          legacyRun.id,
        );
      assert.throws(() => store.get(legacyRun.id));
      store.save(legacyRun);

      assert.deepEqual(store.nextDelivery(), {
        id: "kept",
        event: "push",
        body: '{"preserved":true}',
        attempts: 2,
      });
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention starts when a delayed delivery completes", () => {
  const store = new Store(":memory:");
  try {
    const now = Date.now();
    store.enqueue("delayed", "push", "{}");
    store.db
      .prepare("UPDATE deliveries SET created_at=? WHERE id='delayed'")
      .run(now - 60 * 86400000);
    store.completeDelivery("delayed", now);
    store.prune(now);
    assert.ok(
      store.db.prepare("SELECT id FROM deliveries WHERE id='delayed'").get(),
    );
    store.prune(now + 31 * 86400000);
    assert.equal(
      store.db.prepare("SELECT id FROM deliveries WHERE id='delayed'").get(),
      undefined,
    );
  } finally {
    store.close();
  }
});

test("completed pre-package runs are archived verbatim and migration is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintainer-obsolete-"));
  const path = join(dir, "game.sqlite");
  const { scenario: removed, ...old } = fixture("prototype");
  assert.ok(removed);
  const original = JSON.stringify(
    { ...old, phase: "finished", result: { points: 12 } },
    null,
    4,
  );
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE runs(id TEXT PRIMARY KEY,data TEXT NOT NULL)");
  db.prepare("INSERT INTO runs(id,data) VALUES(?,?)").run(old.id, original);
  db.close();
  try {
    const store = new Store(path);
    assert.deepEqual(store.all(), []);
    assert.equal(store.archives().length, 1);
    assert.equal(
      store.db.prepare("SELECT data FROM archived_runs WHERE id=?").get(old.id)
        ?.data,
      original,
    );
    store.close();
    const reopened = new Store(path);
    assert.equal(reopened.archives().length, 1);
    assert.deepEqual(reopened.all(), []);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
