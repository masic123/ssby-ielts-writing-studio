import { ApiError } from "./api-client";
import type { User } from "./types";

export type AuthSession = { user: User | null; invitationRequired: boolean };
type SessionApi = <T>(url: string, options?: RequestInit) => Promise<T>;
export const SESSION_REQUEST_TIMEOUT_MS = 12_000;
const timeoutMessage = "账号连接超时，正在自动重试。你也可以点击重新连接。";

function failureMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "SESSION_TIMEOUT") return timeoutMessage;
    if (error.code === "INVALID_RESPONSE") return "账号服务响应未完整收到，正在自动重试。";
    return `账号服务暂不可用（HTTP ${error.status}），正在自动重试。`;
  }
  return "账号网络连接中断，正在自动重试。请检查网络后点击重新连接。";
}

/** Abort must release the UI even if the underlying browser request never settles. */
async function readSession(api: SessionApi, controller: AbortController): Promise<AuthSession> {
  const { signal } = controller;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const timeout = setTimeout(() => controller.abort(new ApiError(timeoutMessage, 0, "SESSION_TIMEOUT")), SESSION_REQUEST_TIMEOUT_MS);
  try {
    const session = await Promise.race([api<AuthSession>("/api/auth", { signal }), aborted]);
    if (!session || typeof session.invitationRequired !== "boolean" ||
      (session.user !== null && (typeof session.user?.id !== "string" || !session.user.id ||
        typeof session.user.name !== "string" || typeof session.user.email !== "string")))
      throw new ApiError("Invalid session response", 200, "INVALID_RESPONSE");
    return session;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

export function createSessionRestorer(api: SessionApi, handlers: {
  onSession: (session: AuthSession) => void;
  onFailure: (message: string) => void;
  onExpired: () => void;
}) {
  let active = true, revision = 0, failures = 0;
  let user: User | null = null;
  let pending: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  function cancel() {
    clearTimeout(retry);
    const previous = pending;
    pending = null;
    previous?.abort();
  }
  async function refresh(force = false) {
    if (!active || (pending && !force)) return;
    if (force) { cancel(); failures = 0; }
    clearTimeout(retry);
    const version = revision;
    const controller = new AbortController();
    pending = controller;
    const current = () => active && pending === controller && version === revision;
    try {
      const session = await readSession(api, controller);
      if (!current()) return;
      const expired = !!user && session.user === null;
      user = session.user;
      failures = 0;
      handlers.onSession(session);
      if (expired) handlers.onExpired();
    } catch (error) {
      if (!current()) return;
      // Only a valid guest response proves logout; transport errors preserve the account.
      handlers.onFailure(failureMessage(error));
      retry = setTimeout(() => { void refresh(); }, Math.min(1500 * 3 ** failures++, 60_000));
    } finally {
      if (pending === controller) pending = null;
    }
  }
  return {
    refresh,
    reconnect: () => { void refresh(true); },
    setUser(value: User | null) { revision++; user = value; failures = 0; cancel(); },
    dispose() { active = false; cancel(); },
  };
}
