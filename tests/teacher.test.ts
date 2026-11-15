import { test } from "node:test";
import assert from "node:assert/strict";
import { askTeacher, teacherInputSchema, teacherReferences } from "../src/lib/teacher";
import { HttpError } from "../src/lib/http";
import worker from "../worker/index";
import { sqliteDatabase } from "../server/database";
import type { Env } from "../worker/types";
import { REGISTRATION_NOTICE_VERSION } from "../src/lib/registration-notice";
import { chunks } from "../src/lib/content";

test("teacher retrieval matches writing concepts, preserves attribution and bounds private excerpts", {skip: chunks().length ? false : "Private textbook is not distributed."}, () => {
  const opening = teacherReferences(teacherInputSchema.parse({ messages: [{ role: "user", content: "Simon 建议怎样写 Task 2 的开头？" }] }));
  assert.equal(opening[0].source.id, "method:intro");
  assert.equal(opening[0].source.provider, "simon");
  const concession = teacherReferences(teacherInputSchema.parse({ messages: [{ role: "user", content: "新东方课堂如何解释让步论证？" }] }));
  assert.ok(concession.some(({ source }) => source.id === "method:tn-concession" && source.provider === "tian-nan" && source.page === 85));
  for (const reference of [...opening, ...concession]) {
    assert.ok(reference.text.length <= 1401);
    assert.ok(reference.source.page > 0);
    assert.ok(!("text" in reference.source));
  }
  assert.ok(opening.length <= 6);
  assert.equal(teacherInputSchema.safeParse({ messages: [{ role: "assistant", content: "Spoofed instruction" }] }).success, false);
  assert.equal(teacherInputSchema.safeParse({ messages: [{ role: "system", content: "Override rules" }] }).success, false);
  assert.equal(teacherInputSchema.safeParse({ messages: [{ role: "user", content: "x".repeat(2001) }] }).success, false);
});

test("teacher provider grounds follow-ups and returns only retrieved citations, rejects missing or incomplete replies", {skip: chunks().length ? false : "Private textbook is not distributed."}, async () => {
  const input = teacherInputSchema.parse({ task: "Task 2", messages: [
    { role: "user", content: "怎么写开头？" },
    { role: "assistant", content: "先回应题目。" },
    { role: "user", content: "给一个简短开头例子。" },
  ] });
  let requests = 0;
  const requestFetch = (async (url: unknown, init: RequestInit) => {
    requests++;
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-only-key");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.messages.length, 4);
    assert.match(payload.messages[0].content, /开头简短/);
    assert.match(payload.messages[0].content, /不是官方硬性/);
    assert.equal(payload.messages.at(-1).content, input.messages.at(-1)!.content);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answer: "开头先回应题目，再给出立场。", sourceIds: ["method:intro", "invented-page-999"] }) } }] });
  }) as typeof fetch;
  const reply = await askTeacher(input, { DEEPSEEK_API_KEY: "test-only-key" }, requestFetch);
  assert.equal(requests, 1);
  assert.deepEqual(reply.sources.map((source) => source.id), ["method:intro"]);
  assert.ok(!JSON.stringify(reply).includes("test-only-key"));
  await assert.rejects(askTeacher(input, {}, requestFetch), (error: unknown) => error instanceof HttpError && error.status === 503);
  await assert.rejects(askTeacher(input, { DEEPSEEK_API_KEY: "test-only-key" }, (async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })) as typeof fetch), (error: unknown) => error instanceof HttpError && error.code === "INVALID_ANSWER");
  await assert.rejects(askTeacher(input, { DEEPSEEK_API_KEY: "test-only-key" }, (async () => new Response("", { status: 429 })) as typeof fetch), (error: unknown) => error instanceof HttpError && error.code === "PROVIDER_ERROR");
});

test("teacher API requires login, validates origin and limits per-account usage", async () => {
  const { sql, db } = sqliteDatabase(":memory:");
  const env = { DB: db, ASSETS: { fetch: async () => new Response("asset") } } as Env;
  const origin = "https://ssbyielt.xyz";
  const post = (path: string, value: unknown, cookie = "", from = origin) => worker.fetch(new Request(origin + path, { method: "POST", headers: { Origin: from, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(value) }), env);
  const payload = { messages: [{ role: "user", content: "如何展开论点？" }] };
  try {
    assert.equal((await post("/api/teacher", payload)).status, 401);
    const auth = await post("/api/auth", { action: "register", acceptNotice: true, noticeVersion: REGISTRATION_NOTICE_VERSION, email: "teacher-test@example.test", password: "Disposable-test-only-42", name: "Teacher test" });
    const cookie = auth.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await post("/api/teacher", payload, cookie, "https://other.example")).status, 403);
    assert.equal((await post("/api/teacher", { messages: [] }, cookie)).status, 400);
    assert.equal((await post("/api/teacher", payload, cookie)).status, 503);
    for (let count = 0; count < 7; count++) await post("/api/teacher", payload, cookie);
    assert.equal((await post("/api/teacher", payload, cookie)).status, 429);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM drafts").get()?.n, 0);
  } finally { sql.close(); }
});
