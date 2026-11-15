import assert from "node:assert/strict";
import { test } from "node:test";
import { providerJSON } from "../src/lib/provider-json";
import { parseProviderCompletion, ProviderCompletionError } from "../src/lib/provider-completion";
import { HttpError } from "../src/lib/http";
import { assessEssay } from "../src/lib/reviewer";
import { questions } from "../src/lib/content";

const env = { DEEPSEEK_API_KEY: "test-only-not-a-real-key", DEEPSEEK_STREAM: "true" };
const messages = [{ role: "user", content: "Synthetic private essay marker that must not enter logs." }];
const complete = (value: unknown, finish = "stop") => Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }] });
const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const stream = (content: string, finish = "stop", done = true) => chunk({
  model: "deepseek-flash", choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  usage: { completion_tokens: 9000, completion_tokens_details: { reasoning_tokens: 0 } },
}) + (done ? "data: [DONE]\n\n" : "");
const request = (fetcher: typeof fetch, signal = AbortSignal.timeout(3000)) => providerJSON(messages, env, fetcher, false, 9000, signal);
const isError = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code;

test("a length-limited response is regenerated with more output room; its partial grade is never reused", async t => {
  t.mock.method(console, "warn", () => {});
  const sent: Record<string, unknown>[] = [];
  const result = await request(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); sent.push(body);
    return sent.length === 1 ? new Response(stream('{"score":9}', "length")) : complete({ score: 6 });
  });
  assert.deepEqual(result, { score: 6 });
  assert.deepEqual(sent.map(s => s.max_tokens), [9000, 18000]);
  assert.deepEqual(sent[0].messages, sent[1].messages);
  assert.deepEqual(sent[1].thinking, { type: "disabled" });
  assert.equal(sent[1].model, "deepseek-flash"); assert.equal(sent[1].stream, true);
});

test("an interrupted SSE response requires a fresh complete stream even if its content happened to be valid JSON", async t => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  const result = await request(async () => new Response(++calls === 1 ? stream('{"score":9}', "stop", false) : stream('{"score":6}')));
  assert.equal(calls, 2); assert.deepEqual(result, { score: 6 });
});

test("a length stop without the terminal event still increases output room but cannot supply a grade", async t => {
  t.mock.method(console, "warn", () => {});
  const budgets: number[] = [];
  const result = await request(async (_url, init) => {
    budgets.push(JSON.parse(String(init?.body)).max_tokens);
    return new Response(budgets.length === 1 ? stream('{"score":9}', "length", false) : stream('{"score":6}'));
  });
  assert.deepEqual(result, { score: 6 }); assert.deepEqual(budgets, [9000, 18000]);
});

test("malformed JSON and blank JSON-mode answers get one fresh attempt, with no concatenation of fragments", async t => {
  t.mock.method(console, "warn", () => {});
  for (const invalid of ['{"score":', '    ']) {
    let calls = 0;
    const result = await request(async () => ++calls === 1
      ? completeContent(invalid) : complete({ score: 6 }));
    assert.deepEqual(result, { score: 6 }); assert.equal(calls, 2);
  }
});

function completeContent(content: string) {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
}

test("a body read failure after HTTP 200 is retried as transport failure instead of being treated as malformed model JSON", async t => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  const broken = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } }));
  const result = await request(async () => ++calls === 1 ? broken() : complete({ score: 6 }));
  assert.deepEqual(result, { score: 6 }); assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(request(async () => { calls++; return broken(); }), isError("PROVIDER_TIMEOUT"));
  assert.equal(calls, 2);
});

test("persistent malformed output fails after two attempts and logs only response metadata", async t => {
  const logs: string[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => logs.push(args.join(" ")));
  let calls = 0;
  const privateOutput = "SYNTHETIC PRIVATE GENERATED CONTENT";
  await assert.rejects(request(async () => { calls++; return completeContent(privateOutput); }), isError("INVALID_FEEDBACK"));
  assert.equal(calls, 2); assert.equal(logs.length, 2);
  const logged = logs.join("\n");
  assert.ok(!logged.includes(privateOutput)); assert.ok(!logged.includes(messages[0].content));
  assert.ok(!logged.includes(env.DEEPSEEK_API_KEY)); assert.match(logged, /contentChars/);
});

