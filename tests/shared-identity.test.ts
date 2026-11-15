import { test } from "node:test";
import assert from "node:assert/strict";
import { sqliteDatabase } from "../server/database";
import { migrateSharedIdentity } from "../server/shared-identity";
import { hashPassword, verifyPassword } from "../worker/auth";
import ieltsWorker from "../worker/index";
import { REGISTRATION_NOTICE_VERSION } from "../src/lib/registration-notice";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const assets = { fetch: async () => new Response("page") };
const origin = "https://ssbyielt.xyz";
const cetOrigin = "https://yiyangcet.xyz";
const request = (host: string, data?: object, cookie?: string) => new Request(host + "/api/auth", {
  method: data ? "POST" : "GET", headers: { Origin: host, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  ...(data ? { body: JSON.stringify(data) } : {}),
});

test("one account registers once, logs into both sites and keeps practice data separate", async (t) => {
  const cetRoot = process.env.CET_STUDIO_PATH || fileURLToPath(new URL("../../yiyang-cet-writing-studio/", import.meta.url));
  if (!existsSync(resolve(cetRoot, "worker/index.ts"))) {
    t.skip("Clone yiyang-cet-writing-studio alongside this repository, or set CET_STUDIO_PATH, for the two-site integration test.");
    return;
  }
  const { default: cetWorker } = await import(pathToFileURL(resolve(cetRoot, "worker/index.ts")).href);
  const { REGISTRATION_NOTICE_VERSION: CET_NOTICE_VERSION } = await import(pathToFileURL(resolve(cetRoot, "src/lib/registration-notice.ts")).href);
  const identity = sqliteDatabase(":memory:"), ielts = sqliteDatabase(":memory:"), cet = sqliteDatabase(":memory:");
  const a = { DB: ielts.db, AUTH_DB: identity.db, ASSETS: assets }, b = { DB: cet.db, AUTH_DB: identity.db, ASSETS: assets };
  try {
    const credentials = { email: "shared@example.test", password: "Disposable-shared-42" };
    const registered = await ieltsWorker.fetch(request(origin, { ...credentials, name: "Shared learner", action: "register", acceptNotice: true, noticeVersion: REGISTRATION_NOTICE_VERSION }), a);
    assert.equal(registered.status, 200);
    const expected = (await registered.json()).user;
    const firstCookie = registered.headers.get("set-cookie")!.split(";")[0];
    const login = await cetWorker.fetch(request(cetOrigin, { ...credentials, action: "login" }), b);
    assert.equal(login.status, 200);
    assert.deepEqual((await login.json()).user, expected);
    const secondCookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(firstCookie, /^judu_session=/); assert.match(secondCookie, /^cet_session=/);
    assert.match(login.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax.*Secure/);
    for (const [worker, env, host, cookie] of [[ieltsWorker, a, origin, firstCookie], [cetWorker, b, cetOrigin, secondCookie]] as const) {
      const profile = await worker.fetch(request(host, undefined, cookie), env);
      assert.deepEqual((await profile.json()).user, expected);
      const local = env.DB === a.DB ? ielts.sql : cet.sql;
      assert.equal(local.prepare("SELECT password FROM users WHERE id=?").get(expected.id)?.password, "!shared-identity");
    }
    ielts.sql.prepare("INSERT INTO drafts(id,user_id,input,version,updated_at,word_count) VALUES('ielts-private',?,'{}',1,'now',0)").run(expected.id);
    assert.equal((await cetWorker.fetch(new Request(cetOrigin + "/api/drafts", { headers: { Cookie: secondCookie } }), b)).status, 200);
    assert.equal(cet.sql.prepare("SELECT COUNT(*) n FROM drafts").get()?.n, 0);
    const duplicate = await cetWorker.fetch(request(cetOrigin, { ...credentials, action: "register", name: "Duplicate", acceptNotice: true, noticeVersion: CET_NOTICE_VERSION }), b);
    assert.equal(duplicate.status, 409);
    const wrong = await cetWorker.fetch(request(cetOrigin, { ...credentials, action: "login", password: "Wrong-password-42" }), b);
    assert.equal(wrong.status, 401);
    const logout = await ieltsWorker.fetch(request(origin, { action: "logout" }, firstCookie), a);
    assert.equal(logout.status, 200);
    assert.equal((await (await ieltsWorker.fetch(request(origin, undefined, firstCookie), a)).json()).user, null);
    assert.deepEqual((await (await cetWorker.fetch(request(cetOrigin, undefined, secondCookie), b)).json()).user, expected);
    const reverse = await cetWorker.fetch(request(cetOrigin, { action: "register", email: "second@example.test", password: credentials.password, name: "Second learner", acceptNotice: true, noticeVersion: CET_NOTICE_VERSION }), b);
    assert.equal(reverse.status, 200);
    assert.equal((await ieltsWorker.fetch(request(origin, { action: "login", email: "second@example.test", password: credentials.password }), a)).status, 200);
    assert.equal(identity.sql.prepare("SELECT COUNT(*) n FROM users").get()?.n, 2);
  } finally { identity.sql.close(); ielts.sql.close(); cet.sql.close(); }
});

test("existing identities preserve password hashes, sessions and both sites' draft ownership", async () => {
  const identity = sqliteDatabase(":memory:"), a = sqliteDatabase(":memory:"), b = sqliteDatabase(":memory:");
  try {
    const password = await hashPassword("Original-password-42");
    a.sql.prepare("INSERT INTO users VALUES('primary','learner@example.test','Learner',?,'before')").run(password);
    b.sql.prepare("INSERT INTO users VALUES('secondary','learner@example.test','Learner',?,'before')").run(password);
    a.sql.exec("INSERT INTO sessions VALUES('old-ielts-session','primary',9999999999999); INSERT INTO drafts VALUES('ielts','primary','original IELTS text',1,'date',3)");
    b.sql.exec("INSERT INTO sessions VALUES('old-cet-session','secondary',9999999999999); INSERT INTO drafts VALUES('cet','secondary','original CET text',1,'date',3)");
    const result = migrateSharedIdentity(identity.sql, [a.sql, b.sql]);
    assert.equal(result.importedAccounts, 1); assert.equal(result.remappedAccounts, 1);
    assert.equal(identity.sql.prepare("SELECT password FROM users").get()?.password, password);
    assert.equal(await verifyPassword("Original-password-42", String(identity.sql.prepare("SELECT password FROM users").get()?.password)), true);
    assert.deepEqual(identity.sql.prepare("SELECT DISTINCT user_id FROM sessions").all().map(r => r.user_id), ["primary"]);
    assert.equal(b.sql.prepare("SELECT user_id FROM drafts").get()?.user_id, "primary");
    assert.equal(b.sql.prepare("SELECT input FROM drafts").get()?.input, "original CET text");
    assert.equal(a.sql.prepare("SELECT input FROM drafts").get()?.input, "original IELTS text");
    assert.equal(migrateSharedIdentity(identity.sql, [a.sql, b.sql]).importedAccounts, 0);
  } finally { identity.sql.close(); a.sql.close(); b.sql.close(); }
});
