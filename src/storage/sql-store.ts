import { z } from "zod";
import { failureCode } from "../diagnostics.ts";
import { seedStepFrom } from "../game/seed-steps.ts";
import type { Persistence, RevisionIntent } from "../persistence.ts";
import type { Run } from "../types.ts";
import { parse } from "../validation.ts";
import { decodeRun, encodeRun } from "./state.ts";
export type SqlValue = string | number | null;
export interface SqlDatabase {
  prepare(query: string): {
    run(...values: SqlValue[]): { changes: number | bigint };
    get(...values: SqlValue[]): Record<string, unknown> | undefined;
    all(...values: SqlValue[]): Record<string, unknown>[];
  };
}
/** Additive migrations shared by Node SQLite and Durable Object SQLite. */
export function initializeStore(db: SqlDatabase): void {
  const run = (query: string, ...params: SqlValue[]) =>
    db.prepare(query).run(...params);
  run(
    "CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  run(
    "CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,event TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL DEFAULT 0)",
  );
  run(
    "CREATE TABLE IF NOT EXISTS archived_runs(id TEXT PRIMARY KEY,data TEXT NOT NULL,reason TEXT NOT NULL,archived_at INTEGER NOT NULL)",
  );
  // Preserve completed pre-package prototypes verbatim before removing them
  // from the current game index. Future schemas and active records fail closed.
  const obsolete =
    "json_type(data,'$.schemaVersion') IS NULL AND json_type(data,'$.scenario') IS NULL AND json_extract(data,'$.phase')='finished'";
  run(
    `INSERT OR IGNORE INTO archived_runs(id,data,reason,archived_at) SELECT id,data,'pre_scenario_format',? FROM runs WHERE ${obsolete}`,
    Date.now(),
  );
  run(
    `DELETE FROM runs WHERE ${obsolete} AND EXISTS(SELECT 1 FROM archived_runs a WHERE a.id=runs.id AND a.data=runs.data AND a.reason='pre_scenario_format')`,
  );
  const runColumns = new Set(
    db
      .prepare("PRAGMA table_info(runs)")
      .all()
      .map((row) => row.name),
  );
  if (!runColumns.has("repository"))
    run("ALTER TABLE runs ADD COLUMN repository INTEGER");
  run(
    "UPDATE runs SET repository=COALESCE(json_extract(data,'$.run.repository'),json_extract(data,'$.repository')) WHERE repository IS NULL",
  );
  run("CREATE INDEX IF NOT EXISTS runs_by_repository ON runs(repository)");
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(deliveries)")
      .all()
      .map((row) => row.name),
  );
  if (!columns.has("created_at"))
    run(
      "ALTER TABLE deliveries ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
    );
  if (!columns.has("last_error"))
    run("ALTER TABLE deliveries ADD COLUMN last_error TEXT");
  if (!columns.has("last_step"))
    run("ALTER TABLE deliveries ADD COLUMN last_step TEXT");
  if (!columns.has("completed_at"))
    run("ALTER TABLE deliveries ADD COLUMN completed_at INTEGER");
  run("UPDATE deliveries SET created_at=? WHERE created_at=0", Date.now());
  run("CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(status,next)");
  run(
    "CREATE INDEX IF NOT EXISTS deliveries_retention ON deliveries(status,created_at)",
  );
}

