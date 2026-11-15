import type { EssayInput, RecordAttachments } from "./types";
import { HttpError } from "./http";

function chartBytes(input: EssayInput) {
  const image = input.customQuestion?.chartData;
  const match = image?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new HttpError(404, "这份记录没有可读取的题图。");
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  return { mimeType: match[1], bytes };
}

/** A projection only: stored inputs and original image bytes never change. */
export async function recordForView<T extends { input: EssayInput }>(record: T, chartUrl: string): Promise<T & { attachments?: RecordAttachments }> {
  if (!record.input.customQuestion?.chartData) return record;
  const { bytes, mimeType } = chartBytes(record.input);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  return { ...record, input: { ...record.input, customQuestion: { ...record.input.customQuestion, chartData: undefined } },
    attachments: { chart: { url: chartUrl, mimeType, bytes: bytes.length, sha256 } },
  };
}

/** Called only after the same owner check as the corresponding private record. */
export function chartResponse(input: EssayInput) {
  const { bytes, mimeType } = chartBytes(input);
  return new Response(bytes, { headers: { "Content-Type": mimeType, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
