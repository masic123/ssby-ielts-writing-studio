import type { ScoringCard } from "./scoring-card";
import { criterionBandText, hasLegacyCriterionBands, legacyCriterionNotice } from "./writing-score";

export type RevisionAssessment = {
  version: string;
  targetBand: number;
  minimumBand: number;
  status: "met" | "below_target" | "unverified" | "language_only";
  overallBand: number | null;
  criteria?: ScoringCard;
  attempts: number;
  wordCount: number;
  issues: string[];
};
export const revisionCriterionLabels = { taskResponse: "任务完成/回应", coherence: "连贯与衔接", lexical: "词汇运用", grammar: "语法与准确性" };
export const revisionStatusLabels = { met: "独立复评达到本次目标", below_target: "独立复评暂未达到改稿要求", unverified: "目标改稿尚未完成复核", language_only: "缺少题图，无法核实目标分" };

export function revisionAssessmentText(assessment?: RevisionAssessment) {
  if (!assessment) return "此历史报告的修改稿尚未按目标分独立复评。";
  const legacy = assessment.criteria && hasLegacyCriterionBands(assessment.criteria);
  return [`改稿目标：${assessment.targetBand.toFixed(1)}分`, `改稿独立复评：${assessment.overallBand?.toFixed(1) ?? "未确认"}`, legacy ? legacyCriterionNotice : revisionStatusLabels[assessment.status],
    ...(assessment.minimumBand > assessment.targetBand ? [`为保留原有水平，本次改稿要求至少${assessment.minimumBand.toFixed(1)}分。`] : []),
    ...(assessment.criteria ? Object.entries(assessment.criteria).map(([key, c]) => `${revisionCriterionLabels[key as keyof typeof revisionCriterionLabels]}：${criterionBandText(c.score)}\n${c.reason}\n依据：${c.evidence}`) : []),
    ...assessment.issues, "AI复评仅供练习参考，不能保证考试成绩。"].join("\n");
}
