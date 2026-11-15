import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Studio from "../src/components/studio";
import { api, ApiError, AuthForm } from "../src/components/ui";
import type { Question } from "../src/lib/types";

test("initial HTML waits for session restoration without exposing saved account content", () => {
  const question: Question = {
    id: 11723, name: "Academic practice", task: "Task 2", examType: "A",
    category: "同意与否题", topic: "Education", book: "", test: "", date: "",
    stem: "Sample academic writing question.", sourceType: "test", sourceUrl: "",
    futureDate: false, images: [],
  };
  const html = renderToStaticMarkup(createElement(Studio, { initialQuestion: question, methods: [], total: 777 }));
  assert.match(html, /正在恢复登录…/);
  assert.doesNotMatch(html, /class="guest-notice"/);
  assert.match(html, /Sample academic writing question\./);
  assert.match(html, /真题题库/);
  assert.match(html, /写作方法/);
  assert.match(html, /<textarea[^>]*id="essay"[^>]*readOnly=""[^>]*disabled=""[^>]*><\/textarea>/);
  assert.match(html, /游客模式 · 只读/);
  assert.match(html, /登录后保存/);
  assert.match(html, /登录后批改/);
  assert.doesNotMatch(html, /退出账号|history-row|本机已保存/);
  const form = renderToStaticMarkup(createElement(AuthForm, { invitationRequired: false, onSuccess: () => {} }));
  assert.match(form, /type="email"/);
  assert.match(form, /type="password"/);
  assert.match(form, /邮箱登录/);
  assert.match(form, /注册账号/);
});

test("expired sessions request reauthentication while incorrect login credentials keep the login form available", async () => {
  const originalFetch = globalThis.fetch;
  const browserEvents = new EventTarget();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let expired = 0;
  browserEvents.addEventListener("judu:session-expired", () => expired++);
  Object.defineProperty(globalThis, "window", { value: browserEvents, configurable: true });
  globalThis.fetch = (async (url, options) => String(url) === "/api/auth" && !options?.method
    ? Response.json({ user: null })
    : Response.json({ error: "请登录", code: "LOGIN_REQUIRED" }, { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(api("/api/drafts"), (error: unknown) => error instanceof ApiError && error.status === 401);
    assert.equal(expired, 1);
    await assert.rejects(api("/api/auth", { method: "POST" }), (error: unknown) => error instanceof ApiError && error.status === 401);
    assert.equal(expired, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
