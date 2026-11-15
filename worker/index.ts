import { targetPreferenceRoute } from "./target-preferences";
import { membershipRoute, registrationMembershipStatements } from "./membership";
import { z } from "zod";
import { runInteractive } from "./ai-capacity";
import { assertOrigin, body, endpoint, HttpError } from "../src/lib/http";
import { academicQuestions, methods } from "../src/lib/content";
import { essaySchema, validateChart } from "../src/lib/validation";
import { wordCount, type Review } from "../src/lib/types";
import { providerConfig, assessEssayWithCoaching } from "../src/lib/reviewer";
import { questionImageSchema, readQuestionImage } from "../src/lib/question-reader";
import { askTeacher, teacherInputSchema } from "../src/lib/teacher";
import {
  currentUser,
  requireUser,
  hashPassword,
  verifyPassword,
  rateLimit,
  createSession,
  destroySession,
  renewedSessionCookie,
} from "./auth";
import {
  listDrafts,
  listDraftHistory,
  getDraft,
  saveDraft,
  listReviews,
  listReviewHistory,
  getReview,
  beginReview,
  finishReview,
  expireReviews,
} from "./repository";
import type { Env } from "./types";
import { durableDatabase } from "./store";
import { withLeaderboard } from "./leaderboard";
import { registrationNoticeStatement, requireRegistrationNotice } from "./registration-notice";
import { chartResponse, recordForView } from "../src/lib/record-transport";
export { WritingStore } from "./store";
const credentials = z.object({
  action: z.enum(["login", "register", "logout"]),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("请填写有效邮箱。")
    .max(200)
    .optional(),
  password: z.string().min(8, "密码至少 8 个字符。").max(128).optional(),
  name: z.string().trim().min(1).max(40).optional(),
  code: z.string().max(200).optional(),
  referralCode: z.string().trim().max(40).optional(),
  acceptNotice: z.boolean().optional(),
  noticeVersion: z.string().max(80).optional(),
});
const json = (value: unknown, cookie?: string, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
function checkImage(input: { customQuestion?: { chartData?: string } }) {
  try {
    if (input.customQuestion?.chartData)
      validateChart(input.customQuestion.chartData);
  } catch {
    throw new HttpError(
      400,
      "题图格式不正确，支持不超过 1MB 的 PNG、JPG、WebP 或 GIF。",
    );
  }
}
async function auth(request: Request, env: Env) {
  const db = env.AUTH_DB || env.DB;
  const authLimitEnv = { ...env, DB: db };
  if (request.method === "DELETE") {
    assertOrigin(request);
    const user = await requireUser(request, env);
    if (env.AUTH_DB) throw new HttpError(405, "共用账号暂不支持自助注销，请联系管理员处理。 ");
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(user.id).run();
    return json({ user: null }, await destroySession(request, env));
  }
  if (request.method === "GET")
    return json({
      user: await currentUser(request, env),
      invitationRequired: !!env.REGISTRATION_CODE,
      sharedAccount: !!env.AUTH_DB,
    });
  if (request.method !== "POST") throw new HttpError(405, "请求方式不支持。");
  assertOrigin(request);
  const data = credentials.parse(await body(request, 5000));
  if (data.action === "logout")
    return json({ user: null }, await destroySession(request, env));
  if (!data.email || !data.password)
    throw new HttpError(400, "请填写邮箱和密码。");
  await rateLimit(authLimitEnv, `auth:${data.email}`, 12, 15 * 60000);
  await rateLimit(
    authLimitEnv,
    `auth-ip:${request.headers.get("CF-Connecting-IP") || "local"}`,
    60,
    15 * 60000,
  );
  if (data.action === "register") {
    requireRegistrationNotice(data);
    if (env.REGISTRATION_CODE && data.code !== env.REGISTRATION_CODE)
      throw new HttpError(403, "邀请码不正确。");
    if (!data.name) throw new HttpError(400, "请填写你的昵称。");
    if (
      await db.prepare("SELECT id FROM users WHERE email=?")
        .bind(data.email)
        .first()
    )
      throw new HttpError(409, "该邮箱已注册，请登录。");
    const password = await hashPassword(data.password);
    const id = crypto.randomUUID();
    const memberRegistration = await registrationMembershipStatements(env, id, data.referralCode);
    const createdAt = new Date().toISOString();
    const noticeAcceptance = await registrationNoticeStatement(db, id, createdAt);
    try {
      await db.batch([db.prepare("INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?)")
        .bind(id, data.email, data.name, password, createdAt), noticeAcceptance, ...memberRegistration]);
    } catch {
      if (await db.prepare("SELECT id FROM users WHERE email=?").bind(data.email).first())
        throw new HttpError(409, "该邮箱已注册，请登录。");
      throw new HttpError(503, "暂时无法完成注册，请稍后重试。");
    }
    await destroySession(request, env);
    return json(
      { user: { id, email: data.email, name: data.name } },
      await createSession(request, env, id),
    );
  }
  const row = await db.prepare("SELECT * FROM users WHERE email=?")
    .bind(data.email)
    .first<Record<string, string>>();
  if (!row) {
    await hashPassword(data.password);
    throw new HttpError(401, "邮箱或密码不正确。");
  }
  if (!(await verifyPassword(data.password, row.password)))
    throw new HttpError(401, "邮箱或密码不正确。");
  await destroySession(request, env);
  return json(
    { user: { id: row.id, email: row.email, name: row.name } },
    await createSession(request, env, row.id),
  );
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const targetPreferenceResponse = await targetPreferenceRoute(request, env);
  if (targetPreferenceResponse) return targetPreferenceResponse;
  const memberResponse = await membershipRoute(request, env);
  if (memberResponse) return memberResponse;
  if (url.pathname === "/api/auth") return auth(request, env);
  if (method === "GET" && url.pathname === "/api/health")
    return json({ status: "ok" });
  if (method === "GET" && url.pathname === "/api/config")
    return json({ ...providerConfig(env), application: "judu-writing", aiQueue: env.AI_JOBS ? { enabled: true, concurrency: env.AI_JOBS.policy.concurrency, maxPending: env.AI_JOBS.policy.maxPending } : { enabled: false } });
  if (method === "GET" && url.pathname === "/api/questions")
    return json({ questions: academicQuestions() });
  if (url.pathname === "/api/questions/parse") {
    if (method !== "POST") throw new HttpError(405, "请求方式不支持。");
    assertOrigin(request);
    const user = await requireUser(request, env);
    const input = questionImageSchema.parse(await body(request, 1_500_000));
    await rateLimit(env, `question-image:${user.id}`, 5, 10 * 60_000);
    await rateLimit(env, `question-image-day:${user.id}:${new Date().toISOString().slice(0, 10)}`, 20, 24 * 3600_000);
    return json(await runInteractive(env, user.id, request.signal, (_signal, requestFetch) => readQuestionImage(input, env, requestFetch)));
  }
  if (method === "GET" && url.pathname === "/api/methods")
    return json({ methods: methods() });
  if (url.pathname === "/api/teacher") {
    if (method !== "POST") throw new HttpError(405, "请求方式不支持。");
    assertOrigin(request);
    const user = await requireUser(request, env);
    const input = teacherInputSchema.parse(await body(request, 90000));
    await rateLimit(env, `teacher:${user.id}`, 8, 10 * 60_000);
    await rateLimit(env, `teacher-day:${user.id}:${new Date().toISOString().slice(0, 10)}`, 40, 24 * 3600_000);
    return json(await runInteractive(env, user.id, request.signal, (_signal, requestFetch) => askTeacher(input, env, requestFetch)));
  }
  if (url.pathname === "/api/drafts") {
    const user = await requireUser(request, env);
    if (method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        const draft = await getDraft(env, user.id, id);
        if (url.searchParams.get("asset") === "chart") return chartResponse(draft.input);
        return json({ draft: url.searchParams.get("view") === "editor" ? await recordForView(draft, `/api/drafts?id=${encodeURIComponent(id)}&asset=chart`) : draft });
      }
      return json({ drafts: url.searchParams.get("summary") === "1" ? await listDraftHistory(env, user.id) : await listDrafts(env, user.id) });
    }
    if (method !== "POST") throw new HttpError(405, "请求方式不支持。");
    assertOrigin(request);
    await rateLimit(env, `draft:${user.id}`, 100, 60000);
    const data = z
      .object({
        id: z.string().uuid().optional(),
        version: z.number().int().positive().optional(),
        input: essaySchema,
      })
      .parse(await body(request, 1600000));
    checkImage(data.input);
    const draft = await saveDraft(env, user.id, data.input, data.id, data.version);
    return json({ draft: url.searchParams.get("view") === "editor" ? await recordForView(draft, `/api/drafts?id=${encodeURIComponent(draft.id)}&asset=chart`) : draft });
  }
  if (url.pathname === "/api/reviews") {
    const user = await requireUser(request, env);
    const respond = async (review: Review, status = 200) => json({ review: url.searchParams.get("view") === "report"
      ? await recordForView(review, `/api/reviews?id=${encodeURIComponent(review.id)}&asset=chart`) : review }, undefined, status);
    if (method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        await expireReviews(env, user.id);
        const review = await getReview(env, user.id, id);
        if (url.searchParams.get("asset") === "chart") return chartResponse(review.input);
        return json({ review: url.searchParams.get("view") === "report" ? await recordForView(review, `/api/reviews?id=${encodeURIComponent(id)}&asset=chart`) : review });
      }
      return json({ reviews: url.searchParams.get("summary") === "1" ? await listReviewHistory(env, user.id) : await listReviews(env, user.id) });
    }
    if (method !== "POST") throw new HttpError(405, "请求方式不支持。");
    assertOrigin(request);
    const data = z
      .object({
        input: essaySchema,
        draftId: z.string().uuid().optional(),
        requestKey: z.string().uuid(),
      })
      .parse(await body(request, 1600000));
    checkImage(data.input);
    if (wordCount(data.input.essay) < 30)
      throw new HttpError(400, "请至少写 30 个英文单词再提交批改。");
    const config = providerConfig(env);
    if (!config.configured)
      throw new HttpError(
        503,
        "批改服务尚未配置，请联系网站管理员。",
        "NOT_CONFIGURED",
      );
    await rateLimit(env, `review:${user.id}`, 12, 10 * 60000);
    const { review, created } = await beginReview(
      env,
      user.id,
      data.input,
      data.requestKey,
      config.model,
      data.draftId,
    );
    if (env.AI_JOBS && review.status === "processing") {
      try {
        await env.AI_JOBS.enqueueReview(user.id, review.id);
      } catch (error) {
        // Admission failure preserves the submitted answer and releases the account's slot.
        if (!env.AI_JOBS.reviewInfo(review.id))
          await finishReview(env, user.id, review.id, null, error instanceof HttpError ? error.message : "批改任务暂时无法接收，作答已保留，请稍后重试。");
        throw error;
      }
      const saved = await getReview(env, user.id, review.id);
      return respond(saved, saved.status === "processing" ? 202 : 200);
    }
    if (!created) return respond(review);
    try {
      return respond(await finishReview(
          env,
          user.id,
          review.id,
          await assessEssayWithCoaching(data.input, review.question, env, env.ASSETS),
        ));
    } catch (error) {
      await finishReview(
        env,
        user.id,
        review.id,
        null,
        error instanceof HttpError
          ? error.message
          : "本次批改失败，草稿已保留，请稍后重试。",
      );
      throw error;
    }
  }
  throw new HttpError(404, "接口不存在。");
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    if (url.pathname.startsWith("/api/")) {
      if (!env.DB && env.STORE)
        env = { ...env, DB: durableDatabase(env.STORE) };
      try {
        response = await withLeaderboard(request, env, () => route(request, env));
      } catch (error) {
        response = await endpoint(async () => {
          throw error;
        });
      }
    } else response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    const renewedCookie = renewedSessionCookie(request);
    if (renewedCookie && !headers.has("Set-Cookie")) headers.set("Set-Cookie", renewedCookie);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", url.pathname === "/promotion" || url.pathname === "/promotion/" || headers.get("Referrer-Policy") === "no-referrer" ? "no-referrer" : "strict-origin-when-cross-origin");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (url.pathname.startsWith("/api/"))
      headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
