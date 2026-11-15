import { test } from "node:test";
import assert from "node:assert/strict";
import { assessEssay, normalizeFeedback } from "../src/lib/reviewer";
import { questions, referencesFor } from "../src/lib/content";
import { scoringSamples, selectScoringSamples, scoringTaskFamily } from "../src/lib/scoring-samples";
import { advancedSuggestionsText } from "../src/lib/advanced-suggestions";
import { buildRevisions, revisionText } from "../src/lib/revisions";
import type { EssayInput } from "../src/lib/types";

const q = questions().find((q) => q.task === "Task 2" && q.examType === "A")!;
const original = "Students can make their knowledge wider by reading books.";
const input: EssayInput = { questionId: q.id, title: "Learning target must not be sent", targetBand: 7, essay: original };
const suggestions = [
  { kind: "vocabulary", original: "reading", replacement: "studying", explanation: "可选进阶；强调深入研读时可用，普通阅读仍保留reading。", example: "Studying a range of sources can deepen students' understanding." },
  { kind: "phrase", original: "make their knowledge wider", replacement: "broaden their knowledge", explanation: "broaden their knowledge 是更自然的搭配，保留拓宽知识面的原意。", example: "Students can broaden their knowledge by reading books." },
  { kind: "sentence", original, replacement: "By reading books, students can broaden their knowledge.", explanation: "用介词短语突出方法，逻辑与原句相同。", example: "By reading widely, students can develop a deeper understanding of a subject." },
];
const raw = {
  summary: "这篇短文需要更充分回应题目，并改进不自然的搭配。",
  criteria: Object.fromEntries(["taskResponse", "coherence", "lexical", "grammar"].map((key) => [key, {
    score: key === "grammar" ? 7 : 6,
    reason: "根据本项量表和原文评价。",
    evidence: original,
  }])),
  strengths: ["句子结构完整"],
  priorities: [{ title: "展开观点", reason: "缺少展开", action: "解释阅读如何帮助学习。" }],
  methodChecks: [],
  paragraphs: [{ index: 1, role: "主体", feedback: "需要展开", suggestion: "补充支持。" }],
  corrections: [{ original, replacement: "Students can broaden their knowledge by reading books.", kind: "naturalness", reason: "语法正确，但make their knowledge wider不符合常用搭配。" }],
  correctionChecks: [{ original, necessary: true, basis: "usage", explanation: "make knowledge wider搭配不自然。" }],
  improvedEssay: "Students can broaden their knowledge by reading books and comparing different perspectives.",
  advancedSuggestions: suggestions,
  exercises: [{ title: "搭配练习", instruction: "用broaden their knowledge造句。" }],
};

test("sample inventory preserves absent numeric and criterion labels", { skip: scoringSamples.length ? false : "Private historical calibration corpus is not distributed." }, () => {
  assert.equal(scoringSamples.length, 111);
  assert.equal(new Set(scoringSamples.map((s) => s.id)).size, 111);
  assert.equal(scoringSamples.filter((s) => s.band !== null).length, 97);
  assert.equal(scoringSamples.filter((s) => s.band === null && s.isUnscoredModelAnswer).length, 14);
  for (const s of scoringSamples) {
    assert.ok(s.question && s.essay && s.comment && s.sourceUrl);
    assert.equal(s.provenance, "third_party_reproduction_not_yet_independently_matched");
    assert.equal("criterionScores" in s, false);
  }
});