test("a full JSON envelope with a length stop also increases budget, bounded at 48000 tokens", async t => {
  t.mock.method(console, "warn", () => {});
  const budgets: number[] = [];
  await providerJSON(messages, env, async (_url, init) => {
    budgets.push(JSON.parse(String(init?.body)).max_tokens);
    return complete({ score: 6 }, budgets.length === 1 ? "length" : "stop");
  }, true, 24000, AbortSignal.timeout(3000));
  assert.deepEqual(budgets, [24000, 48000]);
});

test("rate limits, provider authentication failures and refused completions do not cause an immediate extra request", async t => {
  t.mock.method(console, "warn", () => {});
  for (const [status, code] of [[429, "PROVIDER_BUSY"], [503, "PROVIDER_BUSY"], [401, "PROVIDER_ERROR"], [402, "PROVIDER_ERROR"]] as const) {
    let calls = 0;
    await assert.rejects(request(async () => { calls++; return new Response("", { status }); }), isError(code));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(request(async () => { calls++; return complete({}, "content_filter"); }), isError("INVALID_FEEDBACK"));
  assert.equal(calls, 1);
});

test("aborted deadlines and lost execution ownership stop retries before another provider request", async t => {
  t.mock.method(console, "warn", () => {});
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(request(async () => { calls++; return complete({}); }, controller.signal), isError("PROVIDER_TIMEOUT"));
  assert.equal(calls, 0);
  const deadline = new AbortController();
  await assert.rejects(request(async () => { calls++; deadline.abort(); return completeContent("{"); }, deadline.signal), isError("PROVIDER_TIMEOUT"));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(request(async () => { calls++; throw new HttpError(503, "Cancelled", "AI_JOB_CANCELLED"); }), isError("AI_JOB_CANCELLED"));
  assert.equal(calls, 1);
});

test("stream error metadata retains token usage without exposing answer fragments or reasoning", () => {
  const raw = chunk({ model: "deepseek-flash", choices: [{ index: 0, delta: { content: "PRIVATE_ANSWER", reasoning_content: "PRIVATE_REASONING" }, finish_reason: "length" }],
    usage: { completion_tokens: 9000, completion_tokens_details: { reasoning_tokens: 8000 } } }) + "data: [DONE]\n\n";
  assert.throws(() => parseProviderCompletion(raw), (error: unknown) => {
    assert.ok(error instanceof ProviderCompletionError);
    assert.equal(error.reason, "length"); assert.equal(error.metadata.completionTokens, 9000); assert.equal(error.metadata.reasoningTokens, 8000);
    assert.ok(!JSON.stringify(error).includes("PRIVATE_"));
    return true;
  });
});

test("a feedback retry retains the already verified independent scorecard and keeps the learning target out of both requests", async t => {
  t.mock.method(console, "warn", () => {});
  const essay = "Students can develop practical skills by working together on a research project.";
  const criteria = Object.fromEntries(["taskResponse", "coherence", "lexical", "grammar"].map(key => [key, { score: 7, reason: "依据原文表现对照量表进行独立判断。", evidence: essay }]));
  const feedback = { summary: "原作答表达清晰，本示例用于检验响应重试保留评分。", criteria: Object.fromEntries(Object.keys(criteria).map(key => [key, { ...criteria[key], score: 1 }])), strengths: [], priorities: [{title:"巩固表达",reason:"保留已经准确的表达。",action:"换一个话题练习同一结构。"}], methodChecks: [], paragraphs: [], corrections: [], advancedSuggestions: [], improvedEssay: essay, exercises: [] };
  const sent: { thinking: { type: string }; messages: { content: unknown }[] }[] = [];
  const q = questions().find(q => q.task === "Task 2" && q.examType === "A")!;
  let edits = 0;
  const result = await assessEssay({ questionId: q.id, essay, title: "", targetBand: 9 }, q, env, { fetch: async () => new Response("", { status: 404 }) }, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); sent.push(body);
    const data = JSON.parse((body.messages[1].content as { text: string }[])[0].text);
    assert.equal("targetBand" in data, false);
    if (body.thinking.type === "enabled") return complete({ criteria });
    return ++edits === 1 ? completeContent("{") : complete(feedback);
  });
  assert.deepEqual(sent.map(s => s.thinking.type), ["enabled", "disabled", "disabled"]);
  assert.deepEqual(sent[1].messages, sent[2].messages);
  assert.deepEqual(result.criteria, criteria);
});
