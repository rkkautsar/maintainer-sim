import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Run } from "./types.ts";
export class Store {
  db: DatabaseSync;
  constructor(path = "var/game.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,event TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS charges(key TEXT PRIMARY KEY,day TEXT NOT NULL,reserved REAL NOT NULL,result TEXT);
 `);
  }
  save(run: Run) {
    this.db
      .prepare(
        "INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(run.id, JSON.stringify(run));
  }
  get(id: string): Run {
    const row = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new Error("Unknown run");
    return JSON.parse(row.data);
  }
  all(): Run[] {
    return (
      this.db.prepare("SELECT data FROM runs").all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  enqueue(id: string, event: string, body: string) {
    return (
      this.db
        .prepare(
          "INSERT OR IGNORE INTO deliveries(id,event,body) VALUES(?,?,?)",
        )
        .run(id, event, body).changes > 0
    );
  }
  reserve(
    key: string,
    cost: number,
    limit: number,
    day = new Date().toISOString().slice(0, 10),
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT key FROM charges WHERE key=?").get(key)) {
        this.db.exec("COMMIT");
        return false;
      }
      const total = (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(reserved),0) AS total FROM charges WHERE day=?",
          )
          .get(day) as { total: number }
      ).total;
      if (total + cost > limit) {
        this.db.exec("COMMIT");
        return false;
      }
      this.db
        .prepare("INSERT INTO charges(key,day,reserved) VALUES(?,?,?)")
        .run(key, day, cost);
      this.db.exec("COMMIT");
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
