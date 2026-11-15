import { startMembershipJobs } from "../worker/membership";
import { dirname, resolve } from "node:path";
import { createReviewJobs } from "./review-jobs";
import { sqliteDatabase } from "./database";
import { staticAssets } from "./assets";
import { writingServer } from "./http-server";
import type { Env } from "../worker/types";
import { existsSync } from "node:fs";

process.umask(0o077);
const origin = process.env.SITE_ORIGIN;
if (!origin) throw new Error("Set SITE_ORIGIN before starting the server");
const { sql, db } = sqliteDatabase(resolve(process.env.DATABASE_PATH || "storage/writing.sqlite"));
const identityPath = process.env.IDENTITY_DATABASE_PATH;
if (identityPath && !existsSync(identityPath)) throw new Error("Migrate the shared account database before enabling it");
const identity = identityPath ? sqliteDatabase(resolve(identityPath), { identityOnly: true }) : undefined;
const env: Env = {
  DB: db,
  AUTH_DB: identity?.db,
  FREE_ACCESS_ENABLED: process.env.FREE_ACCESS_ENABLED || "true",
  MEMBERSHIP_ENABLED: process.env.MEMBERSHIP_ENABLED || "true",
  MEMBERSHIP_REQUIRE_READY: "true",
  MEMBERSHIP_LAUNCH_DEFERRED: "false",
  MEMBERSHIP_LAUNCH_AT: "2026-11-02T00:00:00+08:00",
  MEMBERSHIP_SITE: "ielts",
  MEMBERSHIP_BUY_URL: process.env.MEMBERSHIP_BUY_URL || "https://catfk.com/shop/8VID2BZD",
  ASSETS: staticAssets(resolve(process.env.ASSET_DIRECTORY || "out")),
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  DEEPSEEK_VISION: process.env.DEEPSEEK_VISION,
  DEEPSEEK_STREAM: process.env.DEEPSEEK_STREAM,
  REGISTRATION_CODE: process.env.REGISTRATION_CODE,
  DAILY_REVIEW_LIMIT: process.env.DAILY_REVIEW_LIMIT,
};
// Both containers already mount the same private identity directory. The queue is a separate database.
const sharedQueuePath = identityPath ? resolve(dirname(identityPath), "ai-jobs.sqlite") : undefined;
const queuePath = resolve(process.env.AI_QUEUE_DATABASE_PATH || sharedQueuePath || "storage/ai-jobs.sqlite");
if (sharedQueuePath && queuePath !== sharedQueuePath) throw new Error("Both shared-account sites must use the same separate AI queue database");
const reviewJobs = createReviewJobs(env, { path: queuePath, site: "ielts" });
reviewJobs.start();
const stopMembershipJobs = startMembershipJobs(env);
const server = writingServer(env, origin, process.env.TRUST_PROXY === "true");
const port = Number(process.env.PORT || 8788);
server.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`莎试笔雅 listening on port ${port}`));
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopMembershipJobs();
    const closed = new Promise<void>(done => server.close(() => done()));
    // Stop admission and polling first, then drain/abort owned tasks before closing either database.
    void Promise.all([closed, reviewJobs.stop()]).then(() => {
      sql.close(); identity?.sql.close(); process.exit(0);
    }).catch(() => { console.error("Application shutdown did not complete cleanly"); process.exitCode = 1; });
  });
}
