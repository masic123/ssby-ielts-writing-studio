import { test } from "node:test";
import assert from "node:assert/strict";
import { sqliteDatabase } from "../server/database";
import type { Env } from "../worker/types";
import { getReview, listReviews } from "../worker/repository";
import { getLeaderboard, getQuestionStats, recordReviewPoints } from "../worker/leaderboard";
import { questions } from "../src/lib/content";

const now = new Date("2026-11-03T04:00:00.000Z");
const beforeToday = "2026-11-02T15:59:59.000Z";
const today = "2026-11-02T16:00:00.000Z";

function fixture() {
  const { sql, db } = sqliteDatabase(":memory:");
  const env = { DB: db, FREE_ACCESS_ENABLED: "true", ASSETS: { fetch: async () => new Response("asset") } } as Env;
  for (const id of ["one", "two"]) sql.prepare("INSERT INTO users(id,name,email,password,created_at) VALUES(?,?,?,?,?)")
    .run(id, id, id + "@example.test", "unused", today);
  const questionId = questions()[0].id;
  function review(id: string, owner: string, scores: unknown[], storedBand: number | null, date = today, essay = "An original synthetic answer.", scope = "full") {
    const criteria = Object.fromEntries(["taskResponse", "coherence", "lexical", "grammar"].map((key, i) => [key, { score: scores[i], reason: "synthetic reason", evidence: "synthetic evidence" }]));
    const feedback = { overallBand: storedBand, criteria, assessmentScope: scope };
    sql.prepare("INSERT INTO reviews(id,user_id,input,question,status,feedback,model,refs,request_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, owner, JSON.stringify({ questionId, essay }), JSON.stringify({ id: questionId, task: "Task 2", examType: "A" }), "completed", JSON.stringify(feedback), "test", "[]", id, date);
    return feedback;
  }
  return { sql, db, env, questionId, review, request: new Request("https://local.test/api/leaderboard") };
}

test("old reports display the downward score without rewriting feedback or criterion scores", async t => {
  const f = fixture(); t.after(() => f.sql.close());
  const original = f.review("old", "one", [6, 6, 6, 7], 6.5);
  f.review("limited", "one", [null, 6, 6, 7], null, today, "A limited synthetic answer.", "language_only");
  assert.equal((await getReview(f.env, "one", "old")).feedback?.overallBand, 6);
  assert.equal((await listReviews(f.env, "one")).find(r => r.id === "old")?.feedback?.overallBand, 6);
  assert.deepEqual((await getReview(f.env, "one", "old")).feedback?.criteria, original.criteria);
  assert.equal((await getReview(f.env, "one", "limited")).feedback?.overallBand, null);
  assert.deepEqual(JSON.parse(String(f.sql.prepare("SELECT feedback FROM reviews WHERE id='old'").get()!.feedback)), original);
});

test("historical correction preserves duplicate answers, award dates and daily boundaries", async t => {
  const f = fixture(); t.after(() => f.sql.close());
  f.review("old", "one", [6, 6, 6, 7], 6.5, beforeToday);
  f.review("duplicate", "one", [8, 8, 8, 8], 8, today);
  f.review("revised", "one", [6, 7, 7, 7], 7, today, "A revised synthetic answer.");
  f.review("peer", "two", [6.5, 6.5, 6.5, 6.5], 6.5);
  // Initialize the ledger, then restore its old rounding to exercise correction of existing rows.
  await recordReviewPoints(f.env, "old", new Date(beforeToday));
  await recordReviewPoints(f.env, "duplicate", new Date(today));
  await recordReviewPoints(f.env, "revised", new Date(today));
  await recordReviewPoints(f.env, "peer", new Date(today));
  f.sql.prepare("UPDATE leaderboard_receipts SET points_units=13 WHERE review_id='old'").run();
  f.sql.prepare("UPDATE leaderboard_receipts SET points_units=14 WHERE review_id='revised'").run();
  const unchanged = f.sql.prepare("SELECT review_id,user_id,fingerprint,awarded_at FROM leaderboard_receipts ORDER BY review_id").all();
  const storedReviews = f.sql.prepare("SELECT * FROM reviews ORDER BY id").all();
  const board = await getLeaderboard(f.request, f.env, now);
  assert.deepEqual(board.daily.map(r => [r.name, r.rank, r.points, r.attempts]), [["one", 1, 6.5, 1], ["two", 1, 6.5, 1]]);
  assert.equal(board.total.find(r => r.name === "one")!.points, 12.5);
  assert.equal(board.total.find(r => r.name === "one")!.attempts, 2);
  assert.deepEqual(f.sql.prepare("SELECT review_id,user_id,fingerprint,awarded_at FROM leaderboard_receipts ORDER BY review_id").all(), unchanged);
  assert.deepEqual(f.sql.prepare("SELECT * FROM reviews ORDER BY id").all(), storedReviews);
  assert.equal(f.sql.prepare("SELECT points_units FROM leaderboard_receipts WHERE review_id='old'").get()!.points_units, 12);
  assert.equal(f.sql.prepare("SELECT points_units FROM leaderboard_receipts WHERE review_id='revised'").get()!.points_units, 13);
  assert.deepEqual(await getLeaderboard(f.request, f.env, now), board);
});

test("new receipts and question statistics use the same downward score", async t => {
  const f = fixture(); t.after(() => f.sql.close());
  f.review("new", "one", [6, 6, 6, 7], 6.5);
  await recordReviewPoints(f.env, "new", now);
  await recordReviewPoints(f.env, "new", new Date(now.getTime() + 1000));
  const board = await getLeaderboard(f.request, f.env, now);
  assert.equal(board.daily[0].points, 6);
  assert.equal(board.daily[0].attempts, 1);
  assert.deepEqual((await getQuestionStats(f.env)).stats, [{ questionId: f.questionId, participants: 1, averageScore: 6 }]);
  assert.equal((await getReview(f.env, "one", "new")).feedback?.overallBand, 6);
});

test("historical correction handles multiple pages and leaves incomplete old scores unchanged", async t => {
  const f = fixture(); t.after(() => f.sql.close());
  for (let i = 0; i < 103; i++) {
    const id = "page-" + String(i).padStart(3, "0");
    f.review(id, "one", [6, 6, 6, 7], 6.5, today, "Synthetic answer " + i);
    await recordReviewPoints(f.env, id, new Date(today));
  }
  f.review("unknown", "two", [null, 6, 6, 7], 6.5);
  await recordReviewPoints(f.env, "unknown", new Date(today));
  f.review("boolean", "two", [true, 6, 6, 7], 6.5);
  await recordReviewPoints(f.env, "boolean", new Date(today));
  f.sql.prepare("UPDATE leaderboard_receipts SET points_units=13").run();
  await getLeaderboard(f.request, f.env, now);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM leaderboard_receipts WHERE points_units=12").get()!.n, 103);
  assert.equal(f.sql.prepare("SELECT points_units FROM leaderboard_receipts WHERE review_id='unknown'").get()!.points_units, 13);
  assert.equal(f.sql.prepare("SELECT points_units FROM leaderboard_receipts WHERE review_id='boolean'").get()!.points_units, 13);
});
