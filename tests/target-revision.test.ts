import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { attachTargetRevision, targetRevisionMessages, revisionFidelityMessages, type RevisionCompletion } from "../src/lib/target-revision";
import { revisionAssessmentText } from "../src/lib/revision-assessment";
import RevisionAssessmentPanel from "../src/components/revision-assessment";
import { assessEssayWithCoaching } from "../src/lib/reviewer";
import { scoreKeys, type ScoringCard } from "../src/lib/scoring-card";
import type { EssayInput, Feedback, Question } from "../src/lib/types";

const q: Question = { id: 1, name: "Synthetic test", task: "Task 2", examType: "A", category: "opinion", topic: "education", book: "", test: "", date: "", stem: "Some people think university education should be free for everyone. To what extent do you agree or disagree?", sourceType: "synthetic", sourceUrl: "", futureDate: false, images: [] };
const original = "I agree university should be free. Poor students have no money. They can study if government pay. But the government need money for hospitals too.";
const input: EssayInput = { questionId: 1, essay: original, targetBand: 7, title: "Synthetic title" };
// These are deterministic transport fixtures, not claims about the quality of prose.
const candidate = (label = "First") => `${label} candidate. ` + Array.from({ length: 26 }, () => "Free university education can help students develop useful skills for employment.").join(" ");
const card = (essay: string, scores: number[] = [7, 7, 7, 7]): ScoringCard => Object.fromEntries(scoreKeys.map((key, i) => [key, { score: scores[i], reason: "依据本项量表独立判断。", evidence: essay.slice(0, essay.indexOf(".") + 1) }])) as ScoringCard;
const feedback = (band = 4): Feedback => ({ summary: "观点明确但展开不足。", overallBand: band, assessmentScope: "full", criteria: card(original, [band, band, band, band]), strengths: ["有立场"], priorities: [{ title: "解释观点", reason: "支持有限", action: "补充分步解释。" }], methodChecks: [], paragraphs: [{ index: 1, role: "主体", feedback: "展开不足", suggestion: "解释原因" }], corrections: [], improvedEssay: "The baseline revision must survive failed verification.", advancedSuggestions: [], exercises: [] });
const data = (messages: unknown[]) => {
  const content = (messages[1] as { content: string | { type: string; text?: string }[] }).content;
  return JSON.parse(typeof content === "string" ? content : content.find(p => p.type === "text")!.text!);
};
const deadline = () => Date.now() + 60000;
const validCheck = { valid: true, issues: [] };

test("only the writer sees the target; candidate assessors receive independent target-free contexts", async () => {
  const saved = feedback(), before = structuredClone(saved), sent: { kind: string; messages: unknown[]; thinking: boolean }[] = [];
  let writers = 0;
  const complete: RevisionCompletion = async (messages, thinking) => {
    const d = data(messages), kind = d.targetBand ? "writer" : d.candidate ? "fidelity" : "score";
    sent.push({ kind, messages, thinking });
    if (kind === "writer") return { improvedEssay: candidate(++writers === 1 ? "First" : "Second") };
    if (kind === "fidelity") return validCheck;
    return { criteria: card(d.essay, writers === 1 ? [6, 6, 7, 7] : [7, 7, 7, 7]) };
  };
  const result = await attachTargetRevision(input, q, saved, [], complete, deadline());
  assert.equal(result.revisionAssessment?.status, "met");
  assert.equal(result.revisionAssessment?.attempts, 2);
  assert.equal(result.revisionAssessment?.overallBand, 7);
  assert.match(result.improvedEssay, /^Second/);
  assert.deepEqual(saved, before);
  const { improvedEssay: _new, revisionAssessment: _assessment, ...objective } = result;
  const { improvedEssay: _old, ...oldObjective } = before;
  assert.deepEqual(objective, oldObjective, "objective scores, reasons and corrections survive unchanged");
  for (const call of sent.filter(c => c.kind !== "writer")) {
    const d = data(call.messages);
    for (const key of ["targetBand", "minimumBand", "originalAssessment", "previousCandidate", "baseRevision"]) assert.equal(key in d, false);
    assert.equal(JSON.stringify(d).includes(input.title), false);
    if (call.kind === "score") {
      assert.equal("originalEssay" in d, false);
      assert.equal(call.thinking, true);
    }
  }
  const second = data(sent.filter(c => c.kind === "writer")[1].messages);
  assert.equal(second.targetBand, 7);
  assert.equal(second.previousCandidate.criteria.grammar.score, 7);
  assert.ok(second.previousCandidate.issues.length);
});

test("four-criterion average retains the existing downward half-band rule and exhausted attempts stay below target", async () => {
  const result = await attachTargetRevision(input, q, feedback(), [], async messages => {
    const d = data(messages);
    return d.targetBand ? { improvedEssay: candidate() } : d.candidate ? validCheck : { criteria: card(d.essay, [7, 7, 6, 7]) };
  }, deadline());
  assert.equal(result.revisionAssessment?.overallBand, 6.5);
  assert.equal(result.revisionAssessment?.status, "below_target");
  assert.equal(result.revisionAssessment?.attempts, 3);
});

