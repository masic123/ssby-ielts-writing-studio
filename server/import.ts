import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { sqliteDatabase } from "./database";
import { importSnapshot, type Snapshot } from "./import-snapshot";

process.umask(0o077);
const [source, destination, envFile] = process.argv.slice(2);
if (!source || !destination || !envFile || existsSync(envFile)) throw new Error("Provide snapshot, new database, and a new environment file");
const snapshot: Snapshot = JSON.parse(readFileSync(source, "utf8"));
const keys = ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "DEEPSEEK_VISION", "REGISTRATION_CODE", "DAILY_REVIEW_LIMIT"];
const config = ["SITE_ORIGIN=https://ssbyielt.xyz", ...keys.map((key) => {
  const value = snapshot.provider[key] || "";
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid environment value");
  return `${key}=${value}`;
})].join("\n") + "\n";
const { sql } = sqliteDatabase(destination);
try {
  const result = importSnapshot(sql, snapshot);
  writeFileSync(envFile, config, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
} finally { sql.close(); }
