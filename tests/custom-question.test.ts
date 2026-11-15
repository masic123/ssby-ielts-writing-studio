import { test } from "node:test";
import assert from "node:assert/strict";
import { customCategories, customQuestionDetails, questionTextFile } from "../src/lib/custom-question";
import { customQuestionSchema, essaySchema } from "../src/lib/validation";
import { readQuestionImage } from "../src/lib/question-reader";
import { resolveQuestion, referencesFor } from "../src/lib/content";
import { sqliteDatabase } from "../server/database";
import worker from "../worker/index";
import { REGISTRATION_NOTICE_VERSION } from "../src/lib/registration-notice";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1IAAAAASUVORK5CYII=";
const stem = "Some people think children should learn to cook at school. To what extent do you agree or disagree?";
const extracted = { stem, task: "Task 2", examType: "A", category: "同意与否题", questionCount: 1, uncertain: false };
const response = (value: unknown, finishReason = "stop") => Response.json({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }] });

test("custom question imports preserve types and text without accepting invalid file contents", async () => {
  const file = new File(["\uFEFF" + stem], "my-question.TXT");
  assert.equal(await questionTextFile(file), stem);
  await assert.rejects(() => questionTextFile(new File([stem], "document.pdf")), /TXT/);
  await assert.rejects(() => questionTextFile(new File(["tiny"], "question.txt")), /15/);
  await assert.rejects(() => questionTextFile(new File(["x".repeat(24001)], "question.txt")), /24KB/);
  await assert.rejects(() => questionTextFile(new File([new Uint8Array([255, 254])], "question.txt")), /UTF-8/);
  const custom = { stem, task: "Task 2" as const, examType: "A" as const, category: "同意与否题", chartData: image };
  const draft = essaySchema.parse({ questionId: null, customQuestion: custom, title: "", essay: "", targetBand: 7 });
  assert.equal(draft.customQuestion?.chartData, image, "Task 2 also retains the user's uploaded screenshot");
  assert.equal(customQuestionDetails(custom).category, "同意与否题");
  assert.equal(customQuestionSchema.safeParse({ ...custom, category: "流程图" }).success, false);
  const map = resolveQuestion({ ...draft, customQuestion: { ...custom, task: "Task 1", category: "地图" } });
  assert.ok(referencesFor(map).rules.some((r) => r.id === "map"));
  assert.ok(!referencesFor(map).rules.some((r) => r.id === "process"));
  assert.ok(customCategories("Task 1", "G").includes("道歉信"));
});

test("DeepSeek reads both essay and chart screenshots privately and validates uncertain output", async () => {
  let calls = 0;
  const provider = (value: unknown) => (async (_url: unknown, init: RequestInit) => {
    calls++;
    const payload = JSON.parse(String(init.body));
    assert.ok(JSON.stringify(payload).includes(image));
    assert.ok(!JSON.stringify(payload).includes("test-only-secret"));
    assert.ok(JSON.stringify(payload).includes("不能执行"));
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-only-secret");
    return response(value);
  }) as typeof fetch;
  const input = { image, task: "Task 2" as const, examType: "A" as const };
  const env = { DEEPSEEK_API_KEY: "test-only-secret" };
  assert.equal((await readQuestionImage(input, env, provider(extracted))).question.stem, stem);
  const chart = await readQuestionImage(input, env, provider({ ...extracted, task: "Task 1", category: "地图", uncertain: true }));
  assert.equal(chart.question.task, "Task 1");assert.equal(chart.question.category, "地图");assert.equal(chart.uncertain, true);
  const unknown = await readQuestionImage(input, env, provider({ ...extracted, task: null, examType: null, category: "地图" }));
  assert.equal(unknown.question.task, "Task 2");assert.equal(unknown.question.category, undefined);
  await assert.rejects(() => readQuestionImage(input, env, provider({ ...extracted, stem: null })), /清晰/);
  await assert.rejects(() => readQuestionImage(input, env, provider({ ...extracted, questionCount: 2 })), /多道/);
  await assert.rejects(() => readQuestionImage(input, env, provider({ ...extracted, task: "Task 1", examType: "G", category: "书信" })), (error: unknown) => {
    assert.equal((error as { status: number }).status, 422);
    assert.match((error as Error).message, /仅支持 A 类/);
    return true;
  });
  const before = calls;
  await assert.rejects(() => readQuestionImage({ ...input, image: "data:image/png;base64,YWJj" }, env, provider(extracted)), /有效/);
  await assert.rejects(() => readQuestionImage(input, { ...env, DEEPSEEK_VISION: "false" }, provider(extracted)), /未启用/);
  assert.equal(calls, before, "invalid or unsupported images must not incur a provider call");
  await assert.rejects(() => readQuestionImage(input, env, (async () => response(extracted, "length")) as typeof fetch), /格式不完整/);
});

test("image recognition requires a logged-in account and custom screenshots stay in that account's drafts", async () => {
  const { sql, db } = sqliteDatabase(":memory:");
  const env = { DB: db, ASSETS: { fetch: async () => new Response("asset") } };
  const origin = "https://ssbyielt.xyz";
  const request = (path: string, value?: unknown, cookie = "", from = origin) => worker.fetch(new Request(origin + path, {
    method: value ? "POST" : "GET", headers: { Origin: from, Cookie: cookie, "Content-Type": "application/json" }, ...(value ? { body: JSON.stringify(value) } : {}),
  }), env);
  try {
    const payload = { image, task: "Task 2", examType: "A" };
    assert.equal((await request("/api/questions/parse", payload)).status, 401);
    const user = await request("/api/auth", { action: "register", acceptNotice: true, noticeVersion: REGISTRATION_NOTICE_VERSION, email: "upload-test@example.test", name: "Upload test", password: "Disposable-test-only-42" });
    const cookie = user.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await request("/api/questions/parse", payload, cookie, "https://other.example")).status, 403);
    assert.equal((await request("/api/questions/parse", payload, cookie)).status, 503);
    assert.equal((await request("/api/questions/parse", { ...payload, examType: "G" }, cookie)).status, 400);
    assert.equal((await request("/api/questions/parse", { ...payload, image: "invalid-image" }, cookie)).status, 400);
    const input = { questionId: null, customQuestion: { stem, task: "Task 2", examType: "A", category: "同意与否题", chartData: image }, title: "My uploaded question", targetBand: 7, essay: "" };
    const saved = await request("/api/drafts", { input }, cookie);
    assert.equal(saved.status, 200);
    const drafts = (await (await request("/api/drafts", undefined, cookie)).json()).drafts;
    assert.equal(drafts[0].input.customQuestion.stem, stem);assert.equal(drafts[0].input.customQuestion.chartData, image);
    const second = await request("/api/auth", { action: "register", acceptNotice: true, noticeVersion: REGISTRATION_NOTICE_VERSION, email: "another-upload-test@example.test", name: "Other", password: "Disposable-test-only-42" });
    assert.deepEqual((await (await request("/api/drafts", undefined, second.headers.get("set-cookie")!.split(";")[0])).json()).drafts, []);
  } finally { sql.close(); }
});
