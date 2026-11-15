import type { MethodRule, Question } from "./types";

export const methodProvider = (rule: MethodRule) =>
  rule.source?.provider || "simon";

export function methodAppliesTo(rule: MethodRule, q: Question): boolean {
  if (q.task === "Task 1" && q.examType === "G") return false;
  if (rule.task !== "all" && rule.task !== q.task) return false;
  const scope = rule.scope ||
    (rule.id === "map" ? "map" : rule.id === "process" ? "process" : undefined);
  if (!scope) return true;
  if (q.task !== "Task 1" || q.examType !== "A") return false;
  if (scope === "map") return q.category === "地图";
  if (scope === "process") return q.category === "流程图";
  return ["曲线图", "折线图", "柱状图", "饼状图", "饼图", "表格", "混合图"].includes(q.category);
}

export function methodSourceLabel(rule: MethodRule): string {
  const source = rule.source;
  if (!source) return "写作方法转述";
  const course = methodProvider(rule) === "tian-nan";
  const title = source.title || (course ? "新东方课堂笔记" : "《跟雅思考官 Simon 学写作》");
  const pages = source.pages?.length ? source.pages : [source.page];
  return `${title}${source.file ? ` · ${source.file}` : ""} · ${course ? "PDF 第" : "扫描第"}${pages.join("、")}页 · ${source.section}`;
}

export const methodCriterionLabels = {
  taskResponse: "任务回应 / 完成",
  coherence: "连贯与衔接",
  lexical: "词汇",
  grammar: "语法",
};
