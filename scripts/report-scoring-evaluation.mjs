#!/usr/bin/env node
/**
 * 机械性结果整理脚本（不做任何评分判断、不做上线决策、不修改模型、不选择候选）。
 *
 * 固定目录：storage/scoring-evaluation-20261028
 * 输入：protocol.json / candidate-lock.json / <policy>-development.json / <policy>-holdout.json
 * 输出：comparison.csv / comparison-summary.json / comparison-report.md（同目录）
 *
 * 仅使用 Node 标准库，ESM，无依赖，不联网，不删除任何文件。
 */

import {existsSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = resolve(ROOT, "storage", "scoring-evaluation-20261028");

const EXPECTED_TOTAL = 97;
const BOOTSTRAP_ITERATIONS = 10000;
const BOOTSTRAP_SEED = 20261028;
const EPS = 1e-6;

const OUT_CSV = join(DIR, "comparison.csv");
const OUT_JSON = join(DIR, "comparison-summary.json");
const OUT_MD = join(DIR, "comparison-report.md");

const SPLIT_LABEL = {development: "开发组(development)", holdout: "保留组(holdout)"};

const CRITERIA_LABELS = [
  "taskResponse",
  "coherence",
  "lexical",
  "grammar",
];
const CRITERIA_ALIASES = [
  ["taskResponse", "task_response", "taskAchievement", "task_achievement", "TR"],
  ["coherence", "coherenceCohesion", "coherence_cohesion", "CC"],
  ["lexical", "lexicalResource", "lexical_resource", "LR"],
  [
    "grammar",
    "grammaticalRangeAccuracy",
    "grammatical_range_accuracy",
    "grammaticalRange",
    "grammatical_range",
    "GRA",
  ],
];

function die(title, details = []) {
  const lines = [`[report-scoring-evaluation] ${title}`];
  for (const detail of details) if (detail) lines.push(`  - ${detail}`);
  throw new Error(lines.join("\n"));
}

/* ------------------------------------------------------------------ 读取 */

function readJson(file) {
  if (!existsSync(file)) die("缺少必需的输入文件", [file]);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    die("无法读取文件", [file, String(error && error.message)]);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    die("JSON 解析失败", [file, String(error && error.message)]);
  }
}

/** 结果文件可能是数组，也可能是含 summary 等字段的对象：只取行数组。 */
function extractRows(json, file) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const key of ["rows", "results", "evaluationRows", "items", "records"]) {
      if (Array.isArray(json[key])) return json[key];
    }
    for (const value of Object.values(json)) {
      if (Array.isArray(value) && value.some((v) => v && typeof v === "object")) return value;
    }
  }
  die("结果文件中找不到行数组（rows）", [file]);
}

function toIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const id = item.sampleId ?? item.sample_id ?? item.id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
    die("protocol 中的样本标识无法解析", [JSON.stringify(item)]);
  });
}

function loadProtocol() {
  const file = join(DIR, "protocol.json");
  const json = readJson(file);
  const split =
    json && typeof json === "object" && json.split && typeof json.split === "object"
      ? json.split
      : json;
  const development = toIdList(split?.development);
  const holdout = toIdList(split?.holdout);
  const groupsRaw = Array.isArray(split?.groups) ? split.groups : [];
  const groups = groupsRaw.map((group, index) => ({
    id: typeof group?.id === "string" && group.id.trim() ? group.id.trim() : `group-${index}`,
    stratum: typeof group?.stratum === "string" ? group.stratum : "",
    sampleIds: toIdList(group?.sampleIds ?? group?.samples ?? group?.ids),
  }));

  const developmentSet = new Set(development);
  const holdoutSet = new Set(holdout);
  const problems = [];
  if (developmentSet.size !== development.length)
    problems.push(`development 中存在重复样本：${development.length} 项 / ${developmentSet.size} 个唯一`);
  if (holdoutSet.size !== holdout.length)
    problems.push(`holdout 中存在重复样本：${holdout.length} 项 / ${holdoutSet.size} 个唯一`);
  const overlap = [...developmentSet].filter((id) => holdoutSet.has(id));
  if (overlap.length) problems.push(`development 与 holdout 存在重叠样本：${overlap.slice(0, 10).join(", ")}`);
  const total = developmentSet.size + holdoutSet.size;
  if (total !== EXPECTED_TOTAL)
    problems.push(`protocol 样本总数为 ${total}，与预定的 ${EXPECTED_TOTAL} 篇不一致（development ${developmentSet.size} / holdout ${holdoutSet.size}）`);
  if (problems.length) die("protocol.json 校验未通过", problems);

  const expected = new Set([...developmentSet, ...holdoutSet]);
  const groupProblems = [];
  const seenGroup = new Set();
  const covered = new Map();
  for (const group of groups) {
    if (seenGroup.has(group.id)) groupProblems.push(`题目组 id 重复：${group.id}`);
    seenGroup.add(group.id);
    if (!group.sampleIds.length) {
      groupProblems.push(`题目组 ${group.id} 没有样本`);
      continue;
    }
    for (const id of group.sampleIds) {
      if (!expected.has(id)) groupProblems.push(`题目组 ${group.id} 含 protocol 之外的样本：${id}`);
      if (covered.has(id)) groupProblems.push(`样本 ${id} 同时属于题目组 ${covered.get(id)} 与 ${group.id}`);
      covered.set(id, group.id);
    }
    if(group.sampleIds.some(id=>developmentSet.has(id))&&group.sampleIds.some(id=>holdoutSet.has(id)))groupProblems.push(`题目组 ${group.id} 跨越开发组与保留组`);
  }
  for (const id of expected) if (!covered.has(id)) groupProblems.push(`样本 ${id} 不属于任何题目组`);
  if (groupProblems.length) die("protocol.json 题目组校验未通过", groupProblems.slice(0, 20));

  return {
    file,
    development: [...developmentSet].sort(),
    holdout: [...holdoutSet].sort(),
    developmentSet,
    holdoutSet,
    expected,
    groups: groups.sort((a, b) => a.id.localeCompare(b.id)),
    strata: [...new Set(groups.map((g) => g.stratum).filter(Boolean))].sort(),
    seed: typeof json?.seed === "string" ? json.seed : null,
  };
}

