/** Preserve native DeepSeek controls while supporting the configured relay. */
export function thinkingOptions(env: { DEEPSEEK_BASE_URL?: string }, enabled: boolean) {
  const thinking = { type: enabled ? "enabled" : "disabled" };
  let relay = false;
  try {
    relay = new URL(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").origin === "https://hgapi.dieqiyun.top";
  } catch { /* The request path reports invalid provider configuration. */ }
  // This relay needs the standard effort field to disable reasoning. Without
  // it, hidden reasoning can exhaust the feedback response's token budget.
  return relay ? { thinking, reasoning_effort: enabled ? "high" : "none" } : { thinking };
}
