import { test } from "node:test";
import assert from "node:assert/strict";
import { blankOutline, hasOutline, outlineGuide, outlineText } from "../src/lib/outline";
import { essaySchema } from "../src/lib/validation";
import { wordCount } from "../src/lib/types";
import { questions } from "../src/lib/content";

test("outlines preserve old drafts, validate lengths and keep word counts separate", () => {
  const draft = { questionId: 11723, title: "Outline only", essay: "", targetBand: 7 };
  assert.ok(essaySchema.safeParse(draft).success);
  const outline = blankOutline();
  assert.equal(hasOutline(outline), false);
  outline.position = "Public transport matters as much as housing density.";
  outline.paragraphs[0].point = "Efficient use of land";
  const parsed = essaySchema.parse({ ...draft, outline });
  assert.deepEqual(parsed.outline, outline);
  assert.ok(hasOutline(parsed.outline));
  assert.equal(wordCount(parsed.essay), 0);
  assert.equal(essaySchema.safeParse({ ...draft, outline: { ...outline, analysis: "x".repeat(2001) } }).success, false);
  assert.equal(essaySchema.safeParse({ ...draft, outline: { ...outline, paragraphs: Array(9).fill(outline.paragraphs[0]) } }).success, false);
  assert.equal(essaySchema.safeParse({ ...draft, outline: { ...outline, paragraphs: Array(2).fill(outline.paragraphs[0]) } }).success, false);
});

test("outline prompts and exports follow essay, chart and letter tasks", () => {
  const essay = questions().find((q) => q.task === "Task 2")!;
  const chart = { ...essay, task: "Task 1" as const, examType: "A" as const };
  const letter = { ...chart, examType: "G" as const };
  assert.match(outlineGuide(essay).position, /立场/);
  assert.match(outlineGuide(chart).position, /概述/);
  assert.match(outlineGuide(letter).analysis, /收信人/);
  const outline = blankOutline();
  outline.analysis = "children and adults";
  outline.paragraphs[0].support = "Explain the mechanism";
  const exported = outlineText(outline, essay);
  assert.match(exported, /莎试笔雅/);
  assert.match(exported, /children and adults/);
  assert.match(exported, /Explain the mechanism/);
  assert.match(outlineText(outline, chart), /细节段 1/);
  assert.match(outlineText(outline, letter), /要点段 1/);
});
