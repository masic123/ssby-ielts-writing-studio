import type { DraftHistoryItem, ReviewHistoryItem } from "./types";

/** A delayed list response must not replace work saved while it was loading. */
export function mergeDraftHistory(current: DraftHistoryItem[], received: DraftHistoryItem[]): DraftHistoryItem[] {
  const drafts = new Map(received.map(draft => [draft.id, draft]));
  for (const draft of current) {
    const remote = drafts.get(draft.id);
    if (!remote || draft.version >= remote.version) drafts.set(draft.id, draft);
  }
  return [...drafts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function mergeReviewHistory(current: ReviewHistoryItem[], received: ReviewHistoryItem[]): ReviewHistoryItem[] {
  const reviews = new Map(received.map(review => [review.id, review]));
  for (const review of current) {
    const remote = reviews.get(review.id);
    if (!remote || review.status !== "processing") reviews.set(review.id, review);
  }
  return [...reviews.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
