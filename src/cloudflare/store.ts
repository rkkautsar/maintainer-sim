import type { Persistence } from "../persistence.ts";
import type { Run } from "../types.ts";
export class CloudStore implements Persistence {
  db: {
    prepare: (query: string) => {
      run: (...params: any[]) => { changes: number };
      get: (...params: any[]) => any;
      all: (...params: any[]) => any[];
    };
  };
  constructor(sql: SqlStorage) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,event TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL DEFAULT 0)`,
    );
    this.db = {
      prepare: (query) => ({
        run: (...params) => {
          const cursor = sql.exec(query, ...params);
          return { changes: cursor.rowsWritten };
        },
        get: (...params) => sql.exec(query, ...params).toArray()[0],
        all: (...params) => sql.exec(query, ...params).toArray(),
      }),
    };
  }
  save(run: Run) {
    this.db
      .prepare(
        "INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(run.id, JSON.stringify(run));
  }
  get(id: string): Run {
    const row = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id);
    if (!row) throw new Error("Unknown run");
    return JSON.parse(row.data);
  }
  all(): Run[] {
    return this.db
      .prepare("SELECT data FROM runs")
      .all()
      .map((r) => JSON.parse(r.data));
  }
  enqueue(id: string, event: string, body: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO deliveries(id,event,body) VALUES(?,?,?)")
      .run(id, event, body);
  }
}
