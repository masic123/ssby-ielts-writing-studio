import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { methods, questions, referencesFor } from "../src/lib/content";
import { methodAppliesTo, methodProvider, methodSourceLabel } from "../src/lib/methods";
import type { MethodRule } from "../src/lib/types";

test("classroom sources resolve to parsed PDF pages and official criteria", () => {
  const manifest = JSON.parse(fs.readFileSync("research/course-notes/source-manifest.json", "utf8"));
  const rules = methods().filter((r) => methodProvider(r) === "tian-nan");
  assert.equal(rules.length, manifest.methodCount);
  assert.equal(new Set(methods().map((r) => r.id)).size, methods().length);
  assert.equal(manifest.parsedPageCount, 254);
  for (const rule of rules) {
    const source = manifest.files.find((f: { file: string }) => f.file === rule.source?.file);
    assert.ok(source, rule.id);
    assert.equal(rule.source?.verification, "pdf_text_checked");
    assert.ok(rule.source?.pages?.includes(rule.source.page));
    for (const page of rule.source?.pages || []) assert.ok(source.parsedPages.includes(page), rule.id);
    assert.ok(rule.criteria?.every((c) => ["taskResponse", "coherence", "lexical", "grammar"].includes(c)));
    assert.ok(rule.condition);
    assert.ok(!rule.source?.section.startsWith("L1"));
  }
});

test("methods match tasks and distinguish charts, maps, processes and letters", () => {
  const bank = questions();
  const map = bank.find((q) => q.category === "地图")!;
  const process = bank.find((q) => q.category === "流程图")!;
  const chart = bank.find((q) => q.category === "曲线图")!;
  const essay = bank.find((q) => q.task === "Task 2")!;
  const letter = { ...chart, examType: "G" as const };
  const ids = (q: typeof chart) => referencesFor(q).rules.map((r) => r.id);
  assert.ok(ids(map).includes("tn-map-overview"));
  assert.ok(!ids(map).includes("tn-dynamic-features"));
  assert.ok(!ids(map).includes("data"));
  assert.ok(ids(process).includes("tn-process-stages"));
  assert.ok(!ids(process).includes("tn-map-group"));
  assert.ok(ids(chart).includes("tn-static-comparisons"));
  assert.ok(!ids(chart).includes("tn-process-overview"));
  assert.ok(ids(essay).includes("tn-argument-chain"));
  assert.ok(!ids(essay).includes("tn-chart-overview"));
  assert.deepEqual(referencesFor(letter), { rules: [], passages: [] });
  assert.ok(methods().every((r) => !methodAppliesTo(r, letter)));
  const custom = { ...chart, category: "自选" };
  assert.ok(!ids(custom).includes("tn-dynamic-features"));
});

test("missing visuals exclude chart claims and legacy references keep their source", () => {
  const chart = questions().find((q) => q.category === "曲线图")!;
  const refs = referencesFor(chart, false);
  assert.ok(refs.rules.length > 0);
  assert.ok(refs.rules.every((r) => !r.requiresVisual));
  assert.ok(refs.rules.some((r) => r.id === "tn-proofread"));
  const legacy: MethodRule = {
    id: "answer", title: "旧报告", summary: "", detail: "", task: "Task 2",
    source: { section: "大作文", page: 12, chunkId: "legacy" },
  };
  assert.equal(methodProvider(legacy), "simon");
  assert.match(methodSourceLabel(legacy), /Simon.*12.*大作文/);
  const course = methods().find((r) => r.id === "tn-chart-read")!;
  assert.match(methodSourceLabel(course), /新东方.*读写L5笔记.pdf.*PDF 第15页/);
  assert.ok(!methodSourceLabel(course).includes("Simon"));
});
