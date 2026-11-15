import { z } from "zod";
import { customCategories } from "./custom-question";
export const customQuestionSchema = z.object({
  stem: z.string().trim().min(15, "请填写完整的英文题目，至少 15 个字符。").max(6000, "题目最多支持 6000 个字符。"),
  task: z.enum(["Task 1", "Task 2"]),
  examType: z.enum(["A", "G"]),
  category: z.string().max(40).optional(),
  chartData: z.string().max(1_350_000).optional(),
}).superRefine((value, ctx) => {
  if (value.category && !customCategories(value.task, value.examType).includes(value.category))
    ctx.addIssue({ code: "custom", path: ["category"], message: "题型与考试类别不匹配，请重新选择。" });
});
const outlineSchema = z.object({
  analysis: z.string().max(2000),
  position: z.string().max(2000),
  paragraphs: z.array(z.object({
    id: z.string().min(1).max(100),
    point: z.string().max(2000),
    support: z.string().max(3000),
  })).max(8).refine((parts) => new Set(parts.map((p) => p.id)).size === parts.length, {
    message: "提纲段落编号重复，请重新添加该段。",
  }),
  ending: z.string().max(2000),
});
export const essaySchema = z
  .object({
    questionId: z.number().int().positive().nullable(),
    customQuestion: customQuestionSchema.optional(),
    essay: z.string().max(30000, "作文最多支持30000个字符。"),
    outline: outlineSchema.optional(),
    targetBand: z.number().min(4).max(9).multipleOf(0.5),
    title: z.string().trim().max(120),
  })
  .refine((v) => v.questionId !== null || !!v.customQuestion, {
    message: "请选择或填写题目。",
  });
const criterion = z.object({
  score: z.number().int().min(0).max(9).nullable(),
  reason: z.string().max(2000),
  evidence: z.string().max(1500),
});
export const feedbackSchema = z.object({
  summary: z.string().min(10).max(3000),
  criteria: z.object({
    taskResponse: criterion,
    coherence: criterion,
    lexical: criterion,
    grammar: criterion,
  }),
  strengths: z.array(z.string().max(1500)).max(6),
  priorities: z
    .array(
      z.object({
        title: z.string().max(200),
        reason: z.string().max(1500),
        action: z.string().max(1500),
      }),
    )
    .min(1)
    .max(5),
  methodChecks: z
    .array(
      z.object({
        ruleId: z.string(),
        status: z.enum(["met", "partial", "missing", "not_applicable"]),
        evidence: z.string().max(1500),
        advice: z.string().max(1500),
      }),
    )
    .max(12),
  paragraphs: z
    .array(
      z.object({
        index: z.number().int().positive(),
        role: z.string().max(200),
        feedback: z.string().max(2000),
        suggestion: z.string().max(2500),
      }),
    )
    .max(40),
  corrections: z
    .array(
      z.object({
        original: z.string().min(1).max(1500),
        replacement: z.string().max(2000),
        reason: z.string().max(1500),
        kind: z.enum(["grammar", "vocabulary", "clarity", "logic", "naturalness"]),
      }),
    )
    .max(25),
  improvedEssay: z.string().min(30).max(18000),
  advancedSuggestions: z.array(z.object({
    kind: z.enum(["vocabulary", "phrase", "sentence"]),
    original: z.string().min(1).max(1500),
    replacement: z.string().min(1).max(2000),
    explanation: z.string().min(1).max(1500),
    example: z.string().min(1).max(2000),
  })).max(9).default([]),
  exercises: z
    .array(
      z.object({
        title: z.string().max(200),
        instruction: z.string().max(1500),
      }),
    )
    .max(5),
});
export const feedbackJSONSchema = z.toJSONSchema(feedbackSchema);
export function validateChart(data: string) {
  if (!data) return;
  const match = data.match(
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) throw new Error("仅支持PNG、JPG、WebP或GIF图片。");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 1_000_000) throw new Error("题图不能超过1MB。");
  const format = bytes.subarray(0, 12);
  const valid =
    (match[1] === "png" &&
      format
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (match[1] === "jpeg" && format[0] === 255 && format[1] === 216) ||
    (match[1] === "gif" && format.toString().startsWith("GIF8")) ||
    (match[1] === "webp" &&
      format.toString().startsWith("RIFF") &&
      format.subarray(8).toString() === "WEBP");
  if (!valid) throw new Error("文件内容与图片类型不符。");
}

// Goal-aware teaching is validated separately and never part of a scoring schema.
export { targetCoachingContentSchema, targetCoachingSchema } from "./target-coaching-schema";
