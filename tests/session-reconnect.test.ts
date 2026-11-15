import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createApiClient } from "../src/lib/api-client";
import { createSessionRestorer, SESSION_REQUEST_TIMEOUT_MS, type AuthSession } from "../src/lib/session-restorer";

const learner = { id: "synthetic-a", name: "Synthetic learner", email: "synthetic-a@example.test" };
const signedIn: AuthSession = { user: learner, invitationRequired: false };
const guest: AuthSession = { user: null, invitationRequired: false };
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
function fixture(api: (url: string, options?: RequestInit) => Promise<unknown>) {
  const sessions: AuthSession[] = [], failures: string[] = [];
  let expired = 0;
  const restorer = createSessionRestorer(api as Parameters<typeof createSessionRestorer>[0], {
    onSession: session => sessions.push(session), onFailure: message => failures.push(message), onExpired: () => expired++,
  });
  return { restorer, sessions, failures, expired: () => expired };
}

test("manual reconnect immediately replaces a hung request and rejects its late guest result", async t => {
  let old!: (value: AuthSession) => void, oldSignal!: AbortSignal, calls = 0;
  const f = fixture(async (url, options) => {
    assert.equal(url, "/api/auth");
    if (++calls === 1) { oldSignal = options!.signal!; return new Promise<AuthSession>(resolve => { old = resolve; }); }
    return signedIn;
  });t.after(() => f.restorer.dispose());
  const first = f.restorer.refresh();
  f.restorer.reconnect();await flush();
  assert.equal(calls, 2);assert.equal(oldSignal.aborted, true);
  assert.deepEqual(f.sessions, [signedIn]);
  old(guest);await first;await flush();
  assert.deepEqual(f.sessions, [signedIn]);assert.equal(f.expired(), 0);assert.deepEqual(f.failures, []);
});

test("a browser ignoring abort cannot keep restoration pending forever; timeout retries successfully", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const f = fixture(async () => ++calls === 1 ? new Promise(() => {}) : signedIn);
  t.after(() => f.restorer.dispose());
  const first = f.restorer.refresh();
  t.mock.timers.tick(SESSION_REQUEST_TIMEOUT_MS);await first;
  assert.equal(f.failures.length, 1);assert.match(f.failures[0], /超时/);
  t.mock.timers.tick(1500);await flush();
  assert.equal(calls, 2);assert.deepEqual(f.sessions, [signedIn]);assert.equal(f.expired(), 0);
});

test("transient failures preserve the account and automatic recovery clears the connection failure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const f = fixture(async () => { if (++calls === 2) throw new TypeError("Synthetic offline transport"); return signedIn; });
  t.after(() => f.restorer.dispose());
  await f.restorer.refresh();await f.restorer.refresh();
  assert.deepEqual(f.sessions, [signedIn]);assert.equal(f.expired(), 0);assert.match(f.failures[0], /网络连接中断/);
  t.mock.timers.tick(1500);await flush();
  assert.deepEqual(f.sessions, [signedIn, signedIn]);assert.equal(calls, 3);
});

test("HTTP failures and incomplete JSON have distinct messages and never prove logout", async t => {
  let error: unknown = new ApiError("Synthetic upstream failure", 502);
  const f = fixture(async () => { throw error; });t.after(() => f.restorer.dispose());
  f.restorer.setUser(learner);
  await f.restorer.refresh();assert.match(f.failures[0], /HTTP 502/);
  error = new ApiError("Synthetic truncated JSON", 200, "INVALID_RESPONSE");
  f.restorer.reconnect();await flush();assert.match(f.failures[1], /未完整收到/);
  assert.deepEqual(f.sessions, []);assert.equal(f.expired(), 0);
});

test("login and logout invalidate pending restoration and its automatic retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let old!: (value: AuthSession) => void, calls = 0;
  const f = fixture(async () => { calls++; return new Promise<AuthSession>(resolve => { old = resolve; }); });
  t.after(() => f.restorer.dispose());
  const pending = f.restorer.refresh();
  f.restorer.setUser(learner);old(guest);await pending;
  assert.deepEqual(f.sessions, []);assert.equal(f.expired(), 0);
  f.restorer.setUser(null);t.mock.timers.tick(120_000);await flush();
  assert.equal(calls, 1);assert.deepEqual(f.failures, []);
});

test("only a complete guest response expires a known account; malformed data preserves it", async t => {
  let response: unknown = { user: null };
  const f = fixture(async () => response);t.after(() => f.restorer.dispose());
  f.restorer.setUser(learner);
  await f.restorer.refresh();assert.equal(f.expired(), 0);assert.deepEqual(f.sessions, []);assert.match(f.failures[0], /未完整收到/);
  response = guest;await f.restorer.refresh();assert.equal(f.expired(), 1);assert.deepEqual(f.sessions, [guest]);
  await f.restorer.refresh();assert.equal(f.expired(), 1);
});

test("unmount aborts pending work and does not schedule callbacks or retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const f = fixture(async () => { calls++; return new Promise(() => {}); });
  const pending = f.restorer.refresh();f.restorer.dispose();await pending;
  t.mock.timers.tick(120_000);await flush();
  assert.equal(calls, 1);assert.deepEqual(f.sessions, []);assert.deepEqual(f.failures, []);
});

test("a stuck 401 verification has a deadline and allows the next request to verify again", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();let expired = 0, checks = 0;
  events.addEventListener("synthetic:expired", () => expired++);
  Object.defineProperty(globalThis, "window", { value: events, configurable: true });
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);else Reflect.deleteProperty(globalThis, "window");
  });
  globalThis.fetch = (async url => String(url) === "/api/auth"
    ? (++checks === 1 ? new Promise(() => {}) : Response.json(guest))
    : Response.json({ code: "LOGIN_REQUIRED", error: "Synthetic expired request" }, { status: 401 })) as typeof fetch;
  const client = createApiClient("synthetic:expired");
  const first = client("/api/drafts");
  const rejected = assert.rejects(first, error => error instanceof ApiError && error.status === 401);
  await flush();assert.equal(checks, 1);
  t.mock.timers.tick(SESSION_REQUEST_TIMEOUT_MS);await rejected;
  assert.equal(expired, 0);
  await assert.rejects(client("/api/drafts"));assert.equal(checks, 2);assert.equal(expired, 1);
});

test("a truncated auth response is identified separately from an HTTP service failure", async t => {
  const originalFetch = globalThis.fetch;t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async () => new Response('{"user":', { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(createApiClient("synthetic:expired")("/api/auth"), error => error instanceof ApiError && error.code === "INVALID_RESPONSE" && error.status === 200);
});