test("fractional criterion scores cannot certify a candidate or displace a verified rewrite", async () => {
  for (const earlierVerified of [false, true]) {
    const initial = feedback();
    let writers = 0;
    const result = await attachTargetRevision(input, q, initial, [], async messages => {
      const d = data(messages);
      if (d.targetBand) return { improvedEssay: candidate(++writers === 1 ? "First" : "Later") };
      if (d.candidate) return validCheck;
      return { criteria: card(d.essay, earlierVerified && writers === 1 ? [6, 6, 6, 6] : [8, 8, 7.5, 8]) };
    }, deadline());
    assert.deepEqual(result.criteria, initial.criteria);
    assert.equal(result.overallBand, initial.overallBand);
    assert.equal(result.revisionAssessment?.status, earlierVerified ? "below_target" : "unverified");
    assert.equal(result.revisionAssessment?.overallBand, earlierVerified ? 6 : null);
    assert.equal(result.improvedEssay, earlierVerified ? candidate("First") : initial.improvedEssay);
  }
});

test("high scores with changed facts or invented quotations cannot certify a target revision", async () => {
  for (const failure of ["facts", "quote", "check unavailable"]) {
    const initial = feedback();
    const result = await attachTargetRevision(input, q, initial, [], async messages => {
      const d = data(messages);
      if (d.targetBand) return { improvedEssay: candidate() };
      if (d.candidate) return failure === "facts" ? { valid: false, issues: ["虚构调查数字。"] } : failure === "check unavailable" ? {} : validCheck;
      return { criteria: card(failure === "quote" ? "Invented quotation." : d.essay, [9, 9, 9, 9]) };
    }, deadline());
    assert.equal(result.revisionAssessment?.status, "unverified", failure);
    assert.equal(result.revisionAssessment?.overallBand, null);
    assert.equal(result.improvedEssay, initial.improvedEssay);
    assert.equal(result.overallBand, initial.overallBand);
  }
});

test("a later invalid candidate never replaces an earlier independently verified candidate", async () => {
  let count = 0;
  const result = await attachTargetRevision(input, q, feedback(), [], async messages => {
    const d = data(messages);
    if (d.targetBand) return { improvedEssay: candidate(++count === 1 ? "First" : "Invalid") };
    if (d.candidate) return { valid: count === 1, issues: count === 1 ? [] : ["后续候选改换立场。"] };
    return { criteria: card(d.essay, count === 1 ? [6, 6, 6, 6] : [9, 9, 9, 9]) };
  }, deadline());
  assert.equal(result.revisionAssessment?.status, "below_target");
  assert.equal(result.revisionAssessment?.overallBand, 6);
  assert.match(result.improvedEssay, /^First/);
  assert.equal(result.revisionAssessment?.criteria?.grammar.score, 6);
});

test("terminal citation punctuation can be removed without changing words or scores, but invented wording stays rejected", async () => {
  const text = candidate().replace("First candidate.", "The park gained a cafe and a larger playground, while its entrance remained.");
  for (const invented of [false, true]) {
    const result = await attachTargetRevision(input, q, feedback(), [], async messages => {
      const d = data(messages);
      if (d.targetBand) return { improvedEssay: text };
      if (d.candidate) return validCheck;
      const criteria = card(d.essay);
      criteria.lexical.evidence = invented ? "The park gained a spacious cafe and a larger playground." : "The park gained a cafe and a larger playground.";
      return { criteria };
    }, deadline());
    assert.equal(result.revisionAssessment?.status, invented ? "unverified" : "met");
    if (!invented) {
      assert.equal(result.revisionAssessment?.criteria?.lexical.evidence, "The park gained a cafe and a larger playground");
      assert.equal(result.revisionAssessment?.criteria?.lexical.score, 7);
    }
  }
});

test("timeouts preserve baseline feedback and missing charts never produce a verified score", async () => {
  const initial = feedback(); let calls = 0;
  const fail: RevisionCompletion = async () => { calls++; throw Error("synthetic unavailable"); };
  const timed = await attachTargetRevision(input, q, initial, [], fail, Date.now() + 1000);
  assert.equal(calls, 0);
  assert.equal(timed.revisionAssessment?.status, "unverified");
  const failed = await attachTargetRevision(input, q, initial, [], fail, deadline());
  assert.equal(calls, 1); assert.equal(failed.improvedEssay, initial.improvedEssay);
  const chart = await attachTargetRevision(input, { ...q, task: "Task 1" }, initial, [], fail, deadline());
  assert.equal(calls, 1); assert.equal(chart.revisionAssessment?.status, "language_only");
  assert.equal(chart.revisionAssessment?.overallBand, null);
});

