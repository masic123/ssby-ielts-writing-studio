import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseScoringCard, parseQuotedScoringCard, scoringCardMessages, scoreKeys } from "../src/lib/scoring-card";
import { scoringPolicy, productionScoringPolicy } from "../src/lib/scoring-policy";
import { feedbackSchema, essaySchema } from "../src/lib/validation";
import { assessEssay, normalizeFeedback } from "../src/lib/reviewer";
import { criterionBandText, hasLegacyCriterionBands, writingOverallBand } from "../src/lib/writing-score";
import { revisionAssessmentText, type RevisionAssessment } from "../src/lib/revision-assessment";
import { questions } from "../src/lib/content";
import RevisionAssessmentPanel from "../src/components/revision-assessment";
import Report from "../src/components/report";
import type { Feedback, Review } from "../src/lib/types";

const q = questions().find(q => q.task === "Task 2" && q.examType === "A")!;
const essay = "Students can learn useful skills by working together.";
const input = { questionId: q.id, title: "", targetBand: 7.5, essay };
const card = (scores = [6, 7, 7, 7]) => Object.fromEntries(scoreKeys.map((key, i) => [key, { score: scores[i], reason: "依据对应量表及原文能力判断。", evidence: essay }])) as ReturnType<typeof parseScoringCard>;
const report = { summary: "这篇作文立场明确，可以进一步展开解释。", criteria: card(), strengths: [], priorities: [{ title: "展开观点", reason: "解释可以更充分。", action: "补充合理的原因和例子。" }], methodChecks: [], paragraphs: [], corrections: [], advancedSuggestions: [], improvedEssay: essay, exercises: [] };

test("all four scorecard fields accept whole bands only and never round an invalid model score", () => {
  for (const score of [0, 1, 4, 6, 7, 9]) assert.equal(parseScoringCard({ criteria: card([score, score, score, score]) }).grammar.score, score);
  for (const key of scoreKeys) {
    for (const invalid of [0.5, 6.5, 7.5, 8.5, 6.25, -1, 10, NaN, Infinity, "7", null]) {
      const criteria = { ...card(), [key]: { ...card()[key], score: invalid } };
      assert.throws(() => parseScoringCard({ criteria }), /Invalid criterion/);
      assert.throws(() => parseQuotedScoringCard({ criteria }, essay), /Invalid criterion/);
      if (invalid !== null) assert.equal(feedbackSchema.safeParse({ ...report, criteria }).success, false);
    }
  }
  const parsed = normalizeFeedback(report, input, q, false);
  assert.deepEqual(parsed.criteria, card());
  assert.equal(parsed.overallBand, 6.5, "a task total can retain a half band from integer criteria");
  assert.equal(essaySchema.safeParse(input).success, true, "the overall learning target can still be 7.5");
  assert.throws(() => normalizeFeedback({ ...report, criteria: card([6.5, 7, 7, 7]) }, input, q, false), /未生成有效评分/);
});

test("a half-band model score cannot become an original assessment or editing report", async () => {
  let calls = 0;
  const mock = (async () => {
    calls++;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ criteria: card([7, 7, 6.5, 7]) }) } }] });
  }) as typeof fetch;
  await assert.rejects(assessEssay(input, q, { DEEPSEEK_API_KEY: "test" }, { fetch: async () => new Response("", { status: 404 }) }, mock), /独立评分结果不完整/);
  assert.equal(calls, 1);
});

test("all scoring policies and both task prompts distinguish integer criteria from half-band totals", () => {
  for (const version of ["baseline", "calibrated-v1", "anchored-baseline", "anchored-calibrated-v1", "anchored-reasoning-v1", "evidence-guided-v2", "evidence-reviewed-v2"] as const) {
    assert.match(scoringPolicy(version), /小分只能是 0 至 9 的整数/);
    assert.doesNotMatch(scoringPolicy(version), /整分或半分/);
  }
  for (const task of ["Task 1", "Task 2"] as const) {
    const messages = scoringCardMessages({ ...q, task }, essay, productionScoringPolicy);
    assert.match(messages[0].content as string, /不能先给半分再四舍五入或截断/);
    assert.equal(JSON.stringify(messages).includes('"targetBand"'), false);
  }
});

test("whole-band UI and exports preserve half-band totals and mark old fractional criteria for reassessment", () => {
  const assessment: RevisionAssessment = { version: "test", targetBand: 7.5, minimumBand: 7.5, overallBand: 7.5, criteria: card([7, 8, 8, 7]), status: "met", attempts: 1, wordCount: 280, issues: [] };
  const markup = renderToStaticMarkup(React.createElement(RevisionAssessmentPanel, { assessment }));
  assert.match(markup, /<strong>7<\/strong>/);
  assert.match(markup, /<strong>8<\/strong>/);
  assert.doesNotMatch(markup, /<strong>[78]\.0<\/strong>/);
  assert.match(markup, /7\.5/);
  assert.match(revisionAssessmentText(assessment), /词汇运用：8\n/);
  assert.equal(criterionBandText(null), "未评分");
  const legacy = { ...assessment, criteria: card([7, 7.5, 8, 7]) };
  const before = structuredClone(legacy);
  assert.equal(hasLegacyCriterionBands(legacy.criteria), true);
  assert.equal(criterionBandText(7.5), "待复评");
  const oldMarkup = renderToStaticMarkup(React.createElement(RevisionAssessmentPanel, { assessment: legacy }));
  assert.match(oldMarkup, /待复评/);
  assert.match(oldMarkup, /旧报告/);
  assert.doesNotMatch(oldMarkup, /<strong>7\.5<\/strong>/);
  assert.match(revisionAssessmentText(legacy), /连贯与衔接：待复评/);
  assert.deepEqual(legacy, before, "display never mutates historical criteria or totals");
  assert.equal(writingOverallBand(legacy.criteria), 7, "history keeps its existing aggregate calculation");
});

test("the original report renders integer criteria and identifies old fractional scores without changing them", () => {
  const feedback = normalizeFeedback(report, input, q, false);
  const review: Review = { id: "integer-report", draftId: null, status: "completed", createdAt: "2026-11-10T01:00:00Z", input, question: q, feedback, error: null, model: "test", references: [] };
  const markup = renderToStaticMarkup(React.createElement(Report, { review, onBack: () => {}, onRewrite: () => {} }));
  assert.match(markup, /<strong>6<\/strong>/);
  assert.match(markup, /<strong>7<\/strong>/);
  assert.match(markup, /<strong>6\.5<\/strong>/, "the original overall score retains its half band");
  const legacy: Feedback = { ...feedback, criteria: card([6, 6.5, 7, 7]) };
  const before = structuredClone(legacy);
  const oldMarkup = renderToStaticMarkup(React.createElement(Report, { review: { ...review, feedback: legacy }, onBack: () => {}, onRewrite: () => {} }));
  assert.match(oldMarkup, /待复评/);
  assert.match(oldMarkup, /需重新批改后按整数档复评/);
  assert.deepEqual(legacy, before);
});
