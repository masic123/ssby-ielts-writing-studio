import { revisionCriterionLabels, revisionStatusLabels, type RevisionAssessment } from "../lib/revision-assessment";
import { criterionBandText, hasLegacyCriterionBands, legacyCriterionNotice } from "../lib/writing-score";

export default function RevisionAssessmentPanel({ assessment, compact = false }: { assessment?: RevisionAssessment; compact?: boolean }) {
  if (!assessment) return <p className="small muted">此历史报告的修改稿尚未按目标分独立复评。重新批改后可查看目标改稿。</p>;
  const legacy = assessment.criteria && hasLegacyCriterionBands(assessment.criteria);
  return <div className="revision-assessment" data-revision-status={assessment.status} role="status">
    <p><strong>改稿目标 {assessment.targetBand.toFixed(1)} 分</strong> · 独立复评 {assessment.overallBand?.toFixed(1) ?? "未确认"}</p>
    <p>{legacy ? legacyCriterionNotice : revisionStatusLabels[assessment.status]}</p>
    {assessment.minimumBand > assessment.targetBand && <p className="small">为保留原有水平，本次改稿要求至少 {assessment.minimumBand.toFixed(1)} 分。</p>}
    {!compact && <>
      {assessment.criteria && <div className="score-strip">{Object.entries(assessment.criteria).map(([key, c]) => <div key={key}>
        <span>{revisionCriterionLabels[key as keyof typeof revisionCriterionLabels]}</span><strong>{criterionBandText(c.score)}</strong>
      </div>)}</div>}
      {assessment.criteria && <details><summary>查看改稿复评依据</summary>{Object.entries(assessment.criteria).map(([key, c]) => <div key={key}>
        <h3>{revisionCriterionLabels[key as keyof typeof revisionCriterionLabels]}</h3><p>{c.reason}</p><blockquote>{c.evidence}</blockquote>
      </div>)}</details>}
      {assessment.issues.map((issue, index) => <p className="small" key={index}>{issue}</p>)}
      <p className="small muted">复评针对下方整篇改稿；逐句修改仍用于解释原文问题。AI估分仅供练习参考。</p>
    </>}
  </div>;
}
