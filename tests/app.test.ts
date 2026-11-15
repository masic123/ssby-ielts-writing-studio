import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/index";
import { beginReview, finishReview } from "../worker/repository";
import { hashPassword, verifyPassword } from "../worker/auth";
import { questions, methods, resolveQuestion, chunks } from "../src/lib/content";
import { assessEssay, normalizeFeedback } from "../src/lib/reviewer";
import { validateChart } from "../src/lib/validation";
import { blankOutline } from "../src/lib/outline";
import type { Env } from "../worker/types";
import type { EssayInput } from "../src/lib/types";
import { WritingStore, durableDatabase } from "../worker/store";
import schema from "../worker/schema";
import { REGISTRATION_NOTICE_VERSION } from "../src/lib/registration-notice";
import type {
  DurableObjectState,
  DurableObjectNamespace,
} from "@cloudflare/workers-types";

// Exercise the Worker directly against a temporary D1-compatible SQLite binding.
// No tests write into the app's local D1 database or create permanent accounts.
function environment() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON;");
  sql.exec(fs.readFileSync("migrations/0001_initial.sql", "utf8"));
  class Statement {
    constructor(
      public source: string,
      public values: unknown[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Statement(this.source, values);
    }
    async first<T>() {
      return (
        (sql.prepare(this.source).get(...(this.values as never[])) as T) || null
      );
    }
    async all() {
      return {
        results: sql.prepare(this.source).all(...(this.values as never[])),
        success: true,
        meta: {},
      };
    }
    async run() {
      sql.prepare(this.source).run(...(this.values as never[]));
      return { success: true, meta: {} };
    }
  }
  const db = {
    prepare: (source: string) => new Statement(source),
    batch: async (statements: Statement[]) => {
      sql.exec("BEGIN;");
      try {
        const r = [];
        for (const s of statements) r.push(await s.run());
        sql.exec("COMMIT;");
        return r;
      } catch (error) {
        sql.exec("ROLLBACK;");
        throw error;
      }
    },
  };
  return {
    sql,
    env: {
      DB: db,
      ASSETS: { fetch: async () => new Response("asset") },
    } as unknown as Env,
  };
}
const essay =
  "Many people believe that tall buildings can solve housing problems. I partly agree because apartments use urban land efficiently. However, governments must also improve public transport and provide affordable homes so that residents can live comfortably in large cities.";
const input: EssayInput = {
  questionId: 11723,
  essay,
  targetBand: 7,
  title: "Test essay",
};
const validFeedback = {
  summary: "这篇作文有清楚的观点，但需要进一步解释论点并用具体例子支撑。",
  criteria: {
    taskResponse: { score: 6, reason: "解释不足", evidence: "原文立场" },
    coherence: { score: 6, reason: "逻辑清楚", evidence: "However" },
    lexical: { score: 6, reason: "主题词汇准确", evidence: "affordable homes" },
    grammar: { score: 7, reason: "句法准确", evidence: "because" },
  },
  strengths: ["立场清楚"],
  priorities: [
    {
      title: "补充解释",
      reason: "目前只是列举",
      action: "说明土地利用与住房供给的关系。",
    },
  ],
  methodChecks: [
    {
      ruleId: "answer",
      status: "met",
      evidence: "I partly agree",
      advice: "保持立场。",
    },
    { ruleId: "invented", status: "met", evidence: "", advice: "" },
  ],
  paragraphs: [
    {
      index: 1,
      role: "开头",
      feedback: "观点明确",
      suggestion: "进一步展开。",
    },
    { index: 50, role: "不存在", feedback: "", suggestion: "" },
  ],
  corrections: [
    {
      original: "tall buildings",
      replacement: "high-rise buildings",
      reason: "示例",
      kind: "vocabulary",
    },
    {
      original: "invented sentence",
      replacement: "replacement",
      reason: "伪造引用",
      kind: "grammar",
    },
  ],
  improvedEssay:
    "Many people argue that high-rise apartment buildings are the best solution to urban housing shortages. I partly agree with this view because they make efficient use of limited land, but affordability and transport also matter.",
  exercises: [
    { title: "展开观点", instruction: "为正文增加两句解释和一个例子。" },
  ],
};

