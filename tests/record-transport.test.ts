import { test } from "node:test";
import assert from "node:assert/strict";
import { sqliteDatabase } from "../server/database";
import { writingServer } from "../server/http-server";
import { createSession } from "../worker/auth";
import { beginReview, finishReview, saveDraft } from "../worker/repository";
import { materializeRecord, readRecord, retainSubmittedImage } from "../src/lib/record-client";
import { ApiError } from "../src/lib/api-client";
import type { Draft, EssayInput, Feedback, Review } from "../src/lib/types";
import type { Env } from "../worker/types";

const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1IAAAAASUVORK5CYII=", "base64");

test("real HTTP reads separate large images from lists, report bodies and save acknowledgments without losing input", async t => {
  const { sql, db } = sqliteDatabase(":memory:");
  const env = { DB: db, FREE_ACCESS_ENABLED: "true", MEMBERSHIP_ENABLED: "false", ASSETS: { fetch: async () => new Response("asset") } } as Env;
  for (const id of ["owner", "other"]) sql.prepare("INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)")
    .run(id, id + "@example.test", id, "unused", new Date().toISOString());
  const bytes = Buffer.concat([tiny, Buffer.alloc(900_000 - tiny.length)]);
  const image = "data:image/png;base64," + bytes.toString("base64");
  const input: EssayInput = { questionId: null, customQuestion: { stem: "Some people think practical skills should be taught at school. To what extent do you agree?", task: "Task 2", examType: "A", chartData: image },
    title: "Original large-image draft", essay: "The exact original essay must be retained with the original uploaded image.", targetBand: 7.5 };
  const draft = await saveDraft(env, "owner", input);
  const begun = await beginReview(env, "owner", input, crypto.randomUUID(), "synthetic", draft.id);
  const criterion = { score: 7, reason: "Synthetic reason", evidence: "Synthetic evidence" };
  const feedback = { assessmentScope: "full", overallBand: 7, criteria: { taskResponse: criterion, coherence: criterion, lexical: criterion, grammar: criterion }, summary: "Original detailed report content." } as Feedback;
  await finishReview(env, "owner", begun.review.id, feedback);
  const originalDraft = sql.prepare("SELECT * FROM drafts WHERE id=?").get(draft.id);
  const originalReview = sql.prepare("SELECT * FROM reviews WHERE id=?").get(begun.review.id);
  const origin = "https://writing.example";
  const ownerCookie = (await createSession(new Request(origin), env, "owner")).split(";")[0];
  const otherCookie = (await createSession(new Request(origin), env, "other")).split(";")[0];
  const server = writingServer(env, origin);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();assert.ok(address && typeof address !== "string");
  const local = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve()));sql.close(); });
  const request = (path: string, cookie = ownerCookie, body?: unknown) => fetch(local + path, { method: body ? "POST" : "GET", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const summary = await (await request("/api/drafts?summary=1")).text();
  assert.ok(summary.length < 1000);assert.equal(JSON.parse(summary).drafts[0].id, draft.id);
  const compactDraft = (await (await request(`/api/drafts?id=${draft.id}&view=editor`)).json()).draft as Draft;
  const compactReview = (await (await request(`/api/reviews?id=${begun.review.id}&view=report`)).json()).review as Review;
  assert.ok(JSON.stringify(compactDraft).length < 2500);assert.ok(JSON.stringify(compactReview).length < 30_000);
  assert.equal(compactReview.input.customQuestion?.chartData, undefined);
  assert.deepEqual(compactReview.feedback, feedback);
  const originalFetch = globalThis.fetch;
  let attachmentCalls = 0;
  globalThis.fetch = (async (url, options) => { attachmentCalls++;return originalFetch(local + url, { ...options, headers: { Cookie: ownerCookie } }); }) as typeof fetch;
  let restored: Draft;
  try {
    restored = await materializeRecord(compactDraft);
    assert.deepEqual(restored.input, input);assert.equal(attachmentCalls, 1);
    assert.deepEqual((await retainSubmittedImage(compactDraft, input)).input, input);
    assert.equal(attachmentCalls, 1, "saving must not download an image it already uploaded");
  } finally { globalThis.fetch = originalFetch; }
  const assetUrl = compactReview.attachments!.chart.url;
  const asset = await request(assetUrl);assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control")!, /no-store/);assert.deepEqual(Buffer.from(await asset.arrayBuffer()), bytes);
  for (const path of ["/api/drafts?summary=1", `/api/drafts?id=${draft.id}&view=editor`, assetUrl]) assert.equal((await request(path, "")).status, 401);
  for (const path of [`/api/drafts?id=${draft.id}&view=editor`, assetUrl]) assert.equal((await request(path, otherCookie)).status, 404);
  assert.deepEqual((await (await request("/api/drafts?summary=1", otherCookie)).json()).drafts, []);
  assert.equal((await (await request(`/api/reviews?id=${begun.review.id}`)).json()).review.input.customQuestion.chartData, image, "old clients still receive original input");
  assert.deepEqual(sql.prepare("SELECT * FROM drafts WHERE id=?").get(draft.id), originalDraft);
  assert.deepEqual(sql.prepare("SELECT * FROM reviews WHERE id=?").get(begun.review.id), originalReview);
  const saved = await request("/api/drafts?view=editor", ownerCookie, { id: draft.id, version: draft.version, input });
  const acknowledgment = await saved.text();assert.equal(saved.status, 200);assert.ok(acknowledgment.length < 2500);
  assert.equal(JSON.parse(acknowledgment).draft.version, draft.version, "identical save remains idempotent");
});

test("record reads retry interrupted JSON once, stop on owner errors and honor cancellation", async () => {
  let calls = 0;
  const value = await readRecord(async () => { if (++calls === 1) throw new ApiError("Interrupted body", 200, "INVALID_RESPONSE"); return "complete report"; });
  assert.equal(value, "complete report");assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(readRecord(async () => { calls++;throw new ApiError("Wrong owner", 404); }));assert.equal(calls, 1);
  const controller = new AbortController();
  await assert.rejects(readRecord(async () => { controller.abort();throw new TypeError("Offline"); }, controller.signal), e => (e as Error).name === "AbortError");
});

test("an incomplete image cannot become writable input or overwrite the saved image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
  const record = { id: "synthetic", input: { customQuestion: { stem: "The saved original prompt", task: "Task 2", examType: "A" } },
    attachments: { chart: { url: "/api/drafts?id=synthetic&asset=chart", mimeType: "image/png", bytes: 900_000, sha256: "0".repeat(64) } },
  } as Draft;
  try { await assert.rejects(materializeRecord(record), e => e instanceof ApiError && e.code === "ATTACHMENT_INCOMPLETE"); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(record.input.customQuestion?.chartData, undefined);
});
