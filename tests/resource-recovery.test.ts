import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { API_REQUEST_TIMEOUT_MS, ApiError, createApiClient } from "../src/lib/api-client";
import { createResourceLoader } from "../src/lib/resource-loader";
import { mergeDraftHistory, mergeReviewHistory } from "../src/lib/history-merge";
import type { Draft, Review } from "../src/lib/types";

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function mockFetch(t: TestContext, request: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = request;
  t.after(() => { globalThis.fetch = original; });
}

test("a hung history fetch releases at its deadline even when fetch ignores abort", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal!: AbortSignal;
  mockFetch(t, (async (_url, options) => { signal = options!.signal!; return new Promise(() => {}); }) as typeof fetch);
  const request = createApiClient("test:expired")("/api/drafts");
  const rejected = assert.rejects(request, e => e instanceof ApiError && e.code === "REQUEST_TIMEOUT");
  t.mock.timers.tick(API_REQUEST_TIMEOUT_MS);await rejected;
  assert.equal(signal.aborted, true);
});

test("a truncated or stalled JSON body also has a deadline; explicit cancellation wins", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"reviews":')); } });
  mockFetch(t, (async () => new Response(body)) as typeof fetch);
  const api = createApiClient("test:expired");
  const rejected = assert.rejects(api("/api/reviews"), e => e instanceof ApiError && e.code === "REQUEST_TIMEOUT");
  await flush();t.mock.timers.tick(API_REQUEST_TIMEOUT_MS);await rejected;
  const controller = new AbortController();
  const cancellation = new DOMException("Changed account", "AbortError");
  const cancelled = assert.rejects(api("/api/drafts", { signal: controller.signal }), e => e === cancellation);
  controller.abort(cancellation);await cancelled;
});

test("a timed-out save is not replayed; slower image recognition has its own deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  mockFetch(t, (async url => { calls.push(String(url)); return new Promise(() => {}); }) as typeof fetch);
  const api = createApiClient("test:expired");
  const saving = assert.rejects(api("/api/drafts", { method: "POST", body: "{}" }), e => e instanceof ApiError && e.code === "REQUEST_TIMEOUT");
  let finished = false;
  const parsing = assert.rejects(api("/api/questions/parse", { method: "POST", body: "{}" }), e => e instanceof ApiError && e.code === "REQUEST_TIMEOUT").then(() => { finished = true; });
  t.mock.timers.tick(60_000);await saving;await flush();
  assert.equal(finished, false);assert.deepEqual(calls, ["/api/drafts", "/api/questions/parse"]);
  t.mock.timers.tick(120_000);await parsing;
  assert.equal(calls.length, 2);
});

test("independent resources succeed while history hangs, then retry transient failures automatically", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const data: string[] = [], problems: unknown[] = [];
  const history = createResourceLoader(() => new Promise(() => {}), { receive() { assert.fail(); }, problem() { assert.fail(); } });
  const questions = createResourceLoader(async () => { if (++attempts === 1) throw new ApiError("offline", 503); return "777 questions"; }, {
    receive: value => data.push(value), problem: error => problems.push(error),
  });
  t.after(() => { history.dispose();questions.dispose(); });
  history.start();questions.start();await flush();
  assert.equal(problems.length, 1);
  t.mock.timers.tick(1500);await flush();
  assert.deepEqual(data, ["777 questions"]);assert.equal(problems.at(-1), null);
  questions.resume();await flush();assert.equal(attempts, 2);
});

test("manual retry replaces a hung resource and ignores its late answer; disposal cancels retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve!: (value: string) => void, signal!: AbortSignal, calls = 0;
  const data: string[] = [];
  const loader = createResourceLoader(async passed => {
    if (++calls === 1) { signal = passed; return new Promise<string>(answer => { resolve = answer; }); }
    return "new";
  }, { receive: value => data.push(value), problem: error => assert.equal(error, null) });
  loader.start();loader.reconnect();await flush();
  assert.equal(signal.aborted, true);resolve("old");await flush();
  assert.deepEqual(data, ["new"]);loader.dispose();
  loader.reconnect();t.mock.timers.tick(120_000);await flush();assert.equal(calls, 2);
});

test("late cloud lists keep newer saves, newly created drafts and completed reports", () => {
  const draft = (id: string, version: number) => ({ id, version, updatedAt: `2026-11-12T10:${String(version).padStart(2, "0")}:00Z`, input: { essay: `version ${version}` } } as Draft);
  const merged = mergeDraftHistory([draft("saved", 3), draft("new", 1)], [draft("saved", 2), draft("remote", 4)]);
  assert.deepEqual(merged.map(d => [d.id, d.version]), [["remote", 4], ["saved", 3], ["new", 1]]);
  const review = (id: string, status: Review["status"]) => ({ id, status, createdAt: "2026-11-12T10:00:00Z" } as Review);
  const reports = mergeReviewHistory([review("done", "completed"), review("pending", "processing"), review("new", "processing")], [review("done", "processing"), review("pending", "completed")]);
  assert.equal(reports.find(r => r.id === "done")?.status, "completed");
  assert.equal(reports.find(r => r.id === "pending")?.status, "completed");
  assert.ok(reports.some(r => r.id === "new"));
});
