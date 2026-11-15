import { test } from "node:test";
import assert from "node:assert/strict";
import retired from "../worker/retired";
import { sqliteDatabase } from "../server/database";

test("retired Cloudflare address preserves old draft access and prevents database divergence or export", async () => {
  const { sql, db } = sqliteDatabase(":memory:");
  const origin = "https://old-writing.example";
  const env = { DB: db, ASSETS: { fetch: async (r: Request) => new Response(new URL(r.url).pathname) } };
  const request = (path: string, data?: unknown) => retired.fetch(new Request(origin + path, {
    method: data ? "POST" : "GET", headers: { Origin: origin, "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}),
  }), env);
  try {
    assert.match(await (await request("/")).text(), /https:\/\/ssbyielt.xyz/);
    assert.equal(await (await request("/legacy")).text(), "/");
    for (const path of ["/api/drafts", "/api/reviews", "/api/questions/parse"])
      assert.equal((await request(path, {})).status, 503);
    assert.equal((await request("/api/auth", { action: "register" })).status, 503);
    assert.equal((await request("/api/auth", { action: "login", email: "old@example.test", password: "Not-a-real-account" })).status, 401);
    assert.equal((await request("/api/_vps-transfer")).status, 404);
    assert.equal((await request("/transfer-example.bin")).status, 404);
    assert.equal(sql.prepare("SELECT count(*) n FROM users").get()?.n, 0);
  } finally { sql.close(); }
});
