import type { EssayInput, Question } from "./types";

export type CustomQuestion = NonNullable<EssayInput["customQuestion"]>;
export function customCategories(task: Question["task"], exam: Question["examType"]): string[] {
  if (task === "Task 2") return ["同意与否题", "双边讨论题", "利弊比较题", "报告类", "混合类"];
  return exam === "A"
    ? ["曲线图", "柱状图", "饼状图", "表格", "地图", "流程图", "混合图"]
    : ["书信", "投诉信", "建议信", "请求信", "通知信", "邀请信", "申请信", "感谢信", "道歉信"];
}
export function customQuestionDetails(value: CustomQuestion): Question {
  return {
    id: 0, name: "自传题目", stem: value.stem, task: value.task, examType: value.examType,
    category: value.category || (value.task === "Task 1" && value.examType === "G" ? "书信" : "自选"),
    topic: "", book: "", test: "", date: "", sourceType: "自传题目", sourceUrl: "", futureDate: false, images: [],
  };
}
export async function questionTextFile(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<string> {
  if (!/\.txt$/i.test(file.name)) throw new Error("请选择 TXT 题目文件；图片请在下方题图入口上传。");
  if (file.size > 24_000) throw new Error("题目文件最多支持 24KB，请只保留本次练习的题目。");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 24_000) throw new Error("题目文件最多支持 24KB。");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").trim(); }
  catch { throw new Error("无法读取此文本，请将 TXT 文件保存为 UTF-8 编码后重试。"); }
  if (text.includes("\0")) throw new Error("文件不是有效的题目文本，请选择 UTF-8 TXT 文件。");
  if (text.length < 15 || text.length > 6000) throw new Error("题目需要 15 至 6000 个字符，请保留完整的英文题干和写作要求。");
  return text;
}
