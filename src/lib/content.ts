import questionData from "../../data/questions.json";
import bookData from "../../data/book-chunks.json";
import courseData from "../../data/tian-nan-methods.json";
import { methodAppliesTo } from "./methods";
import { customQuestionDetails } from "./custom-question";
import type { EssayInput, MethodRule, Question } from "./types";
type Chunk = {
  id: string;
  section: string;
  subsection: string;
  page: number;
  startLine: number;
  endLine: number;
  text: string;
};
export function questions(): Question[] {
  return questionData as Question[];
}
export function academicQuestions(): Question[] {
  return questions().filter((q) => q.examType === "A");
}
export function chunks(): Chunk[] {
  return bookData as Chunk[];
}
const definitions: [
  string,
  string,
  string,
  string,
  MethodRule["task"],
  string,
][] = [
  [
    "answer",
    "先回答题目，再组织语言",
    "明确题目问了什么，让立场贯穿全文。",
    "开头直接回应所有问题。双边讨论应讨论两方并表达自己的观点；两问型需要分别回答。折中观点可以成立，关键是清晰且一致。",
    "Task 2",
    "千万不要等到总结段再去亮你的观点",
  ],
  [
    "structure",
    "四段组织，让每段各司其职",
    "简短开头、两个主体段、简短结尾。",
    "把四段作为练习的默认框架，不当作强制评分规则。主体段围绕各自中心思想展开；其他清晰有效的段落结构不应仅因段数不同被扣分。",
    "Task 2",
    "对于双边讨论题型很多雅思老师",
  ],
  [
    "develop",
    "把一个观点讲透",
    "观点之后，补上解释、展开或具体例子。",
    "检查读者能否理解为什么和如何发生。发展相关的少量观点，比堆砌很多没有解释的观点更有效。例子可以来自日常知识，不必虚构调查数据。",
    "Task 2",
    "第五句：写一个让步句",
  ],
  [
    "intro",
    "开头简短，尽早亮明答案",
    "改写主题，用自己的话给出直接回答。",
    "两句开头是节省时间的练习方法。避免冗长背景套句，将写作时间留给主体段。不是按句数机械扣分。",
    "Task 2",
    "一个好的开头段需要具备两个内容",
  ],
  [
    "conclusion",
    "结尾重申，不临时加新观点",
    "用简短结尾收束已经论证的立场。",
    "结尾回到题目的问题和主体段的结论。不要在结尾引入没有解释的新论点。",
    "Task 2",
    "总结段不要包含任何具体的信息",
  ],
  [
    "collocation",
    "选择贴合主题的自然表达",
    "准确的主题词伙，比生僻词堆砌更有用。",
    "先保证用词准确和搭配自然，再逐步增加表达变化。不为了复杂从句改变本意；语法准确性仍是独立的评价维度。",
    "all",
    "过分关注这些语法重点",
  ],
  [
    "overview",
    "概述先看整体",
    "找出主要趋势、显著差异或关键变化。",
    "A类小作文需要清楚的概述。可放在开头之后，也可放在结尾；不要求出现固定的 Overall 一词。概述侧重主要特点，详细数字留给细节段。",
    "Task 1",
    "你不需要在概述段提到具体的数字",
  ],
  [
    "data",
    "选择并比较关键数据",
    "两段细节要有具体依据，也要有比较。",
    "不把图表中的所有数据逐个抄写。挑选最高最低、起终点、明显变化等，按有意义的关系分组。检查数字、单位、对象和时间。",
    "Task 1",
    "描述／比较那些有特点",
  ],
  [
    "map",
    "地图对比，写清变化关系",
    "比较位置、用途与布局，配合正确时态。",
    "先分清静态选址和动态变迁，再按空间关系组织描述；选择准确方位词，明确新增、拆除和保留的设施。",
    "Task 1",
    "地图题一般分为静态选址题",
  ],
  [
    "process",
    "流程要有起终点和完整顺序",
    "概述整体过程，细节覆盖各个步骤。",
    "按实际先后顺序描述，不能遗漏关键环节；需要时使用被动语态，不为了炫技强行套用。",
    "Task 1",
    "一定要提到流程中的每一个步骤",
  ],
];
export function methods(): MethodRule[] {
  const simon: MethodRule[] = definitions.map(([id, title, summary, detail, task, needle]) => {
    const passage = chunks().find((c) => c.text.includes(needle));
    return {
      id,
      title,
      summary,
      detail,
      task,
      ...(id === "data" ? { scope: "chart" as const } : {}),
      ...(["overview", "data", "map", "process"].includes(id) ? { requiresVisual: true } : {}),
      source: passage
        ? { section: passage.section, page: passage.page, chunkId: passage.id, provider: "simon" }
        : null,
    };
  });
  return [...simon, ...(courseData as MethodRule[])];
}
export function resolveQuestion(input: EssayInput): Question {
  if (input.questionId !== null) {
    const q = questions().find((q) => q.id === input.questionId);
    if (!q) throw new Error("题目不存在，请重新选择。");
    return q;
  }
  if (!input.customQuestion) throw new Error("请填写自选题目。");
  return customQuestionDetails(input.customQuestion);
}
export function referencesFor(q: Question, hasVisual = true): {
  rules: MethodRule[];
  passages: Chunk[];
} {
  if (q.task === "Task 1" && q.examType === "G")
    return { rules: [], passages: [] };
  const rules = methods()
    .filter((r) => methodAppliesTo(r, q))
    .filter((r) => hasVisual || !r.requiresVisual);
  const ids = new Set(
    rules.flatMap((r) => (r.source ? [r.source.chunkId] : [])),
  );
  const terms = (q.stem.toLowerCase().match(/[a-z]{5,}/g) || []).filter(
    (t) =>
      ![
        "should",
        "people",
        "their",
        "would",
        "which",
        "about",
        "these",
        "other",
        "think",
        "there",
        "opinion",
        "discuss",
        "reasons",
        "answer",
        "words",
        "examples",
      ].includes(t),
  );
  const candidates = chunks().filter((c) =>
    q.task === "Task 2"
      ? c.section.startsWith("大作文")
      : c.section.startsWith("小作文"),
  );
  const ranked = candidates
    .map((c) => ({
      c,
      score: terms.reduce(
        (s, t) => s + (c.text.toLowerCase().includes(t) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score >= 3) ids.add(ranked[0].c.id);
  return {
    rules,
    passages: chunks()
      .filter((c) => ids.has(c.id))
      .map((c) => ({ ...c, text: c.text.slice(0, 1800) })),
  };
}
