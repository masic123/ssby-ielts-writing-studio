import { ApiError } from "./api-client";

/** Independent read recovery; retrying a history list must never lock the editor. */
export function createResourceLoader<T>(read: (signal: AbortSignal) => Promise<T>, handlers: {
  receive: (data: T) => void;
  problem: (error: unknown | null) => void;
}) {
  let active = true, failures = 0, loaded = false;
  let pending: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  async function refresh(force = false) {
    if (!active || (pending && !force)) return;
    clearTimeout(retry);
    if (force) pending?.abort();
    const controller = pending = new AbortController();
    const current = () => active && pending === controller && !controller.signal.aborted;
    try {
      const data = await read(controller.signal);
      if (!current()) return;
      loaded = true; failures = 0;
      handlers.receive(data);
      handlers.problem(null);
    } catch (error) {
      if (!current()) return;
      handlers.problem(error);
      if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500 ||
        error.status === 408 || error.status === 429 || error.code === "INVALID_RESPONSE")
        retry = setTimeout(() => { void refresh(); }, Math.min(1500 * 3 ** failures++, 60_000));
    } finally {
      if (pending === controller) pending = null;
    }
  }
  return {
    start: () => { void refresh(); },
    resume: () => { if (!loaded || failures) void refresh(); },
    reconnect: () => { void refresh(true); },
    dispose() { active = false; clearTimeout(retry); pending?.abort(); pending = null; },
  };
}
