import { membershipReviewMode, reserveMembershipReview, finishMembershipReview, reconcileMembershipUsage } from "./membership";
import { HttpError } from "../src/lib/http";
import { referencesFor, resolveQuestion } from "../src/lib/content";
import { wordCount } from "../src/lib/types";
import type { Draft, DraftHistoryItem, EssayInput, Feedback, Review, ReviewHistoryItem } from "../src/lib/types";
import type { Env } from "./types";
import { finishReviewAccounting } from "./leaderboard";
import { writingOverallBand } from "../src/lib/writing-score";
type Row = Record<string, unknown>;
const draftFrom = (r: Row): Draft => ({
  id: String(r.id),
  input: JSON.parse(String(r.input)),
  version: Number(r.version),
  updatedAt: String(r.updated_at),
  wordCount: Number(r.word_count),
});
function orderedDraftValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedDraftValue);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, orderedDraftValue(item)]));
  return value;
}
function sameDraftInput(saved: unknown, input: EssayInput): boolean {
  try {
    return JSON.stringify(orderedDraftValue(JSON.parse(String(saved)))) === JSON.stringify(orderedDraftValue(input));
  } catch { return false; }
}
function reviewFeedback(value: unknown): Feedback | null {
  if (!value) return null;
  const feedback = JSON.parse(String(value)) as Feedback;
  const band = feedback.assessmentScope === "full" ? writingOverallBand(feedback.criteria) : null;
  return band === null ? feedback : { ...feedback, overallBand: band };
}
const reviewFrom = (r: Row): Review => ({
  id: String(r.id),
  draftId: r.draft_id ? String(r.draft_id) : null,
  status: r.status as Review["status"],
  createdAt: String(r.created_at),
  input: JSON.parse(String(r.input)),
  question: JSON.parse(String(r.question)),
  feedback: reviewFeedback(r.feedback),
  error: r.error ? String(r.error) : null,
  model: String(r.model),
  references: JSON.parse(String(r.refs)),
});
export async function listDrafts(env: Env, owner: string) {
  return (
    await env.DB.prepare(
      "SELECT * FROM drafts WHERE user_id=? ORDER BY updated_at DESC LIMIT 100",
    )
      .bind(owner)
      .all<Row>()
  ).results.map(draftFrom);
}
export async function listDraftHistory(env: Env, owner: string): Promise<DraftHistoryItem[]> {
  const rows = (await env.DB.prepare(`SELECT id,version,updated_at,word_count,
    json_extract(input,'$.title') AS title,json_extract(input,'$.questionId') AS question_id
    FROM drafts WHERE user_id=? ORDER BY updated_at DESC LIMIT 100`).bind(owner).all<Row>()).results;
  return rows.map(row => ({ id: String(row.id), version: Number(row.version), updatedAt: String(row.updated_at), wordCount: Number(row.word_count),
    input: { title: String(row.title || ""), questionId: row.question_id === null ? null : Number(row.question_id) },
  }));
}
export async function getDraft(env: Env, owner: string, id: string) {
  const row = await env.DB.prepare("SELECT * FROM drafts WHERE id=? AND user_id=?").bind(id, owner).first<Row>();
  if (!row) throw new HttpError(404, "没有找到这篇草稿。");
  return draftFrom(row);
}
export async function saveDraft(
  env: Env,
  owner: string,
  input: EssayInput,
  id?: string,
  version?: number,
) {
  try {
    resolveQuestion(input);
  } catch {
    throw new HttpError(400, "没有找到该题目，请重新选择。");
  }
  if (id) {
    const row = await env.DB.prepare(
      "SELECT * FROM drafts WHERE id=? AND user_id=?",
    )
      .bind(id, owner)
      .first<Row>();
    if (!row) throw new HttpError(404, "没有找到这篇草稿。");
    // A retry of already saved content is a read, including after a lost response.
    if (sameDraftInput(row.input, input)) return draftFrom(row);
    if (Number(row.version) !== version)
      throw new HttpError(
        409,
        "草稿已在其他页面更新。请下载本机备份后重新打开草稿。",
        "DRAFT_CONFLICT",
      );
    const result = await env.DB.prepare(
      "UPDATE drafts SET input=?,version=version+1,updated_at=?,word_count=? WHERE id=? AND user_id=? AND version=? RETURNING *",
    )
      .bind(
        JSON.stringify(input),
        new Date().toISOString(),
        wordCount(input.essay),
        id,
        owner,
        version!,
      )
      .first<Row>();
    if (!result) {
      const current = await env.DB.prepare("SELECT * FROM drafts WHERE id=? AND user_id=?")
        .bind(id, owner).first<Row>();
      if (current && sameDraftInput(current.input, input)) return draftFrom(current);
      throw new HttpError(
        409,
        "草稿刚刚在其他页面更新，请先下载本机备份。",
        "DRAFT_CONFLICT",
      );
    }
    return draftFrom(result);
  }
  const newId = crypto.randomUUID();
  const result = await env.DB.prepare(
    "INSERT INTO drafts(id,user_id,input,updated_at,word_count) VALUES(?,?,?,?,?) RETURNING *",
  )
    .bind(
      newId,
      owner,
      JSON.stringify(input),
      new Date().toISOString(),
      wordCount(input.essay),
    )
    .first<Row>();
  return draftFrom(result!);
}
/** Queue-managed work owns its deadline; only expire legacy orphaned requests. */
export async function expireReviews(env: Env, owner: string) {
  const cutoff = new Date(Date.now() - 4 * 60000).toISOString();
  if (env.AI_JOBS) {
    const stale = (await env.DB.prepare("SELECT id FROM reviews WHERE user_id=? AND status='processing' AND created_at<?")
      .bind(owner, cutoff).all<{ id: string }>()).results;
    for (const row of stale) {
      if (env.AI_JOBS.isManaged(row.id)) continue;
      await env.DB.prepare("UPDATE reviews SET status='failed',error=? WHERE id=? AND user_id=? AND status='processing' AND created_at<?")
        .bind("批改进程中断或超时，请重新提交。", row.id, owner, cutoff).run();
    }
  } else {
    await env.DB.prepare("UPDATE reviews SET status='failed',error=? WHERE user_id=? AND status='processing' AND created_at<?")
      .bind("批改进程中断或超时，请重新提交。", owner, cutoff).run();
  }
  await reconcileMembershipUsage(env, owner);
}
function queuedReview(env: Env, row: Row): Review {
  const review = reviewFrom(row);
  const queue = review.status === "processing" ? env.AI_JOBS?.reviewInfo(review.id) : undefined;
  return queue ? { ...review, queue } : review;
}

