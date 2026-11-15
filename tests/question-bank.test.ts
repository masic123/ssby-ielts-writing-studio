import { test } from "node:test";
import assert from "node:assert/strict";
import type { Question } from "../src/lib/types";
import { academicTask1Categories, generalTask1Categories, orderedCategories, sortQuestionsForSequence, task2Categories } from "../src/lib/question-bank";

const question = (patch: Partial<Question>): Question => ({
  id: 1, name: "test", task: "Task 2", examType: "A", category: "同意与否题", topic: "", book: "", test: "", date: "", stem: "Question", sourceType: "网站回忆题", sourceUrl: "", futureDate: false, images: [], ...patch,
});

test("question bank exposes task-specific categories in a stable teaching order", () => {
  assert.deepEqual(orderedCategories("Task 1", "A"), academicTask1Categories);
  assert.deepEqual(orderedCategories("Task 1", "G"), generalTask1Categories);
  assert.deepEqual(orderedCategories("Task 2", "A"), task2Categories);
});

test("sequence mode orders Cambridge books, tests and tasks before recall questions", () => {
  const sorted = sortQuestionsForSequence([
    question({ id: 99, book: "", test: "", task: "Task 2" }),
    question({ id: 3, book: "剑20", test: "Test 2", task: "Task 2" }),
    question({ id: 4, book: "剑20", test: "Test 1", task: "Task 2" }),
    question({ id: 5, book: "剑20", test: "Test 1", task: "Task 1" }),
    question({ id: 6, book: "剑21", test: "Test 4", task: "Task 1" }),
  ]);
  assert.deepEqual(sorted.map((item) => item.id), [6, 5, 4, 3, 99]);
});
