import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqlStore, initializeStore } from "./storage/sql-store.ts";
export class Store extends SqlStore {
  db: DatabaseSync;
  constructor(path = "var/game.sqlite") {
    super();
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
    initializeStore(this.db);
  }
  close() {
    this.db.close();
  }
}