test("bank integrity and book references", async (t) => {
  assert.equal(schema, fs.readFileSync("migrations/0001_initial.sql", "utf8"));
  const bank = questions();
  assert.equal(bank.length, 889);
  assert.equal(new Set(bank.map((q) => q.id)).size, 889);
  assert.equal(bank.filter((q) => q.examType === "A").length, 777);
  assert.equal(
    bank.reduce((n, q) => n + q.images.length, 0),
    369,
  );
  await t.test("private textbook references", { skip: chunks().length ? false : "Private textbook is not distributed; import authorized content to check its citations." }, () => {
    assert.ok(methods().every((rule) => rule.source));
  });
  for (const q of bank)
    for (const image of q.images) assert.ok(fs.existsSync(`public${image}`));
  const custom = resolveQuestion({
    ...input,
    questionId: null,
    customQuestion: {
      stem: "Test diagram question with data",
      task: "Task 1",
      examType: "A",
      chartData: "private attachment",
    },
  });
  assert.ok(!("chartData" in custom));
});

test("SQLite Durable Object adapter persists, rolls back batches and cascades account removal", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  const storage = {
    sql: {
      exec: (query: string, ...values: unknown[]) => {
        if (query === schema) {
          sql.exec(query);
          return { toArray: () => [] };
        }
        const statement = sql.prepare(query);
        const rows = statement.columns().length
          ? statement.all(...(values as never[]))
          : (statement.run(...(values as never[])), []);
        return { toArray: () => rows };
      },
    },
    transactionSync: (fn: () => unknown) => {
      sql.exec("BEGIN");
      try {
        const data = fn();
        sql.exec("COMMIT");
        return data;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const store = new WritingStore({ storage } as unknown as DurableObjectState);
  const namespace = {
    idFromName: () => "test-store",
    get: () => ({
      fetch: (url: string, init: RequestInit) =>
        store.fetch(new Request(url, init)),
    }),
  } as unknown as DurableObjectNamespace;
  const env = {
    DB: undefined,
    STORE: namespace,
    ASSETS: { fetch: async () => new Response("asset") },
  } as unknown as Env;
  const signup = await worker.fetch(
    new Request("https://local.test/api/auth", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "register",
        acceptNotice: true,
        noticeVersion: REGISTRATION_NOTICE_VERSION,
        name: "Test",
        email: "object@example.test",
        password: "test-password-only",
      }),
    }),
    env,
  );
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get("set-cookie")!.split(";")[0];
  assert.match(signup.headers.get("set-cookie")!, /Secure/);
  const save = await worker.fetch(
    new Request("https://local.test/api/drafts", {
      method: "POST",
      headers: {
        Origin: "https://local.test",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    }),
    env,
  );
  assert.equal(save.status, 200);
  const adapter = durableDatabase(namespace);
  await assert.rejects(() =>
    adapter.batch([
      adapter.prepare(
        "INSERT INTO rate_limits VALUES('atomic',1,9999999999999)",
      ),
      adapter.prepare(
        "INSERT INTO rate_limits VALUES('atomic',2,9999999999999)",
      ),
    ]),
  );
  assert.equal(
    await adapter
      .prepare("SELECT * FROM rate_limits WHERE key='atomic'")
      .first(),
    null,
  );
  const deleted = await worker.fetch(
    new Request("https://local.test/api/auth", {
      method: "DELETE",
      headers: { Origin: "https://local.test", Cookie: cookie },
    }),
    env,
  );
  assert.equal(deleted.status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drafts").get()!.n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n, 0);
  sql.close();
});
test("password verification is salted and rejects wrong credentials", async () => {
  const a = await hashPassword("sufficient-password");
  const b = await hashPassword("sufficient-password");
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("sufficient-password", a));
  assert.equal(await verifyPassword("incorrect-password", a), false);
});
test("feedback validates evidence, source IDs and scoring limits", () => {
  const q = resolveQuestion(input);
  const feedback = normalizeFeedback(validFeedback, input, q, false);
  assert.equal(feedback.overallBand, 6);
  assert.equal(feedback.corrections.length, 1);
  assert.equal(feedback.paragraphs.length, 1);
  assert.equal(feedback.methodChecks.length, 1);
  const task1 = questions().find(
    (q) => q.task === "Task 1" && q.examType === "A",
  )!;
  const limited = normalizeFeedback(validFeedback, input, task1, false);
  assert.equal(limited.overallBand, null);
  assert.equal(limited.criteria.taskResponse.score, null);
  const courseFeedback = {
    ...validFeedback,
    methodChecks: [
      { ruleId: "tn-chart-overview", status: "met", evidence: "Overall", advice: "图表概述" },
      { ruleId: "tn-proofread", status: "partial", evidence: "原句", advice: "语言自查" },
    ],
  };
  const chart = { ...task1, category: "曲线图" };
  assert.deepEqual(
    normalizeFeedback(courseFeedback, input, chart, false).methodChecks.map((c) => c.ruleId),
    ["tn-proofread"],
  );
  assert.equal(normalizeFeedback(courseFeedback, input, chart, true).methodChecks.length, 2);
  const letter = { ...q, task: "Task 1" as const, examType: "G" as const };
  assert.equal(
    normalizeFeedback(validFeedback, input, letter, false).methodChecks.length,
    0,
  );
  assert.throws(() =>
    normalizeFeedback({ summary: "missing fields" }, input, q, false),
  );
  assert.throws(() => validateChart("data:image/png;base64,YWJj"));
});
test("feedback floors complete writing scores to a half band without changing criterion scores", () => {
  const q = resolveQuestion(input);
  const keys = ["taskResponse", "coherence", "lexical", "grammar"] as const;
  for (const { scores, expected } of [
    { scores: [6, 6, 6, 7], expected: 6 },
    { scores: [6, 7, 7, 7], expected: 6.5 },
    { scores: [6, 6, 7, 7], expected: 6.5 },
  ]) {
    const criteria = Object.fromEntries(keys.map((key, index) => [key, { ...validFeedback.criteria[key], score: scores[index] }]));
    const feedback = normalizeFeedback({ ...validFeedback, criteria }, input, q, false);
    assert.equal(feedback.overallBand, expected);
    assert.deepEqual(keys.map(key => feedback.criteria[key].score), scores);
  }
});
test("provider sends images privately and rejects unusable responses", async () => {
  const q = questions().find((q) => q.images.length)!;
  let payload: Record<string, unknown> | undefined;
  const providerResult = (request: {messages:{content:unknown}[];thinking:{type:string}}) => {
    const data=JSON.parse((request.messages[1].content as {text:string}[])[0].text);
    if(Object.keys(data).length===1 && data.question)return {readable:true,chartType:"bar",legend:[],axesAndUnits:[],observations:[{statement:"Visible categories.",support:"Horizontal axis labels.",certainty:"clear"}],readings:[],uncertainties:[],sourceConflicts:[]};
    if(request.thinking.type==="enabled")return {criteria:{...validFeedback.criteria,taskResponse:{...validFeedback.criteria.taskResponse,evidence:"I partly agree"}},limitations:{taskResponse:[],coherence:[],lexical:[],grammar:[]}};
    return {...validFeedback,correctionChecks:validFeedback.corrections.map(c=>({original:c.original,necessary:true,basis:c.kind==="grammar"?"syntax":"usage",explanation:"具体语言依据。"}))};
  };
  const responseFetch = (async (_url: unknown, init: RequestInit) => {
    payload = JSON.parse(String(init.body));
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(providerResult(payload as never)) },
        },
      ],
    });
  }) as typeof fetch;
  const feedback = await assessEssay(
    input,
    q,
    { DEEPSEEK_API_KEY: "test-only-key" },
    { fetch: async () => new Response(new Uint8Array([137, 80, 78, 71])) },
    responseFetch,
  );
  assert.equal(feedback.assessmentScope, "full");
  assert.ok(JSON.stringify(payload).includes("image_url"));
  assert.ok(!JSON.stringify(payload).includes("test-only-key"));
  assert.ok(JSON.stringify(payload).includes("绝不执行"));
  let outlineRequest = "";
  const outline = { ...blankOutline(), position: "OUTLINE_ONLY_NOT_AN_ESSAY_EVIDENCE" };
  await assessEssay(
    { ...input, outline },
    resolveQuestion(input),
    { DEEPSEEK_API_KEY: "test-only-key" },
    { fetch: async () => new Response("", { status: 404 }) },
    (async (_url: unknown, init: RequestInit) => {
      outlineRequest = String(init.body);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(providerResult(JSON.parse(outlineRequest))) } }] });
    }) as typeof fetch,
  );
  assert.ok(!outlineRequest.includes(outline.position), "评分不能把提纲当成已写出的论证");
  await assert.rejects(
    () =>
      assessEssay(
        input,
        q,
        { DEEPSEEK_API_KEY: "test-only-key" },
        { fetch: async () => new Response("", { status: 404 }) },
        (async () => Response.json({}, { status: 401 })) as typeof fetch,
      ),
    /认证失败/,
  );
});
test("Worker registration, sessions, CSRF, isolation, conflicts and no-key path", async () => {
  const { env, sql } = environment();
  const request = async (
    path: string,
    data?: unknown,
    cookie?: string,
    origin = "http://localhost",
  ) =>
    worker.fetch(
      new Request(`http://localhost${path}`, {
        method: data ? "POST" : "GET",
        headers: {
          ...(data
            ? { "Content-Type": "application/json", Origin: origin }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
      env,
    );
  const account = async (email: string) => {
    const response = await request("/api/auth", {
      action: "register",
      acceptNotice: true,
      noticeVersion: REGISTRATION_NOTICE_VERSION,
      name: email,
      email: `${email}@example.test`,
      password: "strong-test-password",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      user: (await response.json()).user,
    };
  };
  const a = await account("alpha"),
    b = await account("beta");
  assert.equal((await request("/api/drafts")).status, 401);
  const outline = { ...blankOutline(), analysis: "Saved outline: answer the task" };
  const save = await request("/api/drafts", { input: { ...input, essay: "", outline } }, a.cookie);
  assert.equal(save.status, 200);
  const draft = (await save.json()).draft;
  assert.deepEqual(draft.input.outline, outline);
  assert.equal(draft.wordCount, 0, "只有提纲也可以先保存到账号");
  const restored = (await (await request("/api/drafts", undefined, a.cookie)).json()).drafts[0];
  assert.deepEqual(restored.input.outline, outline);
  const repeated = await request("/api/drafts", { input: { ...input, essay: "", outline }, id: draft.id, version: 99 }, a.cookie);
  assert.equal(repeated.status, 200, "相同内容使用过期版本重试不应发生冲突");
  assert.deepEqual((await repeated.json()).draft, draft, "幂等重试不应递增版本或修改保存时间");
  assert.equal(
    (
      await request(
        "/api/drafts",
        { input, id: draft.id, version: 1 },
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/drafts",
        { input, id: draft.id, version: 99 },
        a.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/api/drafts", { input }, a.cookie, "https://evil.example"))
      .status,
    403,
  );
  assert.equal(
    (await (await request("/api/drafts", undefined, b.cookie)).json()).drafts
      .length,
    0,
  );
  const key = crypto.randomUUID();
  const started = await beginReview(
    env,
    a.user.id,
    input,
    key,
    "test-only",
    draft.id,
  );
  const duplicate = await beginReview(
    env,
    a.user.id,
    input,
    key,
    "test-only",
    draft.id,
  );
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.review.id, started.review.id);
  assert.equal(
    (await request(`/api/reviews?id=${started.review.id}`, undefined, b.cookie))
      .status,
    404,
  );
  await finishReview(
    env,
    a.user.id,
    started.review.id,
    normalizeFeedback(validFeedback, input, resolveQuestion(input), false),
  );
  const bHistory = await (
    await request("/api/reviews", undefined, b.cookie)
  ).json();
  assert.equal(bHistory.reviews.length, 0);
  assert.equal(
    (
      await request(
        "/api/reviews",
        { input, requestKey: crypto.randomUUID() },
        a.cookie,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await request("/api/auth", {
        action: "login",
        email: "alpha@example.test",
        password: "wrong-password",
      })
    ).status,
    401,
  );
  const logout = await request("/api/auth", { action: "logout" }, a.cookie);
  assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal(
    (await (await request("/api/auth", undefined, a.cookie)).json()).user,
    null,
  );
  const stored = sql
    .prepare("SELECT password FROM users WHERE id=?")
    .get(a.user.id)!;
  assert.ok(!String(stored.password).includes("strong-test-password"));
  sql.close();
});