test("short drafts are expanded before scoring and a lower target cannot reduce the original level", async () => {
  let count = 0, scoreCalls = 0;
  const result = await attachTargetRevision({ ...input, targetBand: 5 }, q, feedback(8), [], async messages => {
    const d = data(messages);
    if (d.targetBand) {
      assert.equal(d.minimumBand, 8);
      if (++count === 2) assert.match(d.previousCandidate.issues[0], /至少需要250词/);
      return { improvedEssay: count === 1 ? "This short candidate is too brief to satisfy this writing task." : candidate() };
    }
    if (d.candidate) return validCheck;
    scoreCalls++; return { criteria: card(d.essay, [8, 8, 8, 8]) };
  }, deadline());
  assert.equal(scoreCalls, 1); assert.equal(count, 2);
  assert.equal(result.revisionAssessment?.minimumBand, 8);
  assert.equal(result.revisionAssessment?.status, "met");
});

test("chart images reach the writer, blind assessor and fidelity reviewer", async () => {
  const images = ["data:image/png;base64,synthetic-chart"], chart = { ...q, task: "Task 1" as const };
  const writer = targetRevisionMessages(input, chart, feedback(), 7, undefined, images);
  const check = revisionFidelityMessages(input, chart, candidate(), images);
  for (const messages of [writer, check]) assert.equal((messages[1].content as { image_url?: { url: string } }[])[1].image_url?.url, images[0]);
  const result = await attachTargetRevision(input, chart, feedback(), images, async messages => {
    const d = data(messages);
    assert.ok(JSON.stringify(messages).includes(images[0]));
    return d.targetBand ? { improvedEssay: candidate() } : d.candidate ? validCheck : { criteria: card(d.essay) };
  }, deadline());
  assert.equal(result.revisionAssessment?.status, "met");
});

test("map fidelity uses independent reasoning without receiving the target or grading the original", async () => {
  const map = { ...q, task: "Task 1" as const, category: "map", stem: "The maps show a public park in 2000 and 2025. Summarise the changes." };
  let checked = false;
  const result = await attachTargetRevision(input, map, feedback(), ["data:image/png;base64,synthetic-map"], async(messages, thinking, maxTokens) => {
    const d = data(messages);
    if (d.targetBand) return { improvedEssay: candidate() };
    if (d.candidate) {
      checked = true; assert.equal(thinking, true); assert.equal(maxTokens, 8000);
      assert.equal("targetBand" in d, false); assert.equal("minimumBand" in d, false);
      return validCheck;
    }
    return { criteria: card(d.essay) };
  }, deadline());
  assert.ok(checked); assert.equal(result.revisionAssessment?.status, "met");
});

test("live assessment wrapper keeps original scores separate from target revision through provider transport", async () => {
  const calls: Record<string, unknown>[] = [];
  const result = await assessEssayWithCoaching(input, q, { DEEPSEEK_API_KEY: "synthetic-test-key" }, { fetch: async () => new Response("", { status: 404 }) }, async (_url, init) => {
    const body = JSON.parse(String(init?.body)), d = data(body.messages); calls.push(d);
    const payload = d.minimumBand ? { improvedEssay: candidate() } : d.candidate ? validCheck : d.essay === original && !d.approvedAssessment ? { criteria: card(original, [4, 4, 4, 4]) } : d.essay && !d.approvedAssessment ? { criteria: card(d.essay) } : d.approvedAssessment ? feedback() : {};
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }] });
  });
  assert.equal(result.overallBand, 4);
  assert.equal(result.revisionAssessment?.overallBand, 7);
  assert.equal(result.revisionAssessment?.status, "met");
  assert.deepEqual(result.criteria, card(original, [4, 4, 4, 4]));
  assert.equal("targetBand" in calls[0], false);
  assert.equal("targetBand" in calls[1], false);
});

test("display and exported text distinguish original, target and independently verified revision, including history", async () => {
  const result = await attachTargetRevision(input, q, feedback(), [], async messages => {
    const d = data(messages);
    return d.targetBand ? { improvedEssay: candidate() } : d.candidate ? validCheck : { criteria: card(d.essay) };
  }, deadline());
  const text = revisionAssessmentText(result.revisionAssessment);
  assert.match(text, /改稿目标：7.0分/);
  assert.match(text, /改稿独立复评：7.0/);
  assert.match(text, /依据：First candidate/);
  const html = renderToStaticMarkup(React.createElement(RevisionAssessmentPanel, { assessment: result.revisionAssessment }));
  assert.match(html, /data-revision-status="met"/);
  assert.match(html, /查看改稿复评依据/);
  assert.match(revisionAssessmentText(), /尚未按目标分独立复评/);
  assert.match(renderToStaticMarkup(React.createElement(RevisionAssessmentPanel)), /尚未按目标分独立复评/);
});