test("retrieval isolates task, module and chart family and excludes score leakage", { skip: scoringSamples.length ? false : "Private historical calibration corpus is not distributed." }, () => {
  for (const s of scoringSamples) {
    const question = { ...q, task: s.task, examType: s.examType, category: "", stem: s.question };
    const anchors = selectScoringSamples(question, s.essay);
    assert.ok(anchors.length <= 4);
    assert.equal(new Set(anchors.map((a) => a.id)).size, anchors.length);
    for (const a of anchors) {
      assert.equal(a.task, s.task);
      assert.equal(a.examType, s.examType);
      assert.notEqual(a.band, null);
      assert.equal(a.isUnscoredModelAnswer, false);
      assert.notEqual(a.id, s.id);
      if (s.task === "Task 1") assert.equal(scoringTaskFamily({ ...question, stem: a.question }), scoringTaskFamily(question));
    }
  }
  const sample = scoringSamples.find((s) => s.task === "Task 2" && s.examType === "A" && s.band !== null)!;
  const nearCopy = sample.essay.replace(/\bthe\b/, "this");
  assert.ok(!selectScoringSamples(q, nearCopy).some((s) => s.id === sample.id));
  const anchors = selectScoringSamples(q, original);
  assert.equal(anchors.length, 4);
  assert.ok(anchors.some((s) => s.band! <= 5));
  assert.ok(anchors.some((s) => s.band! > 7));
  assert.equal(scoringTaskFamily({ ...q, category: "", stem: "Is this a positive or negative development? Give reasons for your answer." }), "two-part");
});

test("naturalness remains separate from grammar and advanced suggestions are grounded and exported", () => {
  const report = normalizeFeedback({ ...raw, advancedSuggestions: [
    ...suggestions, suggestions[0],
    { ...suggestions[0], original: "This quote is not in the submitted essay." },
    { ...suggestions[0], replacement: suggestions[0].original },
  ] }, input, q, false);
  assert.equal(report.corrections[0].kind, "naturalness");
  assert.equal(report.criteria.grammar.score, 7, "表达不自然不能在归一化时自动扣语法分");
  assert.equal(report.advancedSuggestions?.length, 3);
  const text = revisionText(buildRevisions(original, report.corrections));
  assert.match(text, /表达习惯（非语法错误）/);
  const advanced = advancedSuggestionsText(report.advancedSuggestions);
  for (const label of ["词汇进阶", "短语与搭配", "句式进阶", "原表达", "建议表达", "用法", "例句"]) assert.ok(advanced.includes(label));
  assert.equal(advancedSuggestionsText(), "", "兼容缺少进阶建议的旧报告");
  const legacy = { ...raw, advancedSuggestions: undefined };
  assert.deepEqual(normalizeFeedback(legacy, input, q, false).advancedSuggestions, []);
  const ruleId=referencesFor(q,false).rules[0].id;
  const tooMany=Array.from({length:15},()=>({ruleId,status:"met",evidence:original,advice:"可选教学核对。"}));
  const bounded=normalizeFeedback({...raw,methodChecks:[{...tooMany[0],ruleId:"invented-rule"},...tooMany]},input,q,false);
  assert.equal(bounded.methodChecks.length,8);
  assert.ok(bounded.methodChecks.every(c=>c.ruleId===ruleId));
  assert.equal(bounded.overallBand,report.overallBand);
});

test("an expression explicitly accepted by the explanation is not shown as a naturalness error", () => {
  const acceptable = "Practical subjects create further difficulties for a fully online system.";
  const report = normalizeFeedback({ ...raw, corrections: [
    ...raw.corrections,
    { original: acceptable, replacement: "Practical subjects pose further challenges for a fully online system.", kind: "naturalness", reason: "语法正确，create difficulties 本身可接受，但另一种表达更常见。" },
    { original: acceptable, replacement: "Practical subjects pose challenges for a fully online system.", kind: "clarity", reason: "这只是可选润色，原来的表达清楚。" },
    { original: acceptable, replacement: "Practical subjects present further difficulties for a fully online system.", kind: "naturalness", reason: "语法正确，但搭配稍弱，替换后更直接自然。" },
  ] }, { ...input, essay: original + " " + acceptable }, q, false);
  assert.equal(report.corrections.length, 1);
  assert.equal(report.corrections[0].original, original);
  assert.equal(report.criteria.grammar.score, 7);
});

