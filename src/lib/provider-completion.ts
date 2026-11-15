export type CompletionFailure = "length" | "incomplete" | "malformed" | "mixed_models" | "provider_error" | "trailing_data" | "empty";
export type CompletionMetadata = {
  finishReason?: string | null;
  completionTokens?: number;
  reasoningTokens?: number;
  contentChars?: number;
  done?: boolean;
};
export class ProviderCompletionError extends Error {
  constructor(public reason: CompletionFailure, message: string, public metadata: CompletionMetadata = {}) {
    super(message);
  }
}

// Both JSON and complete SSE are supported; partial streams never become scores.
export function parseProviderCompletion(text: string) {
  if (text.trimStart().startsWith("{")) {
    try { return JSON.parse(text); }
    catch { throw new ProviderCompletionError("malformed", "Malformed provider response"); }
  }
  let content = "", finish: string | null = null, done = false, seen = false;
  let model: string | undefined;
  let usage: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
  const metadata = (): CompletionMetadata => ({ finishReason: finish, contentChars: content.length, done,
    completionTokens: usage?.completion_tokens, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens });
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    if (data === "[DONE]") { done = true; continue; }
    if (done) throw new ProviderCompletionError("trailing_data", "Data after completed stream", metadata());
    let chunk;
    try { chunk = JSON.parse(data); }
    catch { throw new ProviderCompletionError("malformed", "Malformed provider stream", metadata()); }
    if (chunk.error) throw new ProviderCompletionError("provider_error", "Provider stream failed", metadata());
    if (chunk.usage) usage = chunk.usage;
    if (chunk.model) {
      if (model && model !== chunk.model) throw new ProviderCompletionError("mixed_models", "Mixed models in stream", metadata());
      model = chunk.model;
    }
    const choice = chunk.choices?.find((c: { index?: number }) => c.index === 0);
    if (!choice) continue;
    seen = true;
    if (typeof choice.delta?.content === "string") content += choice.delta.content;
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  if (!done || !seen || !model) throw new ProviderCompletionError("incomplete", "Incomplete provider stream", metadata());
  if (finish !== "stop") throw new ProviderCompletionError(finish === "length" ? "length" : "incomplete", "Incomplete provider stream", metadata());
  if (!content.trim()) throw new ProviderCompletionError("empty", "Incomplete provider stream", metadata());
  return { model, usage, choices: [{ finish_reason: finish, message: { content } }] };
}
