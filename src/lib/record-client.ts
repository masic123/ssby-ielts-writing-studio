import { ApiError } from "./api-client";
import type { Draft, EssayInput, RecordAttachments, Review } from "./types";

export const ATTACHMENT_TIMEOUT_MS = 60_000;
function retryable(error: unknown) {
  return error instanceof TypeError || (error instanceof ApiError &&
    (error.status === 0 || error.status >= 500 || error.status === 408 || error.status === 429 || error.code === "INVALID_RESPONSE"));
}
/** Only reads are retried. The caller owns selection/account cancellation. */
export async function readRecord<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await read(); }
    catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (attempt || !retryable(error)) throw error;
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, 250);
        signal?.addEventListener("abort", cancel, { once: true });
      });
    }
  }
}
export function recordErrorDetail(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "REQUEST_TIMEOUT" || error.code === "ATTACHMENT_TIMEOUT") return "连接超时";
    if (error.code === "INVALID_RESPONSE" || error.code === "ATTACHMENT_INCOMPLETE") return "响应未完整收到";
    return error.status ? `HTTP ${error.status}` : "网络连接中断";
  }
  return "网络连接中断";
}
async function readAttachment(chart: RecordAttachments["chart"], signal?: AbortSignal) {
  if (!chart.url.startsWith("/api/") || chart.url.startsWith("//")) throw new Error("Invalid attachment URL");
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new ApiError("题图读取超时，原草稿仍保留。", 0, "ATTACHMENT_TIMEOUT")), ATTACHMENT_TIMEOUT_MS);
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) onAbort();else controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(chart.url, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new ApiError("题图暂未载入。", response.status);
        return new Uint8Array(await response.arrayBuffer());
      })(), aborted,
    ]);
  } finally { clearTimeout(timer);signal?.removeEventListener("abort", cancel);controller.signal.removeEventListener("abort", onAbort); }
}
async function checkedImage(bytes: Uint8Array<ArrayBuffer>, chart: RecordAttachments["chart"]) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (bytes.length !== chart.bytes || hash !== chart.sha256)
    throw new ApiError("题图未完整收到，原草稿仍保留。", 0, "ATTACHMENT_INCOMPLETE");
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 8192) parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  return `data:${chart.mimeType};base64,${btoa(parts.join(""))}`;
}
/** Editor/rewrite input is usable only after the original image is verified and restored. */
export async function materializeRecord<T extends Draft | Review>(record: T, signal?: AbortSignal): Promise<T> {
  const chart = record.attachments?.chart;
  if (!chart) return record;
  const data = await readRecord(async () => checkedImage(await readAttachment(chart, signal), chart), signal);
  signal?.throwIfAborted();
  const { attachments: _attachments, ...rest } = record;
  return { ...rest, input: { ...record.input, customQuestion: { ...record.input.customQuestion!, chartData: data } } } as T;
}
/** The POST already sent this image; acknowledge it without downloading it again. */
export async function retainSubmittedImage(record: Draft, submitted: EssayInput): Promise<Draft> {
  if (!record.attachments?.chart) return record;
  const source = submitted.customQuestion?.chartData;
  if (!source) throw new Error("Missing submitted image");
  const bytes = Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), char => char.charCodeAt(0));
  await checkedImage(bytes, record.attachments.chart);
  const { attachments: _attachments, ...rest } = record;
  return { ...rest, input: { ...record.input, customQuestion: { ...record.input.customQuestion!, chartData: source } } };
}