function loadLock() {
  const file = join(DIR, "candidate-lock.json");
  if (!existsSync(file))
    die("candidate-lock.json 不存在，拒绝生成报告（锁定文件缺失时不产出任何结果）", [file]);
  const json = readJson(file);
  const candidatePolicy = typeof json?.candidatePolicy === "string" ? json.candidatePolicy.trim() : "";
  if (!candidatePolicy) die("candidate-lock.json 缺少 candidatePolicy", [file]);

  const raw = json?.comparisonPolicies ?? json?.baselinePolicies ?? json?.comparisons;
  if (!Array.isArray(raw)) die("candidate-lock.json 缺少 comparisonPolicies（字符串数组）", [file]);
  const comparisonPolicies = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) die("comparisonPolicies 含有非字符串项", [file, String(item)]);
    const value = item.trim();
    if (!comparisonPolicies.includes(value)) comparisonPolicies.push(value);
  }
  const missing = ["baseline", "anchored-baseline"].filter((p) => !comparisonPolicies.includes(p));
  if (missing.length)
    die("comparisonPolicies 必须包含 baseline 与 anchored-baseline", [`缺失：${missing.join(", ")}`, `实际：${comparisonPolicies.join(", ")}`]);

  const policies = [candidatePolicy, ...comparisonPolicies.filter((p) => p !== candidatePolicy)];
  return {file, candidatePolicy, comparisonPolicies, policies};
}

function resolveResultFile(policy, split) {
  const candidates = [
    join(DIR, `${policy}-${split}.json`),
    join(DIR, `${policy}.${split}.json`),
    join(DIR, `${policy}_${split}.json`),
  ];
  for (const file of candidates) if (existsSync(file)) return file;
  const available = existsSync(DIR)
    ? readdirSync(DIR).filter((name) => name.endsWith(`-${split}.json`))
    : [];
  die(
    `policy「${policy}」缺少 ${split} 结果文件`,
    [`尝试过：${candidates.map((c) => c.slice(DIR.length + 1)).join(", ")}`, `目录中可用的 *-${split}.json：${available.join(", ") || "（无）"}`],
  );
}

function validateRow(row, policy, split, file) {
  const where = `${policy}/${split}/${row?.sampleId ?? "?"}`;
  if (!row || typeof row !== "object") die("结果行不是对象", [file, where]);
  if (typeof row.sampleId !== "string" || !row.sampleId.trim()) die("结果行缺少 sampleId", [file, where]);
  if (row.status !== "ok")
    die("存在非成功行，禁止静默丢弃", [file, `${where} status=${row.status}`, row.error ? `error=${row.error}` : ""]);
  const problems = [];
  for (const [key, value] of [
    ["task", row.task],
    ["examType", row.examType],
  ]) {
    if (typeof value !== "string" || !value.trim()) problems.push(`${key} 缺失或非字符串`);
  }
  for (const key of ["goldBand", "predictedBand", "delta", "absError"]) {
    const value = row[key];
    if (typeof value !== "number" || !Number.isFinite(value))
      problems.push(`${key} 缺失或不是有限数字（实际：${JSON.stringify(value)}）`);
  }
  if (problems.length) die("结果行字段不完整", [file, where, ...problems]);
  if (row.goldBand < 0 || row.goldBand > 9) die("goldBand 超出 0–9 范围", [file, where, String(row.goldBand)]);
  if (row.predictedBand < 0 || row.predictedBand > 9)
    die("predictedBand 超出 0–9 范围", [file, where, String(row.predictedBand)]);
  const expectedDelta = row.predictedBand - row.goldBand;
  if (Math.abs(row.delta - expectedDelta) > EPS)
    die("delta 与 predictedBand-goldBand 不自洽", [file, where, `delta=${row.delta} 期望=${expectedDelta}`]);
  if (Math.abs(row.absError - Math.abs(row.delta)) > EPS)
    die("absError 与 |delta| 不自洽", [file, where, `absError=${row.absError} |delta|=${Math.abs(row.delta)}`]);
  const scores=["taskResponse","coherence","lexical","grammar"].map(key=>row.predictedCriteria?.[key]);
  if(scores.some(n=>typeof n!=="number"||!Number.isFinite(n)||n<0||n>9||!Number.isInteger(n*2)))die("四项分数缺失或无效",[file,where]);
  if(Math.round(scores.reduce((a,b)=>a+b,0)/4*2)/2!==row.predictedBand)die("总分不是四项等权舍入结果",[file,where]);
  return row;
}

