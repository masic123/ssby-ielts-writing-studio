const writingCriteria = ["taskResponse", "coherence", "lexical", "grammar"] as const;

export function isWritingCriterionBand(score: unknown): score is number {
  return typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 9;
}

export function hasLegacyCriterionBands(criteria: Record<string, { score: number | null }>): boolean {
  return Object.values(criteria).some(({ score }) => score !== null && !isWritingCriterionBand(score));
}

/** Do not invent integer scores for old reports that used half-band criteria. */
export function criterionBandText(score: number | null | undefined, missing = "未评分"): string {
  if (score == null) return missing;
  return isWritingCriterionBand(score) ? String(score) : "待复评";
}

export const legacyCriterionNotice = "这份旧报告的小分使用过半分档，需重新批改后按整数档复评。原报告记录和总分保留。";

/** Equal criteria, rounded down to a half band; accepts legacy half-band records for history/accounting only. New assessments validate integer criteria first. */
export function writingOverallBand(criteria: unknown): number | null {
  if (!criteria || typeof criteria !== "object") return null;
  const values = criteria as Record<string, unknown>;
  let total = 0;
  for (const key of writingCriteria) {
    const criterion = values[key];
    if (!criterion || typeof criterion !== "object") return null;
    const score = (criterion as { score?: unknown }).score;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 9 || !Number.isInteger(score * 2)) return null;
    total += score;
  }
  return Math.floor((total / writingCriteria.length) * 2) / 2;
}
