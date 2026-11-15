import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { sqliteDatabase } from "../server/database";
import { staticAssets } from "../server/assets";
import { writingServer } from "../server/http-server";
import { importSnapshot, type Snapshot } from "../server/import-snapshot";
import { hashPassword, verifyPassword } from "../worker/auth";
import { REGISTRATION_NOTICE_VERSION } from "../src/lib/registration-notice";

test("VPS HTTP adapter preserves login, Secure cookies, origin checks and private drafts", async () => {
  const { sql, db } = sqliteDatabase(":memory:");
  const server = writingServer({ DB: db, ASSETS: { fetch: async () => new Response("page") } }, "https://ssbyielt.xyz");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected test listener");
  const local = `http://127.0.0.1:${address.port}`;
  const auth = (origin: string, email: string) => fetch(local + "/api/auth", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ action: "register", acceptNotice: true, noticeVersion: REGISTRATION_NOTICE_VERSION, email, name: "Migration test", password: "Disposable-test-42" }) });
  try {
    for (const route of ["/api/drafts", "/api/reviews"]) {
      const anonymous = await fetch(local + route);
      assert.equal(anonymous.status, 401, route);
      assert.equal((await anonymous.json()).code, "LOGIN_REQUIRED");
    }
    for (const route of ["/api/config", "/api/questions", "/api/methods"])
      assert.equal((await fetch(local + route)).status, 200, route);
    for (const route of ["/api/drafts", "/api/reviews", "/api/questions/parse", "/api/teacher"])
      assert.equal((await fetch(local + route, { method: "POST", headers: { Origin: "https://ssbyielt.xyz", "Content-Type": "application/json" }, body: "{}" })).status, 401, route);
    assert.deepEqual(await (await fetch(local + "/api/health")).json(), { status: "ok" });
    const rejected = await auth("https://evil.example", "wrong@example.test");
    assert.equal(rejected.status, 403);
    const registered = await auth("https://ssbyielt.xyz", "first@example.test");
    assert.equal(registered.status, 200);
    const cookie = registered.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly; SameSite=Lax/);
    assert.match(cookie, /; Secure/);
    const user = (await registered.json()).user;
    const library = await fetch(local + "/api/questions", { headers: { Cookie: cookie.split(";")[0] } });
    assert.equal(library.status, 200);
    const { questions } = await library.json();
    assert.equal(questions.length, 777);
    assert.ok(questions.every((q: { examType: string }) => q.examType === "A"));
    assert.equal((await fetch(local + "/api/methods", { headers: { Cookie: cookie.split(";")[0] } })).status, 200);
    assert.equal((await fetch(local + "/api/config", { headers: { Cookie: cookie.split(";")[0] } })).status, 200);
    const saved = await fetch(local + "/api/drafts", { method: "POST", headers: { Origin: "https://ssbyielt.xyz", Cookie: cookie.split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify({ input: { questionId: 11723, essay: "", targetBand: 7, title: "Outline migration", outline: { analysis: "Answer all parts", position: "Agree", paragraphs: [], ending: "" } } }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).draft.wordCount, 0);
    assert.equal(sql.prepare("SELECT user_id FROM drafts").get()?.user_id, user.id);
    const second = await auth("https://ssbyielt.xyz", "second@example.test");
    const secondCookie = second.headers.get("set-cookie")!.split(";")[0];
    const secondDrafts = await fetch(local + "/api/drafts", { headers: { Cookie: secondCookie } });
    assert.deepEqual((await secondDrafts.json()).drafts, []);
    assert.equal((await fetch(local + "/api/drafts")).status, 401);
    const logout = await fetch(local + "/api/auth", { method: "POST", headers: { Origin: "https://ssbyielt.xyz", Cookie: cookie.split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(local + "/api/questions", { headers: { Cookie: cookie.split(";")[0] } })).status, 200);
    assert.equal((await fetch(local + "/api/drafts", { headers: { Cookie: cookie.split(";")[0] } })).status, 401);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); sql.close(); }
});

test("SQLite batches roll back together", async () => {
  const { sql, db } = sqliteDatabase(":memory:");
  try {
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO users(id,email,name,password,created_at) VALUES('one','same@example.test','test','hash','date')"),
      db.prepare("INSERT INTO users(id,email,name,password,created_at) VALUES('two','same@example.test','test','hash','date')"),
    ]));
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM users").get()?.n, 0);
  } finally { sql.close(); }
});

test("snapshot imports exact rows and password hashes, rejects corruption and populated targets", async () => {
  const password = await hashPassword("A-migration-test-password");
  const tables = { users: [{ id: "user", email: "user@example.test", name: "Test", password, created_at: "2026-10-28" }], drafts: [], reviews: [] };
  const snapshot: Snapshot = { version: 1, tables, counts: { users: 1, drafts: 0, reviews: 0 }, checksum: createHash("sha256").update(JSON.stringify(tables)).digest("hex"), provider: {} };
  const { sql } = sqliteDatabase(":memory:");
  try {
    assert.throws(() => importSnapshot(sql, { ...snapshot, checksum: "corrupt" }), /checksum/);
    assert.throws(() => importSnapshot(sql, { ...snapshot, counts: { ...snapshot.counts, users: 2 } }), /count/);
    assert.equal(importSnapshot(sql, snapshot).integrity, "ok");
    assert.ok(await verifyPassword("A-migration-test-password", String(sql.prepare("SELECT password FROM users").get()?.password)));
    assert.throws(() => importSnapshot(sql, snapshot), /populated/);
  } finally { sql.close(); }
});

test("static server serves exported assets and blocks private paths and writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ssby-assets-"));
  try {
    writeFileSync(join(directory, "index.html"), "test page");
    writeFileSync(join(directory, ".env"), "test-secret-never-served");
    const assets = staticAssets(directory);
    assert.equal(await (await assets.fetch(new Request("https://ssbyielt.xyz/"))).text(), "test page");
    assert.equal((await assets.fetch(new Request("https://ssbyielt.xyz/.env"))).status, 404);
    assert.equal((await assets.fetch(new Request("https://ssbyielt.xyz/%2e%2e%2f.env"))).status, 404);
    assert.equal((await assets.fetch(new Request("https://ssbyielt.xyz/", { method: "POST" }))).status, 405);
    assert.equal(await (await assets.fetch(new Request("https://ssbyielt.xyz/", { method: "HEAD" }))).text(), "");
  } finally {
    const withinTemp = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(withinTemp && !withinTemp.startsWith("..") && !isAbsolute(withinTemp) && withinTemp.startsWith("ssby-assets-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
