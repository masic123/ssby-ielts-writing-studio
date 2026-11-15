import { z } from "zod";
import { essaySchema } from "./validation";
import type { Draft, EssayInput } from "./types";

export type DraftMeta = Pick<Draft, "id" | "version">;
export type LocalDraft = {
  id: string;
  input: EssayInput;
  meta: DraftMeta | null;
  updatedAt: number;
};
type DraftStorage = Pick<Storage, "getItem" | "setItem">;
const savedDraftSchema = z.object({
  input: essaySchema,
  meta: z.object({ id: z.string().min(1), version: z.number().int().positive() }).nullable(),
  updatedAt: z.number().finite().nonnegative(),
});
const localDraftSchema = savedDraftSchema.extend({ id: z.string().min(1) });
const key = (owner: string) => `judu:local-drafts:${owner}`;

/** Reading saved work never chooses or fills the active writing exercise. */
export function readLocalDrafts(storage: DraftStorage, owner: string): LocalDraft[] {
  try {
    const current = storage.getItem(key(owner));
    if (current !== null) {
      const parsed = z.array(localDraftSchema).safeParse(JSON.parse(current));
      if (parsed.success) return parsed.data.sort((a, b) => b.updatedAt - a.updatedAt);
    }
  } catch {}
  try {
    const legacy = storage.getItem(`judu:draft:${owner}`);
    if (legacy) {
      const parsed = savedDraftSchema.safeParse(JSON.parse(legacy));
      if (parsed.success) return [{ ...parsed.data, id: parsed.data.meta ? `cloud:${parsed.data.meta.id}` : "legacy" }];
    }
  } catch {}
  return [];
}

/** Keep separate exercises so starting with a blank editor does not erase older work. */
export function writeLocalDraft(storage: DraftStorage, owner: string, draft: LocalDraft): LocalDraft[] {
  const drafts = [draft, ...readLocalDrafts(storage, owner).filter((old) =>
    old.id !== draft.id && !(draft.meta && old.meta?.id === draft.meta.id),
  )].sort((a, b) => b.updatedAt - a.updatedAt);
  storage.setItem(key(owner), JSON.stringify(drafts));
  return drafts;
}
