import type { Question, WritingOutline } from "./types";

export function outlineGuide(q: Pick<Question, "task" | "examType" | "category">) {
  const letter = q.task === "Task 1" && q.examType === "G";
  const academic = q.task === "Task 1" && !letter;
  return {
    analysis: letter ? "收信人、写信目的与语气" : academic ? "对象、时间与单位" : "题目要回答哪些问题",
    analysisHint: letter ? "写给谁？有哪些要点？语气应正式还是亲切？" : academic ? "图中描述什么？有无时间变化？注意哪些单位或阶段？" : "圈出讨论对象、限定条件和任务要求，防止漏答。",
    position: letter ? "开头要说清什么" : academic ? "概述：最突出的整体特征" : "我的立场 / 核心回答",
    positionHint: letter ? "用一句话交代为什么写这封信。" : academic ? "概括主要趋势、差异或过程；先不堆细节数字。" : "直接回答题目；两问型分别写下答案。",
    paragraph: letter ? "要点段" : academic ? "细节段" : "主体段",
    point: academic ? "这组信息的共同点" : "本段中心",
    pointHint: letter ? "这一段回应题目的哪个要点？" : academic ? "按相似趋势、区域、功能或阶段分组。" : "用一句话写清这一段要证明什么。",
    support: letter ? "补充细节 / 具体请求" : academic ? "关键数据 / 比较 / 步骤" : "解释、例子或因果链",
    supportHint: letter ? "需要解释哪些背景？希望对方怎样处理？" : academic ? "只记题图中能核实的信息，并说明它们的关系。" : "为什么成立？如何发生？用什么具体例子说明？",
    ending: letter ? "结尾与期望回应" : academic ? "读图复查" : "结尾回到题目",
    endingHint: letter ? "写下希望得到的回应，并选合适的结束语。" : academic ? "核对是否漏掉主要特点、关键步骤或比较，数字与单位是否一致。" : "重申已经论证的答案，不临时添加新论点。",
    note: academic ? "按题图组织信息；地图与流程图也可按区域或阶段分组。" : letter ? "按题目要点组织，不必套用议论文的立场与论证。" : "段数可调整，先把少量相关观点讲透。",
  };
}

export const blankOutline = (): WritingOutline => ({
  analysis: "", position: "", ending: "",
  paragraphs: [
    { id: "body-1", point: "", support: "" },
    { id: "body-2", point: "", support: "" },
  ],
});

export function hasOutline(outline?: WritingOutline): boolean {
  return !!outline && !!(outline.analysis.trim() || outline.position.trim() || outline.ending.trim() ||
    outline.paragraphs.some((p) => p.point.trim() || p.support.trim()));
}

export function outlineText(outline: WritingOutline, q: Pick<Question, "task" | "examType" | "category">): string {
  const guide = outlineGuide(q);
  return [
    "莎试笔雅 · 写前提纲", "",
    guide.analysis, outline.analysis || "（未填写）", "",
    guide.position, outline.position || "（未填写）", "",
    ...outline.paragraphs.flatMap((p, i) => [
      `${guide.paragraph} ${i + 1}`, `${guide.point}：${p.point || "（未填写）"}`,
      `${guide.support}：${p.support || "（未填写）"}`, "",
    ]),
    guide.ending, outline.ending || "（未填写）",
  ].join("\n");
}
