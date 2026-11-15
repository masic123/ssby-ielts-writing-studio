import { HttpError } from "./http";
import { thinkingOptions } from "./provider-thinking";
import { parseProviderCompletion, ProviderCompletionError, type CompletionMetadata } from "./provider-completion";
import type { ProviderEnv } from "./reviewer";

const retryableCompletion = new Set(["length", "incomplete", "malformed", "empty"]);
const invalidMessage = "模型响应未能完整生成。草稿已保留，请稍后重试。";
const timeout = () => new HttpError(504, "批改连接超时或网络中断。草稿已保留，可以稍后重试。", "PROVIDER_TIMEOUT");

/** Retry only a fresh, complete response. Never repair or reuse a partial grade. */
export async function providerJSON(
  messages: unknown[], env: ProviderEnv, requestFetch: typeof fetch,
  thinking: boolean, maxTokens: number, deadline: AbortSignal,
): Promise<unknown> {
  let budget = maxTokens;
  const requestId = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (deadline.aborted) throw timeout();
    const started = Date.now();
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(150000)]);
    let response: Response;
    try {
      response = await requestFetch(
        `${(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: env.DEEPSEEK_MODEL || "deepseek-flash", messages,
            response_format: { type: "json_object" }, ...thinkingOptions(env, thinking),
            max_tokens: budget, temperature: 0.1,
            ...(env.DEEPSEEK_STREAM === "true" ? { stream: true, stream_options: { include_usage: true } } : {}),
          }),
          signal,
        },
      );
    } catch (error) {
      if (error instanceof HttpError && error.code === "AI_JOB_CANCELLED") throw error;
      console.warn("Provider transport metadata", JSON.stringify({ requestId, attempt: attempt + 1, thinking, maxTokens: budget, elapsedMs: Date.now() - started, phase: "request", aborted: signal.aborted }));
      if (attempt === 0 && !deadline.aborted) continue;
      throw timeout();
    }
    if (response.status === 429 || response.status >= 500) {
      const seconds = Number(response.headers.get("Retry-After"));
      throw new HttpError(503, "批改服务当前繁忙，系统将稍后重试，作答已保留。", "PROVIDER_BUSY", Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 5);
    }
    if (!response.ok) {
      throw new HttpError(502, response.status === 401
        ? "DeepSeek 密钥认证失败，请由管理员重新配置。"
        : response.status === 402 ? "DeepSeek 账户余额不足，请由管理员检查。"
        : "DeepSeek 暂时无法完成批改，请稍后重试。", "PROVIDER_ERROR");
    }
    let body: string;
    try {
      body = await response.text();
      if (signal.aborted) throw timeout();
    } catch (error) {
      if (error instanceof HttpError && error.code === "AI_JOB_CANCELLED") throw error;
      // The response body can fail after HTTP headers have already arrived.
      console.warn("Provider transport metadata", JSON.stringify({ requestId, attempt: attempt + 1, thinking, maxTokens: budget, elapsedMs: Date.now() - started, phase: "body", aborted: signal.aborted }));
      if (attempt === 0 && !deadline.aborted) continue;
      throw timeout();
    }
    let metadata: CompletionMetadata = {};
    try {
      const json = parseProviderCompletion(body);
      const choice = json.choices?.[0];
      const content = choice?.message?.content;
      metadata = { finishReason: choice?.finish_reason, completionTokens: json.usage?.completion_tokens,
        reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens,
        contentChars: typeof content === "string" ? content.length : undefined };
      if (choice?.finish_reason !== "stop") throw new ProviderCompletionError(
        choice?.finish_reason === "length" ? "length" : "provider_error", "Unfinished provider answer", metadata,
      );
      if (typeof content !== "string" || !content.trim()) throw new ProviderCompletionError("empty", "Empty provider answer", metadata);
      const parsed: unknown = JSON.parse(content);
      if (deadline.aborted) throw timeout();
      return parsed;
    } catch (error) {
      if (deadline.aborted) throw timeout();
      const reason = error instanceof ProviderCompletionError ? error.reason : "malformed";
      if (error instanceof ProviderCompletionError) metadata = error.metadata;
      console.warn("Provider response metadata", JSON.stringify({ requestId, attempt: attempt + 1, thinking, maxTokens: budget, elapsedMs: Date.now() - started, reason, ...metadata }));
      if (attempt === 0 && retryableCompletion.has(reason)) {
        if (reason === "length" || metadata.finishReason === "length") budget = Math.max(budget, Math.min(budget * 2, 48000));
        continue;
      }
      throw new HttpError(502, invalidMessage, "INVALID_FEEDBACK");
    }
  }
  throw new HttpError(502, invalidMessage, "INVALID_FEEDBACK");
}
