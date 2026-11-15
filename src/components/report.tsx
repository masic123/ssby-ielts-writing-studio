"use client";
import { useEffect, useMemo, useState } from "react";
import { reviewProgress } from "@/lib/review-progress";
import TargetCoachingPanel from "./target-coaching";
import { targetCoachingText } from "@/lib/target-coaching-format";
import {
  ArrowLeft,
  CheckCircle,
  Target,
  DownloadSimple,
} from "@phosphor-icons/react";
import type { Review } from "@/lib/types";
import { buildRevisions, revisionText } from "@/lib/revisions";
import { methodSourceLabel } from "@/lib/methods";
import { hasOutline, outlineText } from "@/lib/outline";
import { AnnotatedOriginal, SentenceRevisions } from "./sentence-revisions";
import AdvancedSuggestions from "./advanced-suggestions";
import { advancedSuggestionsText } from "@/lib/advanced-suggestions";
import RevisionAssessmentPanel from "./revision-assessment";
import { revisionAssessmentText } from "@/lib/revision-assessment";
import { criterionBandText, hasLegacyCriterionBands, legacyCriterionNotice } from "@/lib/writing-score";
export function downloadText(text: string, name: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const criterionLabels = {
  taskResponse: "任务回应",
  coherence: "连贯与衔接",
  lexical: "词汇运用",
  grammar: "语法与准确性",
};
export default function Report({
  review,
  connectionNotice,
  onBack,
  onRewrite,
  rewriteBusy,
}: {
  review: Review;
  connectionNotice?: string;
  onBack: () => void;
  onRewrite: () => void;
  rewriteBusy?: boolean;
}) {
  const [tab, setTab] = useState<"sentences" | "feedback" | "rewrite" | "original" | "goal">(
    "sentences",
  );
  const [activeSentence, setActiveSentence] = useState<string | null>(null);
  const [navigation, setNavigation] = useState(0);
  const feedback = review.feedback;
  const legacyCriteria = feedback && hasLegacyCriterionBands(feedback.criteria);
  const labels = { ...criterionLabels, taskResponse: review.question.task === "Task 1" ? "任务完成" : "任务回应" };
  const revisions = useMemo(
    () => buildRevisions(review.input.essay, feedback?.corrections || []),
    [review.input.essay, feedback?.corrections],
  );
  const jumpTo = (view: "sentences" | "original", id: string) => {
    setTab(view);
    setActiveSentence(id);
    setNavigation((value) => value + 1);
  };
  useEffect(() => {
    if (!activeSentence || (tab !== "sentences" && tab !== "original")) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(
        `${tab === "original" ? "source" : "revision"}-${activeSentence}`,
      );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSentence, tab, navigation]);
  const selectTab = (value: typeof tab) => {
    setActiveSentence(null);
    setTab(value);
  };
  const exportReport = () =>
    downloadText(
      `# 写作批改报告\n\n${review.question.stem}\n\n原文AI参考估分：${feedback?.overallBand ?? "仅语言反馈"}\n\n${revisionAssessmentText(feedback?.revisionAssessment)}\n\n${feedback?.summary || review.error}\n\n${
        feedback
          ? Object.entries(feedback.criteria)
              .map(
                ([key, value]) =>
                  `${labels[key as keyof typeof labels]}：${criterionBandText(value.score)}\n${value.reason}\n依据：${value.evidence}`,
              )
              .join("\n\n") + (legacyCriteria ? `\n\n${legacyCriterionNotice}` : "")
          : ""
      }\n\n${feedback?.priorities.map((p) => `${p.title}\n${p.reason}\n${p.action}`).join("\n\n")}\n\n## 逐句修改\n${revisionText(revisions)}\n\n## 原文\n${review.input.essay}\n\n## 修改稿\n${feedback?.improvedEssay || ""}${feedback?.calibration ? `\n\n## 评分依据\n官方量表（${feedback.calibration.rubricVersion}）：${feedback.calibration.rubricUrl}\n本次提供的对照样本：\n${feedback.calibration.references.map((s) => `- ${s.title} · ${s.band.toFixed(1)}分 · ${s.sourceUrl}`).join("\n")}\n样本为第三方转录，仅有单篇总分，未提供四项人工分数。` : ""}\n\n${advancedSuggestionsText(feedback?.advancedSuggestions)}\n\n${targetCoachingText(feedback?.targetCoaching)}`,
      "莎试笔雅-批改报告.md",
    );
  return (
    <div className="report-view">
      <div className="report-toolbar">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={18} />
          返回批改记录
        </button>
        <button className="button secondary" onClick={exportReport}>
          <DownloadSimple size={17} />
          导出报告
        </button>
      </div>
      <div className="page-intro compact">
        <h1>批改报告</h1>
        <p>
          {review.input.title || review.question.name} ·{" "}
          {new Date(review.createdAt).toLocaleString("zh-CN")}
        </p>
      </div>
      {review.status === "processing" ? (
        <div className="empty" role="status" aria-live="polite">
          <div className="loading-line" />
          <h2>{reviewProgress(review).title}</h2>
          <p>{reviewProgress(review).description}</p>
          {connectionNotice && <p>{connectionNotice}</p>}
        </div>
      ) : !feedback ? (
        <div className="error-box" role="alert">
          {review.error || "这次批改没有生成有效报告。"}
          <button className="text-button" onClick={onRewrite} disabled={rewriteBusy}>
            回到作文重试
            <ArrowRightIcon />
          </button>
        </div>
      ) : (
        <>
          <section className="score-overview">
            <div className="score-hero">
              <span>原文AI参考估分</span>
              <strong>{feedback.overallBand?.toFixed(1) ?? "未评"}</strong>
              <span className="small">
                {feedback.assessmentScope === "full"
                  ? "IELTS Writing · 非官方评分"
                  : "仅语言与结构反馈"}
              </span>
            </div>
            <div className="score-summary">
              <h2>这篇作文，先改什么？</h2>
              <p>{feedback.summary}</p>
              <RevisionAssessmentPanel assessment={feedback.revisionAssessment} compact />
              <div className="score-strip">
                {Object.entries(feedback.criteria).map(([key, c]) => (
                  <div key={key}>
                    <strong>{criterionBandText(c.score, "未评")}</strong>
                    <span>{labels[key as keyof typeof labels]}</span>
                  </div>
                ))}
              </div>
              {legacyCriteria && <p className="small muted">{legacyCriterionNotice}</p>}
            </div>
          </section>
          <div className="report-tabs segment" role="group" aria-label="报告内容">
            <button
              aria-pressed={tab === "sentences"}
              onClick={() => selectTab("sentences")}
            >
              逐句修改
            </button>
            <button
              aria-pressed={tab === "feedback"}
              onClick={() => selectTab("feedback")}
            >
              批改建议
            </button>
            <button
              aria-pressed={tab === "rewrite"}
              onClick={() => selectTab("rewrite")}
            >
              完整修改稿
            </button>
            <button
              aria-pressed={tab === "original"}
              onClick={() => selectTab("original")}
            >
              原文标注
            </button>
            <button aria-pressed={tab === "goal"} onClick={() => selectTab("goal")}>目标提升</button>
          </div>
          {tab === "goal" ? (
            <TargetCoachingPanel coaching={feedback.targetCoaching} target={review.input.targetBand} scale="ielts" />
          ) : tab === "sentences" ? (
            <SentenceRevisions
              document={revisions}
              activeId={activeSentence}
              onLocate={(id) => jumpTo("original", id)}
              onDownload={() => downloadText(revisionText(revisions), "莎试笔雅-逐句对照.txt")}
            />
          ) : tab === "feedback" ? (
            <>
              <section className="report-section">
                <h2>
                  <Target size={22} />
                  优先做好这几件事
                </h2>
                <div className="priority-list">
                  {feedback.priorities.map((p, i) => (
                    <article key={i}>
                      <span className="ordinal">0{i + 1}</span>
                      <div>
                        <h3>{p.title}</h3>
                        <p>{p.reason}</p>
                        <p className="action-line">{p.action}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="report-section">
                <h2>四项评价依据</h2>
                <div className="criteria-detail">
                  {Object.entries(feedback.criteria).map(([key, c]) => (
                    <article key={key}>
                      <h3>
                        {labels[key as keyof typeof labels]}
                        <span>{criterionBandText(c.score)}</span>
                      </h3>
                      <p>{c.reason}</p>
                      <blockquote>{c.evidence}</blockquote>
                    </article>
                  ))}
                </div>
              </section>
              {feedback.strengths.length > 0 && (
                <section className="report-section strengths">
                  <h2>
                    <CheckCircle size={22} />
                    这些表达，值得保留
                  </h2>
                  {feedback.strengths.map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </section>
              )}
              {feedback.methodChecks.length > 0 && (
                <section className="report-section">
                  <h2>用写作方法重新检查</h2>
                  {feedback.methodChecks.map((check, i) => {
                    const rule = review.references.find(
                      (r) => r.id === check.ruleId,
                    );
                    return (
                      <article className="method-check" key={i}>
                        <div className="between">
                          <h3>{rule?.title || check.ruleId}</h3>
                          <span
                            className={`tag ${check.status === "met" ? "" : "subtle"}`}
                          >
                            {
                              {
                                met: "已做到",
                                partial: "还可加强",
                                missing: "需要补充",
                                not_applicable: "本题不适用",
                              }[check.status]
                            }
                          </span>
                        </div>
                        <p>{check.evidence}</p>
                        <p>{check.advice}</p>
                        {rule?.source && (
                          <small className="muted">
                            {methodSourceLabel(rule)}
                          </small>
                        )}
                      </article>
                    );
                  })}
                </section>
              )}
              {feedback.paragraphs.length > 0 && (
                <section className="report-section">
                  <h2>逐段梳理</h2>
                  {feedback.paragraphs.map((p, i) => (
                    <article className="paragraph-note" key={i}>
                      <span className="ordinal">
                        {String(p.index).padStart(2, "0")}
                      </span>
                      <div>
                        <h3>{p.role}</h3>
                        <p>{p.feedback}</p>
                        <p className="action-line">{p.suggestion}</p>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {feedback.exercises.length > 0 && (
                <section className="report-section practice">
                  <h2>留给下一篇的小练习</h2>
                  {feedback.exercises.map((e, i) => (
                    <div key={i}>
                      <h3>{e.title}</h3>
                      <p>{e.instruction}</p>
                    </div>
                  ))}
                </section>
              )}
            </>
          ) : tab === "original" ? (
            <AnnotatedOriginal
              document={revisions}
              essay={review.input.essay}
              activeId={activeSentence}
              onOpen={(id) => jumpTo("sentences", id)}
              onDownload={() => downloadText(review.input.essay, "莎试笔雅-原文.txt")}
            />
          ) : (
            <section className="report-section">
              <div className="between">
                <h2>
                  按目标完善整篇作文
                </h2>
                <button
                  className="text-button"
                  onClick={() =>
                    downloadText(
                      feedback.improvedEssay,
                      "莎试笔雅-修改稿.txt",
                    )
                  }
                >
                  <DownloadSimple size={17} />
                  下载
                </button>
              </div>
              <RevisionAssessmentPanel assessment={feedback.revisionAssessment} />
              <div className="essay-prose" lang="en">
                {feedback.improvedEssay}
              </div>
              <p className="small muted">
                整篇改稿可补充贴题解释和调整段落。原文具体问题可切换到“逐句修改”查看。
              </p>
            </section>
          )}
          {feedback.calibration && (
            <details className="score-references">
              <summary>评分依据与对照样本（{feedback.calibration.references.length}篇）</summary>
              <p className="small">
                依据 <a href={feedback.calibration.rubricUrl} target="_blank" rel="noopener noreferrer">IELTS 官方写作量表（{feedback.calibration.rubricVersion}）</a>，
                从现有 {feedback.calibration.availableScoredSamples} 篇带分样本中选择同任务、同考试类别的作文对照。
              </p>
              <ul>
                {feedback.calibration.references.map((s) => (
                  <li key={s.id}><a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">{s.title}</a><span>{s.band.toFixed(1)} 分</span></li>
                ))}
              </ul>
              <p className="small muted">样本为第三方转录，尚待逐篇核对原版；只提供单篇总分，没有四项独立人工分数。对照用于理解分数边界，估分仍可能与官方评分有差异。</p>
              {feedback.assessmentScope === "language_only" && <p className="small muted">本次缺少可核实的题图，对照仅辅助语言反馈，不给任务完成分或总分。</p>}
            </details>
          )}
          <AdvancedSuggestions suggestions={feedback.advancedSuggestions} />
          <div className="report-bottom">
            <p>看完反馈，再练一次。</p>
            <button className="button primary" onClick={onRewrite} disabled={rewriteBusy}>
              {rewriteBusy ? "正在读取原题图…" : "重新写这道题"}
              <ArrowRightIcon />
            </button>
          </div>
          {hasOutline(review.input.outline) && (
            <details className="report-outline">
              <summary>查看这次的写前提纲</summary>
              <p className="small muted">提纲仅用于回顾，不计入作文评分。</p>
              <pre>{outlineText(review.input.outline!, review.question)}</pre>
            </details>
          )}
          <p className="source-note">
            评分由 AI
            根据四项写作维度生成，仅供练习参考，与官方人工评分可能存在差异。Simon
            方法与课堂笔记用于教学指导，不是额外的评分标准。
          </p>
        </>
      )}
    </div>
  );
}
function ArrowRightIcon() {
  return <span aria-hidden="true">→</span>;
}
