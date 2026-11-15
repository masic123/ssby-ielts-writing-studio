import { test } from "node:test";
import assert from "node:assert/strict";
import { sqliteDatabase } from "../server/database";
import worker from "../worker/index";
import { createSession } from "../worker/auth";
import { beginReview, finishReview, getReview, listReviewHistory, listReviews } from "../worker/repository";
import { questions } from "../src/lib/content";
import type { EssayInput, Feedback } from "../src/lib/types";
import type { Env } from "../worker/types";

test("history lists omit large images and reports, preserve every record and score, and keep details owner-only", async t => {
  const { sql, db } = sqliteDatabase(":memory:");t.after(() => sql.close());
  const env = { DB: db, FREE_ACCESS_ENABLED: "true", ASSETS: { fetch: async () => new Response("asset") } } as Env;
  for (const owner of ["owner", "other"]) sql.prepare("INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)")
    .run(owner, owner + "@example.test", owner, "unused", new Date().toISOString());
  const input: EssayInput = { questionId: questions().find(q => q.task === "Task 2" && q.examType === "A")!.id,
    title: "Saved historical essay", essay: "The original essay must remain intact. ".repeat(100), targetBand: 7.5,
    customQuestion: { stem: "A complete historical question remains intact.", task: "Task 2", examType: "A", chartData: "data:image/png;base64," + "A".repeat(700_000) },
  };
  const feedback = { assessmentScope: "full", overallBand: 8, criteria: {
    taskResponse: { score: 6.5 }, coherence: { score: 7 }, lexical: { score: 7 }, grammar: { score: 7 },
  }, summary: "The original detailed report. ".repeat(500) } as Feedback;
  for (let i = 0; i < 22; i++) {
    const started = await beginReview(env, "owner", { ...input, title: input.title + i }, crypto.randomUUID(), "synthetic");
    await finishReview(env, "owner", started.review.id, feedback);
  }
  const full = await listReviews(env, "owner");
  const summary = await listReviewHistory(env, "owner");
  assert.equal(summary.length, 22);
  assert.deepEqual(summary.map(r => r.id), full.map(r => r.id));
  for (let i = 0; i < summary.length; i++) {
    assert.equal(summary[i].feedback?.overallBand, full[i].feedback?.overallBand);
    assert.equal(summary[i].input.title, full[i].input.title);
    assert.equal(summary[i].question.name, full[i].question.name);
  }
  assert.ok(JSON.stringify(summary).length < 15_000);
  assert.ok(JSON.stringify(full).length > 15_000_000);
  assert.ok(!JSON.stringify(summary).includes("base64"));
  assert.equal((await getReview(env, "owner", summary[0].id)).input.customQuestion?.chartData, input.customQuestion?.chartData);
  assert.equal((await getReview(env, "owner", summary[0].id)).feedback?.summary, feedback.summary);
  assert.deepEqual(await listReviewHistory(env, "other"), []);
  await assert.rejects(getReview(env, "other", summary[0].id), /没有找到/);
  const origin = "https://writing.example";
  const cookie = (await createSession(new Request(origin), env, "owner")).split(";")[0];
  const route = await worker.fetch(new Request(origin + "/api/reviews?summary=1", { headers: { Cookie: cookie } }), env);
  assert.equal(route.status, 200);assert.equal((await route.json()).reviews.length, 22);
  assert.equal((await worker.fetch(new Request(origin + "/api/reviews?summary=1"), env)).status, 401);
});
