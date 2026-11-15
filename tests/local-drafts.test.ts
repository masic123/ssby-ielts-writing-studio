import { test } from "node:test";
import assert from "node:assert/strict";
import { readLocalDrafts, writeLocalDraft, type LocalDraft } from "../src/lib/local-drafts";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const draft = (id: string, questionId: number, essay: string, updatedAt: number): LocalDraft => ({
  id, input: { questionId, essay, title: "", targetBand: 7 }, meta: null, updatedAt,
});

test("legacy local work remains recoverable without selecting it or crossing accounts", () => {
  const storage = memoryStorage();
  const old = draft("legacy", 8624, "My saved composition.", 100);
  storage.setItem("judu:draft:alice", JSON.stringify(old));
  const before = storage.getItem("judu:draft:alice");
  assert.deepEqual(readLocalDrafts(storage, "alice"), [old]);
  assert.deepEqual(readLocalDrafts(storage, "bob"), []);
  assert.equal(storage.getItem("judu:draft:alice"), before, "reading must not overwrite or open old work");
  storage.setItem("judu:local-drafts:alice", "not json");
  assert.deepEqual(readLocalDrafts(storage, "alice"), [old], "a damaged newer cache must not hide recoverable legacy work");
  writeLocalDraft(storage, "alice", draft("new", 11723, "A different essay.", 200));
  assert.deepEqual(readLocalDrafts(storage, "alice").map((item) => item.input.essay), ["A different essay.", "My saved composition."]);
  assert.deepEqual(readLocalDrafts(storage, "bob"), []);
});

test("editing or clearing one local exercise keeps other exercises and avoids stale cloud copies", () => {
  const storage = memoryStorage();
  const first = draft("first", 8624, "First composition.", 100);
  const second = draft("second", 11723, "Second composition.", 200);
  writeLocalDraft(storage, "alice", first);
  writeLocalDraft(storage, "alice", second);
  writeLocalDraft(storage, "alice", { ...second, input: { ...second.input, essay: "" }, updatedAt: 300 });
  assert.deepEqual(readLocalDrafts(storage, "alice").map((item) => item.input.essay), ["", "First composition."]);
  const linked = { ...first, meta: { id: "saved-cloud-draft", version: 1 }, updatedAt: 400 };
  writeLocalDraft(storage, "alice", linked);
  writeLocalDraft(storage, "alice", { ...linked, id: "cloud:saved-cloud-draft", meta: { ...linked.meta, version: 2 }, updatedAt: 500 });
  assert.equal(readLocalDrafts(storage, "alice").filter((item) => item.meta?.id === linked.meta.id).length, 1);
  assert.deepEqual(readLocalDrafts(storage, "alice").map((item) => item.input.essay), ["First composition.", ""]);
  storage.setItem("judu:local-drafts:bob", "not json");
  assert.deepEqual(readLocalDrafts(storage, "bob"), []);
});
