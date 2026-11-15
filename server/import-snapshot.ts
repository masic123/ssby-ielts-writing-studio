import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";

export const snapshotColumns = {
  users: ["id", "email", "name", "password", "created_at"],
  drafts: ["id", "user_id", "input", "version", "updated_at", "word_count"],
  reviews: ["id", "user_id", "draft_id", "input", "question", "status", "feedback", "error", "model", "refs", "request_key", "created_at"],
} as const;
type Table = keyof typeof snapshotColumns;
type Row = Record<string, SQLInputValue>;
export type Snapshot = {
  version: number;
  tables: Record<Table, Row[]>;
  counts: Record<Table, number>;
  checksum: string;
  provider: Record<string, string>;
};

export function importSnapshot(sql: DatabaseSync, snapshot: Snapshot) {
  if (snapshot.version !== 1) throw new Error("Unsupported snapshot version");
  const checksum = createHash("sha256").update(JSON.stringify(snapshot.tables)).digest("hex");
  if (checksum !== snapshot.checksum) throw new Error("Snapshot checksum mismatch");
  for (const table of Object.keys(snapshotColumns) as Table[]) {
    if (!Array.isArray(snapshot.tables[table]) || snapshot.tables[table].length !== snapshot.counts[table]) throw new Error("Snapshot count mismatch");
    if (Number(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n)) throw new Error("Refusing to overwrite a populated database");
    for (const row of snapshot.tables[table]) {
      if (Object.keys(row).length !== snapshotColumns[table].length || Object.keys(row).some((key) => !(snapshotColumns[table] as readonly string[]).includes(key))) throw new Error("Unexpected snapshot columns");
      if (table === "reviews" && row.status === "processing") throw new Error("Wait for in-flight reviews before migrating");
    }
  }
  sql.exec("BEGIN IMMEDIATE");
  try {
    for (const table of Object.keys(snapshotColumns) as Table[]) {
      const columns = snapshotColumns[table];
      const insert = sql.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`);
      for (const row of snapshot.tables[table]) insert.run(...columns.map((key) => row[key]));
    }
    if (sql.prepare("PRAGMA foreign_key_check").all().length || Object.values(sql.prepare("PRAGMA quick_check").get() || {})[0] !== "ok") throw new Error("Imported database integrity check failed");
    for (const table of Object.keys(snapshotColumns) as Table[]) {
      const rows = sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      if (JSON.stringify(rows) !== JSON.stringify(snapshot.tables[table])) throw new Error("Imported rows differ from the source snapshot");
    }
    sql.exec("COMMIT");
  } catch (error) { sql.exec("ROLLBACK"); throw error; }
  return { counts: snapshot.counts, checksum, integrity: "ok" };
}
