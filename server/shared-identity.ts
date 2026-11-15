import type { DatabaseSync } from "node:sqlite";

/** Run with both applications stopped, after backing up each database. */
export function migrateSharedIdentity(identity: DatabaseSync, sources: DatabaseSync[]) {
  const result = { importedAccounts: 0, linkedAccounts: 0, remappedAccounts: 0, importedSessions: 0 };
  for (const source of sources) {
    if (Number(source.prepare("SELECT COUNT(*) n FROM reviews WHERE status='processing'").get()?.n))
      throw new Error("Wait for active reviews before migrating shared accounts");
    const users = source.prepare("SELECT * FROM users ORDER BY created_at,id").all();
    for (const user of users) {
      const existing = identity.prepare("SELECT id FROM users WHERE email=?").get(String(user.email));
      const id = existing ? String(existing.id) : String(user.id);
      if (!existing) {
        identity.prepare("INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)")
          .run(id, String(user.email), String(user.name), String(user.password), String(user.created_at));
        result.importedAccounts++;
      } else result.linkedAccounts++;
      if (id !== user.id) {
        source.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;");
        try {
          source.prepare("UPDATE users SET id=? WHERE id=?").run(id, String(user.id));
          for (const table of ["sessions", "drafts", "reviews"])
            source.prepare(`UPDATE ${table} SET user_id=? WHERE user_id=?`).run(id, String(user.id));
          source.exec("COMMIT;");
          result.remappedAccounts++;
        } catch (error) { source.exec("ROLLBACK;"); throw error; }
      }
    }
    for (const session of source.prepare("SELECT * FROM sessions").all()) {
      const existing = identity.prepare("SELECT user_id FROM sessions WHERE token_hash=?").get(String(session.token_hash));
      if (existing && existing.user_id !== session.user_id) throw new Error("Session identity conflict");
      if (!existing) {
        identity.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
          .run(String(session.token_hash), String(session.user_id), Number(session.expires_at));
        result.importedSessions++;
      }
    }
    if (source.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Practice ownership check failed");
  }
  return result;
}
