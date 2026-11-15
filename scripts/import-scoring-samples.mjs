// 机械导入：官方评分样本索引 -> data/scoring-samples.json
// 只做字段映射与校验，不改动作文字句、换行、拼写或 OCR 错误。
// 输入：SCORING_SAMPLES_PATH，必须指向有权使用的本机样本索引。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.env.SCORING_SAMPLES_PATH;
if (!inputPath) throw new Error("Set SCORING_SAMPLES_PATH to content you are authorized to use.");
const outputPath = path.join(root, "data", "scoring-samples.json");
const reportPath = path.join(
  root,
  "storage",
  "scoring-samples-import-report.json",
);

const SOURCE_ORIGIN_FALLBACK = "https://ieltswritingchecker.org";
const SOURCE_SECTION_PATH = "/zh-CN/official-ielts-writing-samples";

const raw = fs.readFileSync(inputPath);
const text = raw.toString("utf8").replace(/^﻿/, "");
const inputSha256 = crypto.createHash("sha256").update(raw).digest("hex");
const doc = JSON.parse(text);

if (!Array.isArray(doc?.samples)) {
  throw new Error(`输入缺少顶层 samples 数组：${inputPath}`);
}
if (!doc.samples.length) throw new Error("输入样本库为空");

const EXAM_TYPE_BY_MODULE = {
  Academic: "A",
  "General Training": "G",
};
const VALID_TASKS = new Set(["Task 1", "Task 2"]);
const CRITERION_KEYS = ["TA_or_TR", "CC", "LR", "GRA"];

const errors = [];
const seenIds = new Map();
const samples = doc.samples.map((s, index) => {
  const at = `samples[${index}] id=${JSON.stringify(s?.id ?? null)}`;
  const fail = (msg) => errors.push(`${at}: ${msg}`);

  // id 唯一
  if (typeof s.id !== "string" || !s.id.trim()) fail("id 缺失或不是非空字符串");
  else if (seenIds.has(s.id)) fail(`id 重复，首次出现于 samples[${seenIds.get(s.id)}]`);
  else seenIds.set(s.id, index);

  // examType：module 映射，未知报错
  const examType = EXAM_TYPE_BY_MODULE[s.module];
  if (!examType) fail(`未知的 module=${JSON.stringify(s.module)}，无法映射 examType`);

  // task 有效
  if (!VALID_TASKS.has(s.task)) fail(`task 无效：${JSON.stringify(s.task)}`);

  // band：0–9、0.5 递进，或 null（不为无分范文编造分数）
  if (s.band !== null) {
    if (typeof s.band !== "number" || !Number.isFinite(s.band))
      fail(`band 必须是数字或 null：${JSON.stringify(s.band)}`);
    else if (s.band < 0 || s.band > 9 || !Number.isInteger(s.band * 2))
      fail(`band 必须落在 0–9 且以 0.5 递进：${s.band}`);
  }

  // 题干 / 作文 / 评语 / 来源 URL 非空
  for (const [key, label] of [
    ["prompt", "题干"],
    ["response", "作文"],
    ["examiner_comment", "评语"],
    ["anchor_url", "来源 URL"],
  ]) {
    if (typeof s[key] !== "string" || !s[key].trim()) fail(`${label}（${key}）为空`);
  }

  // 所有 criterion_scores 为空
  const cs = s.criterion_scores ?? {};
  for (const key of CRITERION_KEYS) {
    if (cs[key] !== null && cs[key] !== undefined)
      fail(`criterion_scores.${key} 非空：${JSON.stringify(cs[key])}`);
  }
  for (const key of Object.keys(cs)) {
    if (!CRITERION_KEYS.includes(key))
      fail(`criterion_scores 出现未预期的键：${key}`);
  }

  if (typeof s.is_unscored_model_answer !== "boolean")
    fail(`is_unscored_model_answer 必须是布尔值：${JSON.stringify(s.is_unscored_model_answer)}`);
  if ((s.band === null) !== s.is_unscored_model_answer)
    fail("band 与无分范文标记不一致");
  try {
    if (new URL(s.anchor_url).origin !== SOURCE_ORIGIN_FALLBACK) fail("来源URL不属于预期网站");
  } catch { fail("来源URL无效"); }

  return {
    id: s.id,
    sourceGroup: s.source_group,
    title: s.source_label,
    task: s.task,
    examType: examType ?? null,
    band: s.band,
    question: s.prompt,
    essay: s.response,
    comment: s.examiner_comment,
    sourceUrl: s.anchor_url,
    provenance: s.provenance_status,
    wordCount: s.response_word_count,
    imageUrls: Array.isArray(s.image_urls) ? [...s.image_urls] : [],
    isUnscoredModelAnswer: s.is_unscored_model_answer,
  };
});