test("provider receives official rubric and scored anchors without learning target or model-invented references", async () => {
  const sent: { system: string; data: Record<string, unknown>; thinking:string;maxTokens:number }[] = [];
  const mock = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ system: body.messages[0].content, data: JSON.parse(body.messages[1].content[0].text),thinking:body.thinking.type,maxTokens:body.max_tokens });
    const criteria=body.thinking.type==="enabled"?raw.criteria:Object.fromEntries(Object.entries(raw.criteria).map(([k,v])=>[k,{...v,score:1,reason:"报告生成步骤不能覆盖独立评分"}]));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...raw, criteria, limitations: {taskResponse:[],coherence:[],lexical:[],grammar:[]}, calibration: { references: [{ id: "made-up" }] } }) } }] });
  }) as typeof fetch;
  const assets = { fetch: async () => new Response("", { status: 404 }) };
  const env = { DEEPSEEK_API_KEY: "test-key" };
  const result = await assessEssay({ ...input, targetBand: 4 }, q, env, assets, mock);
  await assessEssay({ ...input, targetBand: 9 }, q, env, assets, mock);
  assert.equal(sent.length,4);
  assert.deepEqual(sent[0], sent[2], "学习目标不能改变独立评分的材料或参考样本");
  assert.deepEqual(sent[1], sent[3], "学习目标不能改变教学反馈的材料");
  assert.equal(sent[0].thinking,"enabled");
  assert.equal(sent[0].maxTokens,24000);
  assert.equal(sent[1].thinking,"disabled");
  assert.equal("methods" in sent[0].data,false,"评分步骤只看量表、原文、题图及带分参考");
  assert.deepEqual(result.criteria,raw.criteria,"改稿步骤不得覆盖已验证评分卡");
  assert.equal(result.overallBand,6);
  assert.equal("targetBand" in sent[0].data, false);
  assert.ok(!JSON.stringify(sent).includes(input.title));
  assert.match(sent[1].system, /语法正确，但/);
  assert.match(sent[1].system, /advancedSuggestions/);
  assert.match(sent[1].system,/同一国家\/系列、同一年份和纵轴刻度/);
  const rubric = sent[0].data.scoringRubric as { version: string };
  assert.equal(rubric.version, "2023-05");
  const anchors = sent[1].data.calibrationSamples as { id: string; overallTaskBand: number; criterionScores: null }[];
  if (scoringSamples.length) assert.equal(anchors.length, 4);
  else assert.deepEqual(anchors, [], "No private samples must mean no invented scoring anchors");
  assert.ok(anchors.every((s) => typeof s.overallTaskBand === "number" && s.criterionScores === null));
  assert.deepEqual(result.calibration?.references.map((s) => s.id), anchors.map((s) => s.id));
  assert.equal(result.calibration?.availableScoredSamples, scoringSamples.filter((s) => s.band !== null && !s.isUnscoredModelAnswer).length);
  assert.ok(!JSON.stringify(result.calibration).includes("made-up"));
  assert.equal(result.calibration?.assessmentMode,"independent_scorecard_then_feedback");
});

test("failed independent scorecard stops the report; missing chart keeps language-only feedback",async()=>{
  let calls=0;
  const env={DEEPSEEK_API_KEY:"test-key"},assets={fetch:async()=>new Response("",{status:404})};
  const invalid=(async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:"{}"}}]});}) as typeof fetch;
  await assert.rejects(()=>assessEssay(input,q,env,assets,invalid),/独立评分结果不完整/);
  assert.equal(calls,1,"不能在独立评分失败后另取改稿分数充当成功结果");
  calls=0;
  const languageOnly=(async(_url:unknown,init:RequestInit)=>{calls++;assert.equal(JSON.parse(String(init.body)).thinking.type,"disabled");return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(raw)}}]});}) as typeof fetch;
  const chart={...q,task:"Task 1" as const,examType:"A" as const,images:[]};
  const feedback=await assessEssay(input,chart,env,assets,languageOnly);
  assert.equal(calls,1);
  assert.equal(feedback.criteria.taskResponse.score,null);
  assert.equal(feedback.overallBand,null);
  assert.equal(feedback.calibration?.assessmentMode,"language_only");
});
