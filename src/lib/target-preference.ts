// Local values are only a fallback and a one-time migration source for a missing account preference.
export const targetDefault = 7;
export const validTarget = (value: number) => Number.isFinite(value) && value >= 4 && value <= 9 && value % 0.5 === 0;
const key = (owner: string | null | undefined) => "judu:target:" + (owner || "guest");
export function readStoredTarget(owner: string | null | undefined): number | null {
  try {
    const raw = localStorage.getItem(key(owner));
    if (raw !== null && validTarget(Number(raw))) return Number(raw);
  } catch {}
  return null;
}
export function readTarget(owner: string | undefined, fallback = targetDefault) {
  return readStoredTarget(owner) ?? (validTarget(fallback) ? fallback : targetDefault);
}
export function rememberTarget(owner: string | null | undefined, value: number) {
  if (validTarget(value)) try { localStorage.setItem(key(owner), String(value)); } catch {}
}
