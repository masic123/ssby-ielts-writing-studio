export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export const API_REQUEST_TIMEOUT_MS = 20_000;
const AI_REQUEST_TIMEOUT_MS = 120_000;

/** Bound the whole response, including JSON, even when the browser ignores abort. */
async function readResponse(url: string, options?: RequestInit) {
  const controller = new AbortController();
  const cancel = () => controller.abort(options?.signal?.reason);
  if (options?.signal?.aborted) cancel();
  else options?.signal?.addEventListener("abort", cancel, { once: true });
  const path = url.split("?")[0];
  const limit = ["/api/questions/parse", "/api/teacher"].includes(path) ? AI_REQUEST_TIMEOUT_MS
    : options?.method?.toUpperCase() === "POST" && ["/api/drafts", "/api/reviews"].includes(path) ? 60_000 : API_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(new ApiError(
    "连接超时，当前输入已保留，请检查网络后重试。", 0, "REQUEST_TIMEOUT",
  )), limit);
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal, credentials: "same-origin", headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
        let data;
        try { data = await response.json(); }
        catch {
          if (controller.signal.aborted) throw controller.signal.reason;
          throw new ApiError("网站响应未完整收到，请重试连接。", response.status, "INVALID_RESPONSE");
        }
        if (!data || typeof data !== "object")
          throw new ApiError("网站响应未完整收到，请重试连接。", response.status, "INVALID_RESPONSE");
        return { response, data };
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

/** A late 401 from an older request must not discard a newly restored session. */
export function createApiClient(expiredEvent: string) {
  let checking: Promise<boolean | undefined> | null = null;
  let expiredNotified = false;
  function checkSession() {
    if (!checking) checking = (async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const data = await Promise.race([
          (async () => {
            const response = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
            return response.ok ? await response.json() : undefined;
          })(),
          new Promise<undefined>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(undefined); }, 12_000); }),
        ]);
        if (!data) return undefined;
        if (data.user === null) return false;
        return typeof data.user?.id === "string" ? true : undefined;
      } catch { return undefined; }
      finally { clearTimeout(timer); }
    })().finally(() => { checking = null; });
    return checking;
  }
  return async function api<T>(url: string, options?: RequestInit): Promise<T> {
    const send = () => readResponse(url, options);
    let { response, data } = await send();
    const authEndpoint = url.split("?")[0].endsWith("/api/auth");
    if (response.status === 401 && !authEndpoint && (!data.code || data.code === "LOGIN_REQUIRED")) {
      const active = await checkSession();
      if (options?.signal?.aborted) throw options.signal.reason;
      if (active) {
        expiredNotified = false;
        ({ response, data } = await send());
      } else if (active === false && !expiredNotified) {
        expiredNotified = true;
        window.dispatchEvent(new Event(expiredEvent));
      }
      // A network failure or upstream credential error does not prove the user logged out.
    }
    if (!response.ok) throw new ApiError(data.error || "操作失败，请稍后重试。", response.status, data.code);
    if (authEndpoint && data.user?.id) expiredNotified = false;
    return data as T;
  };
}