if (errors.length) {
  console.error(`校验失败，共 ${errors.length} 项：`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

// 统计
const scored = samples.filter((s) => s.band !== null).length;
const unscored = samples.filter((s) => s.band === null).length;

const tally = (list, key) =>
  list.reduce((acc, s) => {
    acc[s[key]] = (acc[s[key]] ?? 0) + 1;
    return acc;
  }, {});

const byTask = tally(samples, "task");
const byExamType = tally(samples, "examType");
const byTaskAndExamType = samples.reduce((acc, s) => {
  const key = `${s.task} / ${s.examType}`;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

// 重复正文：按作文正文原始 sha256 归组，仅在报告中记录，不去重
const groups = new Map();
for (const s of samples) {
  const hash = crypto.createHash("sha256").update(s.essay, "utf8").digest("hex");
  if (!groups.has(hash)) groups.set(hash, []);
  groups.get(hash).push(s.id);
}
const duplicateResponseGroups = [...groups.entries()]
  .filter(([, ids]) => ids.length > 1)
  .map(([sha256, ids]) => ({ sha256, count: ids.length, ids }))
  .sort((a, b) => b.count - a.count || a.sha256.localeCompare(b.sha256));

const firstOrigin = (() => {
  try {
    return new URL(samples[0].sourceUrl).origin;
  } catch {
    return SOURCE_ORIGIN_FALLBACK;
  }
})();

const output = {
  metadata: {
    collectedAt: doc.metadata?.collected_at || new Date().toISOString(),
    sourceUrl: firstOrigin + SOURCE_SECTION_PATH,
    total: samples.length,
    scored,
    unscored,
    criterionScoresAvailable: false,
  },
  samples,
};

const outputText = JSON.stringify(output, null, 2) + "\n";
const outputSha256 = crypto
  .createHash("sha256")
  .update(outputText, "utf8")
  .digest("hex");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(outputPath, outputText, "utf8");

const bandUnscoredConsistent = samples.every(
  (s) => (s.band === null) === s.isUnscoredModelAnswer,
);

const report = {
  generatedAt: new Date().toISOString(),
  input: { path: inputPath, sha256: inputSha256, total: doc.samples.length },
  output: { path: outputPath, sha256: outputSha256, total: samples.length },
  counts: { total: samples.length, scored, unscored },
  byTask,
  byExamType,
  byTaskAndExamType,
  duplicateResponseGroups,
  duplicateResponseGroupCount: duplicateResponseGroups.length,
  duplicateResponseSampleCount: duplicateResponseGroups.reduce(
    (n, g) => n + g.count,
    0,
  ),
  checks: {
    uniqueIds: true,
    taskValid: true,
    examTypeMapped: true,
    bandInRangeAndHalfStep: true,
    requiredTextFieldsNonEmpty: true,
    criterionScoresAllEmpty: true,
    inputOutputOneToOne: samples.length === doc.samples.length,
    bandUnscoredConsistent,
  },
  notes: [
    "原文（题干/作文/评语）逐字保留，未修正拼写或 OCR 错误。",
    "provenance 字段原样沿用来源标注，本脚本未对范文做任何独立核验。",
    "无分范文的 band 保持为 null，未编造分数。",
  ],
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(
  [
    `总条数：${samples.length}（输入 ${doc.samples.length}）`,
    `带分：${scored}　无分：${unscored}`,
    `按 task：${Object.entries(byTask)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("　")}`,
    `按 examType：${Object.entries(byExamType)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("　")}`,
    `按 task·examType：${Object.entries(byTaskAndExamType)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join("　")}`,
    `重复正文组：${duplicateResponseGroups.length} 组 / ${duplicateResponseGroups.reduce(
      (n, g) => n + g.count,
      0,
    )} 篇`,
    ...duplicateResponseGroups.map(
      (g) => `  ${g.sha256.slice(0, 12)}… ×${g.count} → ${g.ids.join(", ")}`,
    ),
    `band 与无分标记一致性：${bandUnscoredConsistent ? "一致" : "不一致"}`,
    `输出：${outputPath}`,
    `报告：${reportPath}`,
    `输入 SHA256：${inputSha256}`,
    `输出 SHA256：${outputSha256}`,
  ].join("\n"),
);