function loadPolicyRows(policy, protocol) {
  const files = {};
  const bySample = new Map();
  const models = new Map();
  for (const split of ["development", "holdout"]) {
    const file = resolveResultFile(policy, split);
    const rows = extractRows(readJson(file), file);
    const expectedIds = split === "development" ? protocol.developmentSet : protocol.holdoutSet;
    const seen = new Map();
    for (const [index, raw] of rows.entries()) {
      const row = validateRow(raw, policy, split, file);
      if (seen.has(row.sampleId))
        die("同一 split 内 sampleId 重复", [file, `${row.sampleId}（第 ${seen.get(row.sampleId) + 1} 与第 ${index + 1} 行）`]);
      seen.set(row.sampleId, index);
      if (!expectedIds.has(row.sampleId))
        die("结果行不属于 protocol 中该 split 的样本集合", [file, `${split}/${row.sampleId}`]);
      if (bySample.has(row.sampleId))
        die("同一 policy 内 sampleId 在 development 与 holdout 之间重复", [policy, row.sampleId]);
      bySample.set(row.sampleId, {row, split});
      if (typeof row.model === "string" && row.model.trim())
        models.set(row.model.trim(), (models.get(row.model.trim()) ?? 0) + 1);
    }
    const missing = [...expectedIds].filter((id) => !seen.has(id));
    if (missing.length)
      die("split 缺少预定样本的成功行", [file, `缺失 ${missing.length} 篇：${missing.slice(0, 15).join(", ")}`]);
    if (rows.length !== expectedIds.size)
      die("split 行数与 protocol 预定数量不一致", [file, `实际 ${rows.length} / 预定 ${expectedIds.size}`]);
    files[split] = file;
  }
  if (bySample.size !== EXPECTED_TOTAL)
    die("policy 成功行总数不等于预定 97 篇", [policy, `实际 ${bySample.size}`]);
  return {policy, files, bySample, models: [...models.keys()].sort()};
}

/* ------------------------------------------------------------------ 统计 */

const r = (value, digits) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : digits===undefined?value:Number(value.toFixed(digits));

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const index = (sortedAsc.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (index - lo);
}

function latencyOf(rows) {
  const values = rows
    .map((row) => row.row.elapsedMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!values.length) return {n: 0, medianMs: null, p90Ms: null, meanMs: null, minMs: null, maxMs: null};
  return {
    n: values.length,
    medianMs: r(percentile(values, 0.5), 3),
    p90Ms: r(percentile(values, 0.9), 3),
    meanMs: r(values.reduce((a, b) => a + b, 0) / values.length, 3),
    minMs: r(values[0], 3),
    maxMs: r(values[values.length - 1], 3),
    rowsWithoutLatency: rows.length - values.length,
  };
}

function tokensOf(rows) {
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let rowsWithoutUsage = 0;
  for (const {row} of rows) {
    const usage = row.usage;
    if (!usage || typeof usage !== "object") {
      rowsWithoutUsage += 1;
      continue;
    }
    const pick = (...keys) => {
      for (const key of keys)
        if (typeof usage[key] === "number" && Number.isFinite(usage[key])) return usage[key];
      return null;
    };
    const prompt = pick("promptTokens", "inputTokens", "prompt_tokens", "input_tokens");
    const completion = pick("completionTokens", "outputTokens", "completion_tokens", "output_tokens");
    let total = pick("totalTokens", "total_tokens", "tokens", "total");
    if (total === null && (prompt !== null || completion !== null)) total = (prompt ?? 0) + (completion ?? 0);
    if (total === null) {
      const values = Object.values(usage).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (values.length) total = values.reduce((a, b) => a + b, 0);
    }
    if (total === null) {
      rowsWithoutUsage += 1;
      continue;
    }
    totalTokens += total;
    if (prompt !== null) promptTokens += prompt;
    if (completion !== null) completionTokens += completion;
  }
  return {totalTokens, promptTokens, completionTokens, rowsWithoutUsage};
}

function metricsOf(rows) {
  const n = rows.length;
  const base = {n, mae: null, rmse: null, bias: null, exact: null, withinHalf: null};
  if (!n) return {...base, latency: latencyOf(rows), tokens: tokensOf(rows)};
  let sumAbs = 0;
  let sumSq = 0;
  let sumDelta = 0;
  let exact = 0;
  let withinHalf = 0;
  for (const {row} of rows) {
    sumAbs += row.absError;
    sumSq += row.delta ** 2;
    sumDelta += row.delta;
    if (row.absError === 0) exact += 1;
    if (row.absError <= 0.5) withinHalf += 1;
  }
  return {
    ...base,
    mae: r(sumAbs / n),
    rmse: r(Math.sqrt(sumSq / n)),
    bias: r(sumDelta / n),
    exact: r(exact / n),
    withinHalf: r(withinHalf / n),
    latency: latencyOf(rows),
    tokens: tokensOf(rows),
  };
}

