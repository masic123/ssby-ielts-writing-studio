import type { Question } from "./types";

export const bookOrder = [
  "剑21", "剑20", "剑19", "剑18", "剑17", "剑16", "剑15", "剑14",
  "剑13", "剑12", "剑11", "剑10", "剑9", "剑8", "剑7", "剑6", "剑5",
] as const;

export const academicTask1Categories = [
  "曲线图", "柱状图", "饼状图", "表格", "地图", "流程图", "混合图",
] as const;

export const generalTask1Categories = [
  "书信", "投诉信", "建议信", "请求信", "通知信", "邀请信", "申请信", "感谢信", "道歉信",
] as const;

export const task2Categories = [
  "同意与否题", "双边讨论题", "利弊比较题", "报告类", "混合类",
] as const;

export function orderedCategories(task: Question["task"], exam: Question["examType"] | "") {
  if (task === "Task 1") return exam === "G" ? generalTask1Categories : academicTask1Categories;
  return task2Categories;
}

function numberIn(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function dateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** New Oriental's order: book, test, then Task 1 before Task 2. Recall questions follow Cambridge books. */
export function sortQuestionsForSequence(questions: Question[]) {
  return [...questions].sort((a, b) => {
    const aBookIndex = a.book ? bookOrder.indexOf(a.book as (typeof bookOrder)[number]) : -1;
    const bBookIndex = b.book ? bookOrder.indexOf(b.book as (typeof bookOrder)[number]) : -1;
    const aBook = aBookIndex >= 0 ? aBookIndex : bookOrder.length;
    const bBook = bBookIndex >= 0 ? bBookIndex : bookOrder.length;
    if (aBook !== bBook) return aBook - bBook;
    if (!a.book && !b.book && dateValue(a.date) !== dateValue(b.date)) return dateValue(b.date) - dateValue(a.date);
    if (a.book !== b.book) return a.book ? -1 : 1;
    const test = numberIn(a.test) - numberIn(b.test);
    if (test) return test;
    if (a.task !== b.task) return a.task === "Task 1" ? -1 : 1;
    return b.id - a.id;
  });
}
