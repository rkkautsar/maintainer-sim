import {
  SqlStore,
  initializeStore,
  type SqlDatabase,
} from "../storage/sql-store.ts";
export class CloudStore extends SqlStore {
  db: SqlDatabase;
  constructor(sql: SqlStorage) {
    super();
    this.db = {
      prepare: (query) => ({
        run: (...params) => ({
          changes: sql.exec(query, ...params).rowsWritten,
        }),
        get: (...params) => sql.exec(query, ...params).toArray()[0],
        all: (...params) => sql.exec(query, ...params).toArray(),
      }),
    };
    initializeStore(this.db);
  }
}