function groupMetrics(rows, keyOf) {
  const groups = new Map();
  for (const item of rows) {
    const key = keyOf(item.row);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const sorted = [...groups.keys()].sort(compareKeys);
  return Object.fromEntries(sorted.map((key) => [key, metricsOf(groups.get(key))]));
}

function compareKeys(a, b) {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

/* ------------------------------------------------------- 题目组 bootstrap */

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/**
 * 以 protocol.split.groups 中的题目组为抽样单位做有放回重采样；
 * 每次抽样取出的样本在两个 policy 上成对取值，保证配对比对。
 */
function clusterBootstrap(clusters, {iterations, seed}) {
  const random = mulberry32(seed);
  const values = new Array(iterations);
  for (let i = 0; i < iterations; i += 1) {
    const left = [];
    const right = [];
    for (let k = 0; k < clusters.length; k += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      for (let j = 0; j < cluster.left.length; j += 1) {
        left.push(cluster.left[j]);
        right.push(cluster.right[j]);
      }
    }
    values[i] = mean(left) - mean(right);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const positive = values.filter((v) => v > 0).length;
  return {
    iterations,
    seed,
    unit: "protocol.split.groups（题目组，每次抽样保持整组完整）",
    pairing: "同一抽样取出两个 policy 的配对误差后再计算 MAE 差值",
    statistic: "MAE(基线) − MAE(候选)",
    observed: null,
    ci95Low: r(percentile(sorted, 0.025)),
    ci95High: r(percentile(sorted, 0.975)),
    median: r(percentile(sorted, 0.5)),
    sharePositive: r(positive / iterations),
    clusterCount: clusters.length,
  };
}

/* -------------------------------------------------------------- 文本输出 */

function num(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return String(Number(value.toFixed(digits)));
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function mdCell(value) {
  return String(value ?? "-").replace(/\|/g, "\\|");
}

function mdTable(headers, rows) {
  const lines = [headers.map(mdCell).join(" | "), headers.map(() => "---").join(" | ")];
  for (const row of rows) lines.push(row.map(mdCell).join(" | "));
  return lines.join("\n");
}

/* ------------------------------------------------------------------ 主流程 */

function main() {
  if (!existsSync(DIR)) die("固定目录不存在", [DIR]);
  const protocol = loadProtocol();
  const lock = loadLock();

  const loaded = [];
  for (const policy of lock.policies) loaded.push(loadPolicyRows(policy, protocol));

  // 各 policy 之间：参考分 / task / examType 必须一致
  const gold = new Map();
  const meta = new Map();
  for (const entry of loaded) {
    for (const [sampleId, item] of entry.bySample) {
      const previous = gold.get(sampleId);
      if (previous === undefined) gold.set(sampleId, item.row.goldBand);
      else if (previous !== item.row.goldBand)
        die("同一 sampleId 在不同 policy 之间参考分不一致", [`${sampleId}：${previous} vs ${item.row.goldBand}`]);
      const previousMeta = meta.get(sampleId);
      const currentMeta = `${item.row.task}|${item.row.examType}`;
      if (previousMeta === undefined) meta.set(sampleId, currentMeta);
      else if (previousMeta.toLowerCase() !== currentMeta.toLowerCase())
        die("同一 sampleId 在不同 policy 之间 task/examType 不一致", [`${sampleId}：${previousMeta} vs ${currentMeta}`]);
    }
  }

  const splitOf = (sampleId) => (protocol.holdoutSet.has(sampleId) ? "holdout" : "development");
  const orderedIds = [...protocol.development, ...protocol.holdout];

  const criteriaKeys = new Map();
  for (const entry of loaded) criteriaKeys.set(entry.policy, resolveCriteriaKeys(entry));

  const samples = orderedIds.map((sampleId) => {
    const [task, examType] = meta.get(sampleId).split("|");
    const sample = {
      sampleId,
      split: splitOf(sampleId),
      task,
      examType,
      referenceBand: gold.get(sampleId),
      values: new Map(),
    };
    for (const entry of loaded) {
      const item = entry.bySample.get(sampleId);
      if (!item) die("policy 缺少该样本的成功行", [entry.policy, sampleId]);
      if (item.split !== sample.split)
        die("结果行的 split 归属与 protocol 不一致", [entry.policy, sampleId, `文件=${item.split} protocol=${sample.split}`]);
      const keys = criteriaKeys.get(entry.policy);
      sample.values.set(entry.policy, {
        predictedBand: item.row.predictedBand,
        error: item.row.absError,
        signedError: item.row.delta,
        criteria: keys.map((key) => criteriaValue(item.row, key)),
        criteriaKeys: keys,
      });
    }
    return sample;
  });

  /* ------------------------------------------------------------ 统计汇总 */

  const results = {};
  for (const entry of loaded) {
    const items = orderedIds.map((id) => entry.bySample.get(id));
    const bySplitKey = {
      development: items.filter((item) => item.split === "development"),
      holdout: items.filter((item) => item.split === "holdout"),
      all: items,
    };
    results[entry.policy] = {
      model: entry.models,
      files: Object.fromEntries(Object.entries(entry.files).map(([k, v]) => [k, v.slice(DIR.length + 1)])),
      splits: Object.fromEntries(Object.entries(bySplitKey).map(([key, rows]) => [key, metricsOf(rows)])),
      byTask: groupMetrics(items, (row) => row.task),
      byModule: groupMetrics(items, (row) => `${row.task}-${row.examType}`),
      byReferenceBand: groupMetrics(items, (row) => String(row.goldBand)),
      holdoutByModule: groupMetrics(bySplitKey.holdout, (row) => `${row.task}-${row.examType}`),
      holdoutByReferenceBand: groupMetrics(bySplitKey.holdout, (row) => String(row.goldBand)),
    };
  }

  /* ------------------------------------------- 保留组配对比较 + bootstrap */

  const holdoutIds = protocol.holdout;
  const clusters = protocol.groups
    .map((group) => ({id: group.id, ids: group.sampleIds.filter((id) => protocol.holdoutSet.has(id))}))
    .filter((cluster) => cluster.ids.length > 0);

  const pairwise = [];
  for (const baseline of lock.comparisonPolicies) {
    const candidateErrors = holdoutIds.map((id) => loaded.find((e) => e.policy === lock.candidatePolicy).bySample.get(id).row.absError);
    const baselineErrors = holdoutIds.map((id) => loaded.find((e) => e.policy === baseline).bySample.get(id).row.absError);
    let improved = 0;
    let tied = 0;
    let worsened = 0;
    let sumDiff = 0;
    for (let i = 0; i < holdoutIds.length; i += 1) {
      const diff = baselineErrors[i] - candidateErrors[i];
      sumDiff += diff;
      if (diff > EPS) improved += 1;
      else if (diff < -EPS) worsened += 1;
      else tied += 1;
    }
    const baselineMae = mean(baselineErrors);
    const candidateMae = mean(candidateErrors);
    const bootstrap = clusterBootstrap(
      clusters.map((cluster) => ({
        id: cluster.id,
        left: cluster.ids.map((id) => loaded.find((e) => e.policy === baseline).bySample.get(id).row.absError),
        right: cluster.ids.map((id) => loaded.find((e) => e.policy === lock.candidatePolicy).bySample.get(id).row.absError),
      })),
      {iterations: BOOTSTRAP_ITERATIONS, seed: BOOTSTRAP_SEED},
    );
    bootstrap.observed = r(baselineMae - candidateMae);
    pairwise.push({
      baseline,
      candidate: lock.candidatePolicy,
      split: "holdout",
      n: holdoutIds.length,
      baselineMae: r(baselineMae),
      candidateMae: r(candidateMae),
      maeImprovement: r(baselineMae - candidateMae),
      relativeMaeImprovement: baselineMae ? r((baselineMae - candidateMae) / baselineMae) : null,
      meanPairedErrorReduction: r(sumDiff / holdoutIds.length),
      improved,
      tied,
      worsened,
      bootstrap,
    });
  }

  /* ------------------------------------------------------------------ CSV */

  const csvHeader = [
    "sampleId",
    "split",
    "task",
    "examType",
    "referenceBand",
    ...lock.policies.flatMap((policy) => [
      `${policy}.predictedBand`,
      `${policy}.error`,
      `${policy}.signedError`,
      ...criteriaKeys.get(policy).map((key) => `${policy}.${key}`),
    ]),
  ];
  const csvRows = samples.map((sample) => {
    const cells = [sample.sampleId, sample.split, sample.task, sample.examType, num(sample.referenceBand)];
    for (const policy of lock.policies) {
      const value = sample.values.get(policy);
      cells.push(num(value.predictedBand), num(value.error), num(value.signedError));
      for (const score of value.criteria) cells.push(num(score));
    }
    return cells;
  });
  const csv = `\uFEFF${[csvHeader, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

  /* ----------------------------------------------------------------- JSON */

  const summary = {
    meta: {
      generatedAt: new Date().toISOString(),
      directory: DIR,
      note:
        "机械性结果整理：仅按 protocol.json / candidate-lock.json 与结果文件汇总，不做评分判断、不做上线决策、不据此选择候选、不输出作文全文。",
    },
    inputs: {
      protocol: protocol.file.slice(DIR.length + 1),
      lock: lock.file.slice(DIR.length + 1),
      resultFiles: Object.fromEntries(loaded.map((entry) => [entry.policy, entry.files])),
    },
    protocol: {
      totalCount: protocol.expected.size,
      developmentCount: protocol.developmentSet.size,
      holdoutCount: protocol.holdoutSet.size,
      groupCount: protocol.groups.length,
      holdoutGroupCount: clusters.length,
      strata: protocol.strata,
      seed: protocol.seed,
    },
    policies: {
      candidatePolicy: lock.candidatePolicy,
      comparisonPolicies: lock.comparisonPolicies,
      selected: lock.policies,
      models: Object.fromEntries(loaded.map((entry) => [entry.policy, entry.models])),
      criteriaKeys: Object.fromEntries([...criteriaKeys].map(([k, v]) => [k, v])),
    },
    validation: {
      expectedTotalSampleCount: EXPECTED_TOTAL,
      checkedPolicies: lock.policies,
      rowsPerPolicy: Object.fromEntries(loaded.map((entry) => [entry.policy, entry.bySample.size])),
      rules: [
        "每个 policy 的 development / holdout 必须覆盖 protocol 中该 split 的全部样本，且全部为 status=ok 的成功行",
        "sampleId 在每个 policy 内唯一，不允许重复或遗漏",
        "分组归属必须与 protocol.split 一致，题目组划分与 protocol.split.groups 一致",
        "各 policy 之间同一 sampleId 的参考分、task、examType 必须一致",
        "predictedBand − referenceBand = signedError，absError = |signedError|（容差 1e-6）",
        "任何失败行或缺失行都会终止脚本，不做静默丢弃",
      ],
    },
    metricDefinitions: {
      n: "成功样本数",
      mae: "平均绝对误差 = mean(|predictedBand − referenceBand|)",
      rmse: "均方根误差 = sqrt(mean((predictedBand − referenceBand)^2))",
      bias: "带符号误差均值 = mean(predictedBand − referenceBand)，正值表示整体偏高",
      exact: "误差为 0 的样本比例",
      withinHalf: "误差不超过 0.5 分的样本比例",
    },
    results,
    pairwise,
    limitations: LIMITATIONS,
  };

  /* ------------------------------------------------------------------- MD */

  const md = buildReport({protocol, lock, loaded, results, pairwise, samples, criteriaKeys, clusters});

  writeFileSync(OUT_CSV, csv, "utf8");
  writeFileSync(OUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(OUT_MD, md, "utf8");

  reportToConsole({protocol, lock, loaded, results, pairwise, out: [OUT_CSV, OUT_JSON, OUT_MD]});
}

function resolveCriteriaKeys(entry) {
  const available = new Set();
  for (const {row} of entry.bySample.values()) {
    for (const key of Object.keys(row.predictedCriteria ?? {})) available.add(key);
    for (const key of Object.keys(row.assessment ?? {})) available.add(key);
  }
  const lower = new Map([...available].map((key) => [key.toLowerCase(), key]));
  const resolved = CRITERIA_ALIASES.map((aliases) => {
    for (const alias of aliases) {
      const hit = lower.get(alias.toLowerCase());
      if (hit) return hit;
    }
    return null;
  });
  if (resolved.every((value) => value === null)) return [...available].sort().slice(0, 4);
  return resolved.map((value, index) => value ?? CRITERIA_LABELS[index]);
}

function criteriaValue(row, key) {
  if (!key) return null;
  const criteria = row.predictedCriteria;
  if (criteria && typeof criteria[key] === "number" && Number.isFinite(criteria[key])) return criteria[key];
  const assessment = row.assessment;
  if (assessment && assessment[key] && typeof assessment[key].score === "number" && Number.isFinite(assessment[key].score))
    return assessment[key].score;
  return null;
}

/* ---------------------------------------------------------------- 报告文本 */

const LIMITATIONS = [
  "参考标签为第三方转录结果，尚未逐篇与官方原件核对，不能视为官方确认分数。",
  "参考标签只有单篇整体分，不是四项分的人工金标准；四项分来自模型输出，本报告不对其做人工评分层面的验证。",
  "样本为公开文本，可能在模型预训练阶段被见过，存在数据污染的可能。",
  "本实验运行在评分卡模式（单次结构化打分）下，不是完整报告生成链路的端到端验证。",
  "参考分不是全新官方盲测，结果不应外推为真实考试表现。",
  "本报告为机械性整理，不包含上线判断、不修改模型、不据此选择候选、不输出作文全文。",
];

function buildReport({protocol, lock, loaded, results, pairwise, samples, criteriaKeys, clusters}) {
  const lines = [];
  const push = (...items) => lines.push(...items, "");

  const modelOf = (policy) => {
    const models = loaded.find((entry) => entry.policy === policy)?.models ?? [];
    return models.length ? models.join(" / ") : "（结果文件未提供 model 字段）";
  };

  push("# 评分卡实验机械性结果整理报告");
  push(
    "- 固定目录：`storage/scoring-evaluation-20261028`",
    `- 候选 policy（candidatePolicy）：\`${lock.candidatePolicy}\``,
    `- 基线 policy（comparisonPolicies）：${lock.comparisonPolicies.map((p) => `\`${p}\``).join("、")}`,
    `- 样本规模：全体 ${protocol.expected.size} 篇 = 开发组 ${protocol.developmentSet.size} 篇 + 保留组 ${protocol.holdoutSet.size} 篇；题目组 ${protocol.groups.length} 组（其中含保留样本的 ${clusters.length} 组）`,
    `- 生成时间：${new Date().toISOString()}`,
  );

  push("## 1. 方法");
  push(
    "1. 数据来源：仅从固定本地目录读取 `protocol.json`、`candidate-lock.json`，以及每个选定 policy 的 `<policy>-development.json` / `<policy>-holdout.json`。冻结前的协议修订与传输/解析修复见同目录 protocol-amendments.json；早期无参考开发组已归档，并在冻结候选后按最终共用评分提示重新运行，未据此更换候选。",
    "2. 锁定校验：`candidate-lock.json` 缺失时脚本直接终止，不产出任何报告；锁定文件需给出 `candidatePolicy` 与 `comparisonPolicies`（字符串数组，须含 `baseline` 与 `anchored-baseline`）。",
    `3. 样本与划分：划分与题目组完全取自 \`protocol.split\`，本文所有计数以 protocol 实际数量为准（当前为开发组 ${protocol.developmentSet.size} 篇、保留组 ${protocol.holdoutSet.size} 篇，合计 ${protocol.expected.size} 篇；预定 97 篇）。题目组为按题目/范文文本聚类得到的组，重采样时整组保持完整。`,
    `4. 完整性校验（任一不满足即终止，不静默丢弃）：每个 policy 的每个 split 必须覆盖 protocol 中该 split 的全部样本且全部为 \`status=ok\` 的成功行；\`sampleId\` 在每个 policy 内唯一；行归属必须与 protocol 的 development/holdout 一致；各 policy 之间同一 \`sampleId\` 的参考分、task、examType 必须一致；\`predictedBand − referenceBand = signedError\` 且 \`absError = |signedError|\`（容差 ${EPS}）。`,
    "5. 指标：n、MAE（平均绝对误差）、RMSE（均方根误差）、bias（带符号误差均值，正值表示整体偏高）、误差为 0 的比例、误差不超过 0.5 分比例；统计使用全精度数值，仅在展示时四舍五入（MAE/RMSE/bias 展示 3 位小数，比例展示 1 位小数）。",
    "6. 配对比较：候选与每个基线在保留组上逐篇配对，给出 MAE 改进（基线 MAE − 候选 MAE）、相对改进、逐篇误差改善/持平/恶化计数。",
    `7. 题目组重采样 bootstrap：以 \`protocol.split.groups\` 中的题目组为抽样单位，有放回抽取与保留组题目组数相同的 ${clusters.length} 组，重复 ${BOOTSTRAP_ITERATIONS.toLocaleString("en-US")} 次，固定随机种子 ${BOOTSTRAP_SEED}；每次抽样取出整组样本后，同时在两个 policy 上取配对误差，计算 MAE(基线) − MAE(候选)，取 2.5% / 97.5% 分位作为 95% 百分位区间。`,
    "8. 开发组定位：开发组结果仅用于诊断与描述，本报告不把开发组当作独立验收依据，所有基线比较与区间估计均基于保留组。",
    "9. 模型名称来自结果文件中的 `model` 字段，未在报告中另行指定。",
  );

  push("## 2. 限制（与结果同时阅读）");
  push(...LIMITATIONS.map((item) => `- ${item}`));

  push("## 3. 总览（全体 97 篇）");
  push(overviewTable(results, lock.policies, "all", modelOf));

  push(`## 4. 保留组（holdout，${protocol.holdoutSet.size} 篇）`);
  push(overviewTable(results, lock.policies, "holdout", modelOf));
  push(
    "> 保留组是用于与基线比较和区间估计的独立验收集合；下表 MAE 改进为正表示候选误差更小。",
  );

  push(`## 5. 开发组（development，${protocol.developmentSet.size} 篇，仅供诊断）`);
  push(overviewTable(results, lock.policies, "development", modelOf));
  push("> 开发组用于观察与诊断，不作为独立验收依据，不据此下结论。");

  push("## 6. 题型 × 模块（task-examType）");
  push(breakdownTable(results, lock.policies, "byModule", (key) => key));
  push("### 保留组的题型与模块");
  push(breakdownTable(results, lock.policies, "holdoutByModule", (key) => key));

  push("## 7. 参考分数分组");
  push(breakdownTable(results, lock.policies, "byReferenceBand", (key) => `${key} 分`));
  push("### 保留组的参考分数分组");
  push(breakdownTable(results, lock.policies, "holdoutByReferenceBand", (key) => `${key} 分`));

  push(`## 8. 逐篇比较（共 ${samples.length} 篇）`);
  push(perSampleTable(samples, lock.policies, criteriaKeys));

  push("## 9. 误差最大的 10 例（按候选 policy 的绝对误差排序）");
  push(topErrorTable(samples, lock.policies));
  push(
    "> 仅列出样本标识与数值，不包含作文原文；含开发组样本的行只作诊断用途。",
  );

  push("## 10. 与两个基线的配对比较（保留组）");
  push(pairwiseTable(pairwise, modelOf));
  push(bootstrapTable(pairwise));
  push(
    "> 区间为题目组重采样的 95% 百分位区间；区间跨越 0 表示在该样本量与题目组数量下无法区分两者。",
    "> 本脚本只做机械整理，不对是否上线、是否替换模型、采用哪个候选作出任何判断。",
  );

  return lines.join("\n");
}

function overviewTable(results, policies, splitKey, modelOf) {
  const headers = [
    "policy",
    "模型（来自输入文件）",
    "n",
    "MAE",
    "RMSE",
    "bias",
    "误差为 0 比例",
    "误差不超过 0.5 分比例",
    "时延中位 (ms)",
    "时延 P90 (ms)",
    "token 总量",
  ];
  const rows = policies.map((policy) => {
    const metric = results[policy].splits[splitKey];
    return [
      policy,
      modelOf(policy),
      metric.n,
      num(metric.mae, 3),
      num(metric.rmse, 3),
      num(metric.bias, 3),
      pct(metric.exact),
      pct(metric.withinHalf),
      num(metric.latency.medianMs, 1),
      num(metric.latency.p90Ms, 1),
      metric.tokens.totalTokens,
    ];
  });
  return mdTable(headers, rows);
}

function breakdownTable(results, policies, field, labelOf) {
  const keys = [...new Set(policies.flatMap((policy) => Object.keys(results[policy][field])))].sort(compareKeys);
  const headers = ["policy", "分组", "n", "MAE", "RMSE", "bias", "误差为 0 比例", "误差不超过 0.5 分比例"];
  const rows = [];
  for (const policy of policies) {
    for (const key of keys) {
      const metric = results[policy][field][key];
      if (!metric) continue;
      rows.push([
        policy,
        labelOf(key),
        metric.n,
        num(metric.mae, 3),
        num(metric.rmse, 3),
        num(metric.bias, 3),
        pct(metric.exact),
        pct(metric.withinHalf),
      ]);
    }
  }
  return mdTable(headers, rows);
}

function perSampleTable(samples, policies, criteriaKeys) {
  const headers = [
    "#",
    "sampleId",
    "split",
    "task",
    "examType",
    "referenceBand",
    ...policies.flatMap((policy) => [`${policy} predictedBand`, `${policy} error`, `${policy} signedError`]),
  ];
  const rows = samples.map((sample, index) => {
    const cells = [
      index + 1,
      sample.sampleId,
      SPLIT_LABEL[sample.split] ?? sample.split,
      sample.task,
      sample.examType,
      num(sample.referenceBand),
    ];
    for (const policy of policies) {
      const value = sample.values.get(policy);
      cells.push(num(value.predictedBand), num(value.error), num(value.signedError));
    }
    return cells;
  });
  return mdTable(headers, rows);
}

function topErrorTable(samples, policies) {
  const candidate = policies[0];
  const ranked = [...samples].sort((a, b) => {
    const diff = b.values.get(candidate).error - a.values.get(candidate).error;
    if (Math.abs(diff) > EPS) return diff;
    return a.sampleId.localeCompare(b.sampleId);
  });
  const headers = ["#", "sampleId", "split", "task", "examType", "referenceBand", ...policies.flatMap((policy) => [`${policy} predictedBand`, `${policy} error`])];
  const rows = ranked.slice(0, 10).map((sample, index) => {
    const cells = [
      index + 1,
      sample.sampleId,
      SPLIT_LABEL[sample.split] ?? sample.split,
      sample.task,
      sample.examType,
      num(sample.referenceBand),
    ];
    for (const policy of policies) {
      const value = sample.values.get(policy);
      cells.push(num(value.predictedBand), num(value.error));
    }
    return cells;
  });
  return mdTable(headers, rows);
}

function pairwiseTable(pairwise, modelOf) {
  const headers = [
    "基线",
    "候选",
    "split",
    "n",
    "基线 MAE",
    "候选 MAE",
    "MAE 改进",
    "相对 MAE 改进",
    "逐篇误差改善",
    "逐篇误差持平",
    "逐篇误差恶化",
  ];
  const rows = pairwise.map((item) => [
    `${item.baseline}（${modelOf(item.baseline)}）`,
    `${item.candidate}（${modelOf(item.candidate)}）`,
    SPLIT_LABEL[item.split] ?? item.split,
    item.n,
    num(item.baselineMae, 3),
    num(item.candidateMae, 3),
    num(item.maeImprovement, 3),
    pct(item.relativeMaeImprovement),
    item.improved,
    item.tied,
    item.worsened,
  ]);
  return mdTable(headers, rows);
}

function bootstrapTable(pairwise) {
  const headers = [
    "基线 vs 候选",
    "统计量",
    "观测值",
    "95% 百分位区间下界",
    "95% 百分位区间上界",
    "bootstrap 中位数",
    "区间为正的抽样占比",
    "重采样次数",
    "随机种子",
    "保留组题目组数",
  ];
  const rows = pairwise.map((item) => [
    `${item.baseline} → ${item.candidate}`,
    item.bootstrap.statistic,
    num(item.bootstrap.observed, 3),
    num(item.bootstrap.ci95Low, 3),
    num(item.bootstrap.ci95High, 3),
    num(item.bootstrap.median, 3),
    pct(item.bootstrap.sharePositive),
    item.bootstrap.iterations,
    item.bootstrap.seed,
    item.bootstrap.clusterCount,
  ]);
  return mdTable(headers, rows);
}

function reportToConsole({protocol, lock, loaded, results, pairwise, out}) {
  console.log("[report-scoring-evaluation] 已生成文件：");
  for (const file of out) console.log(`  - ${file}`);
  console.log("");
  console.log(
    `样本：全体 ${protocol.expected.size} 篇（开发组 ${protocol.developmentSet.size} / 保留组 ${protocol.holdoutSet.size}），题目组 ${protocol.groups.length} 组`,
  );
  console.log(`候选 policy：${lock.candidatePolicy}`);
  for (const policy of lock.policies) {
    const models = loaded.find((entry) => entry.policy === policy)?.models ?? [];
    const all = results[policy].splits.all;
    const holdout = results[policy].splits.holdout;
    console.log(
      `  ${policy} [${models.join(" / ") || "model 未提供"}] 全体 MAE=${num(all.mae, 3)} RMSE=${num(all.rmse, 3)} bias=${num(all.bias, 3)} 误差不超过0.5分比例=${pct(all.withinHalf)} | 保留组 MAE=${num(holdout.mae, 3)}`,
    );
  }
  for (const item of pairwise) {
    console.log(
      `  保留组配对：${item.candidate} vs ${item.baseline} → MAE 改进 ${num(item.maeImprovement, 3)}（改善 ${item.improved} / 持平 ${item.tied} / 恶化 ${item.worsened}），95% 百分位区间 [${num(item.bootstrap.ci95Low, 3)}, ${num(item.bootstrap.ci95High, 3)}]（${item.bootstrap.iterations} 次，seed=${item.bootstrap.seed}）`,
    );
  }
  console.log("");
  console.log("提示：本报告为机械性整理，参考标签为第三方转录，开发组不作独立验收，结果不含上线判断。");
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
}