const deliverySchema = z.object({
  id: z.string(),
  event: z.string(),
  body: z.string(),
  attempts: z.number(),
});
export type Delivery = z.infer<typeof deliverySchema>;
const intentSchema = z.object({
  run: z.string(),
  id: z.string(),
  old: z.string(),
  head: z.string(),
  revision: z.number().int().nonnegative(),
});
export abstract class SqlStore implements Persistence {
  abstract db: SqlDatabase;
  save(run: Run) {
    this.db
      .prepare(
        "INSERT INTO runs(id,data,repository) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,repository=excluded.repository",
      )
      .run(run.id, encodeRun(run), run.repository);
  }
  get(id: string): Run {
    const row = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id);
    if (!row) throw Error("Unknown run");
    return decodeRun(String(row.data));
  }
  all(): Run[] {
    return this.db
      .prepare("SELECT data FROM runs")
      .all()
      .map((row) => decodeRun(String(row.data)));
  }
  forRepository(repository: number): Run[] {
    return this.db
      .prepare("SELECT data FROM runs WHERE repository=?")
      .all(repository)
      .map((row) => decodeRun(String(row.data)));
  }
  enqueue(id: string, event: string, body: string): boolean {
    return (
      Number(
        this.db
          .prepare(
            "INSERT OR IGNORE INTO deliveries(id,event,body,created_at) VALUES(?,?,?,?)",
          )
          .run(id, event, body, Date.now()).changes,
      ) > 0
    );
  }
  nextDelivery(now = Date.now()): Delivery | undefined {
    const row = this.db
      .prepare(
        "SELECT id,event,body,attempts FROM deliveries WHERE status='pending' AND next<=? ORDER BY rowid LIMIT 1",
      )
      .get(now);
    return row ? parse(deliverySchema, row) : undefined;
  }
  completeDelivery(id: string, now = Date.now()) {
    this.db
      .prepare("UPDATE deliveries SET status='done',completed_at=? WHERE id=?")
      .run(now, id);
  }
  failDelivery(row: Delivery, error: unknown, now = Date.now()) {
    const attempts = row.attempts + 1;
    this.db
      .prepare(
        "UPDATE deliveries SET attempts=?,next=?,status=?,last_error=?,last_step=? WHERE id=?",
      )
      .run(
        attempts,
        now + Math.min(60000, 1000 * 2 ** attempts),
        attempts >= 5 ? "failed" : "pending",
        failureCode(error),
        seedStepFrom(error) ?? null,
        row.id,
      );
  }
  retryFailed() {
    this.db
      .prepare(
        "UPDATE deliveries SET status='pending',attempts=0,next=0 WHERE status='failed'",
      )
      .run();
  }
  hasFailed(id: string): boolean {
    return !!this.db
      .prepare("SELECT id FROM deliveries WHERE id=? AND status='failed'")
      .get(id);
  }
  nextDeliveryTime(): number | undefined {
    const due = this.db
      .prepare("SELECT MIN(next) AS due FROM deliveries WHERE status='pending'")
      .get()?.due;
    return typeof due === "number" ? due : undefined;
  }
  archives() {
    return this.db
      .prepare(
        "SELECT id,reason,archived_at FROM archived_runs ORDER BY archived_at",
      )
      .all();
  }
  failures() {
    return this.db
      .prepare(
        "SELECT id,event,attempts,last_error,last_step FROM deliveries WHERE status='failed'",
      )
      .all();
  }
  recordRevision(intent: RevisionIntent) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO deliveries(id,event,body,status,created_at) VALUES(?,?,?,'intent',?)",
      )
      .run(
        `revision:${intent.run}:${intent.id}`,
        "revision",
        JSON.stringify(intent),
        Date.now(),
      );
  }
  revisionIntents(run: string): RevisionIntent[] {
    return this.db
      .prepare(
        "SELECT body FROM deliveries WHERE event='revision' AND status='intent'",
      )
      .all()
      .map((row) => parse(intentSchema, JSON.parse(String(row.body))))
      .filter((intent) => intent.run === run);
  }
  clearRevision(run: string, id: string) {
    this.db
      .prepare("DELETE FROM deliveries WHERE id=?")
      .run(`revision:${run}:${id}`);
  }
  // Keep deduplication records for 30 days. Failed work and mutation intents are never pruned automatically.
  prune(now = Date.now()) {
    this.db
      .prepare(
        "DELETE FROM deliveries WHERE status='done' AND COALESCE(completed_at,created_at)<?",
      )
      .run(now - 30 * 86400000);
  }
}