export async function getReview(env: Env, owner: string, id: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM reviews WHERE id=? AND user_id=?",
  )
    .bind(id, owner)
    .first<Row>();
  if (!row) throw new HttpError(404, "没有找到这份批改记录。");
  return queuedReview(env, row);
}
export async function listReviews(env: Env, owner: string) {
  await expireReviews(env, owner);
  return (
    await env.DB.prepare(
      "SELECT * FROM reviews WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(owner)
      .all<Row>()
  ).results.map(row => queuedReview(env, row));
}
/** Keep list responses small: original essays, images and reports are read only on open. */
export async function listReviewHistory(env: Env, owner: string): Promise<ReviewHistoryItem[]> {
  await expireReviews(env, owner);
  const rows = (await env.DB.prepare(`SELECT id,draft_id,status,created_at,
    json_extract(input,'$.title') AS title,
    json_extract(question,'$.name') AS question_name,
    json_extract(question,'$.task') AS task,
    json_extract(feedback,'$.overallBand') AS overall_band,
    json_extract(feedback,'$.assessmentScope') AS scope,
    json_extract(feedback,'$.criteria.taskResponse.score') AS tr,
    json_extract(feedback,'$.criteria.coherence.score') AS cc,
    json_extract(feedback,'$.criteria.lexical.score') AS lr,
    json_extract(feedback,'$.criteria.grammar.score') AS gra,
    feedback IS NOT NULL AS has_feedback
    FROM reviews WHERE user_id=? ORDER BY created_at DESC LIMIT 100`).bind(owner).all<Row>()).results;
  return rows.map(row => {
    const calculated = row.scope === "full" ? writingOverallBand({
      taskResponse: { score: row.tr }, coherence: { score: row.cc },
      lexical: { score: row.lr }, grammar: { score: row.gra },
    }) : null;
    const overallBand = calculated ?? (typeof row.overall_band === "number" ? row.overall_band : null);
    const status = row.status as Review["status"];
    const queue = status === "processing" ? env.AI_JOBS?.reviewInfo(String(row.id)) : undefined;
    return {
      id: String(row.id), draftId: row.draft_id ? String(row.draft_id) : null, status,
      createdAt: String(row.created_at), input: { title: String(row.title || "") },
      question: { name: String(row.question_name || "写作练习"), task: row.task as "Task 1" | "Task 2" },
      feedback: row.has_feedback ? { overallBand } : null,
      ...(queue ? { queue } : {}),
    };
  });
}
export async function beginReview(
  env: Env,
  owner: string,
  input: EssayInput,
  requestKey: string,
  model: string,
  draftId?: string,
): Promise<{ review: Review; created: boolean }> {
  await expireReviews(env, owner);
  const existing = await env.DB.prepare(
    "SELECT * FROM reviews WHERE user_id=? AND request_key=?",
  )
    .bind(owner, requestKey)
    .first<Row>();
  if (existing) return { review: queuedReview(env, existing), created: false };
  if (
    draftId &&
    !(await env.DB.prepare("SELECT id FROM drafts WHERE id=? AND user_id=?")
      .bind(draftId, owner)
      .first())
  )
    throw new HttpError(404, "没有找到这篇草稿。");
  if (
    await env.DB.prepare(
      "SELECT id FROM reviews WHERE user_id=? AND status='processing'",
    )
      .bind(owner)
      .first()
  )
    throw new HttpError(
      409,
      "已有一篇作文正在批改，请等待完成。",
      "REVIEW_PENDING",
    );
  if (await membershipReviewMode(env, owner) === "legacy") {
  const limit = Math.max(
    1,
    Math.min(100, Number(env.DAILY_REVIEW_LIMIT) || 15),
  );
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reviews WHERE user_id=? AND created_at>=? AND status IN ('completed','processing')",
  )
    .bind(owner, dayStart.toISOString())
    .first<{ n: number }>();
  if ((count?.n || 0) >= limit)
    throw new HttpError(
      429,
      `今日批改已达到 ${limit} 次，请明天再来。`,
      "DAILY_LIMIT",
    );
  }
  let question;
  try {
    question = resolveQuestion(input);
  } catch {
    throw new HttpError(400, "没有找到该题目。");
  }
  const id = crypto.randomUUID();
  const refs = referencesFor(question).rules;
  await reserveMembershipReview(env, owner, requestKey, id);
  try {
    await env.DB.prepare(
      "INSERT INTO reviews(id,user_id,draft_id,input,question,status,model,refs,request_key,created_at) VALUES(?,?,?,?,?,'processing',?,?,?,?)",
    )
      .bind(
        id,
        owner,
        draftId || null,
        JSON.stringify(input),
        JSON.stringify(question),
        model,
        JSON.stringify(refs),
        requestKey,
        new Date().toISOString(),
      )
      .run();
  } catch {
    const duplicate = await env.DB.prepare(
      "SELECT * FROM reviews WHERE user_id=? AND request_key=?",
    )
      .bind(owner, requestKey)
      .first<Row>();
    if (duplicate) return { review: queuedReview(env, duplicate), created: false };
    await finishMembershipReview(env, owner, id, false);
    throw new HttpError(409, "已有批改正在处理，请稍候。");
  }
  return { review: await getReview(env, owner, id), created: true };
}
export async function finishReview(
  env: Env,
  owner: string,
  id: string,
  feedback: Feedback | null,
  error?: string,
) {
  await finishReviewAccounting(env, owner, id, feedback, error);
  try {
    const saved = await getReview(env, owner, id);
    if (saved.status !== "processing") await finishMembershipReview(env, owner, id, saved.status === "completed");
  } catch { console.warn("Membership usage reconciliation deferred; saved review is preserved."); }

  return getReview(env, owner, id);
}
