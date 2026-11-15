import { test } from "node:test";
import assert from "node:assert/strict";
import { writingOverallBand } from "../src/lib/writing-score";

const keys = ["taskResponse", "coherence", "lexical", "grammar"] as const;
const criteria = (...scores: unknown[]) => Object.fromEntries(keys.map((key, index) => [key, { score: scores[index] }]));

test("writing score floors quarter and eighth averages while retaining exact half bands", () => {
  for (const { scores, expected } of [
    { scores: [6, 6, 6, 7], expected: 6 },
    { scores: [6, 6, 6.5, 7], expected: 6 },
    { scores: [6, 7, 7, 7], expected: 6.5 },
    { scores: [6.5, 7, 7, 7], expected: 6.5 },
    { scores: [6, 6, 7, 7], expected: 6.5 },
    { scores: [6, 6, 6, 6], expected: 6 },
    { scores: [0, 0, 0, 0], expected: 0 },
    { scores: [9, 9, 9, 9], expected: 9 },
  ]) {
    assert.equal(writingOverallBand(criteria(...scores)), expected, `criteria ${scores.join(", ")}`);
  }
});

test("missing or invalid criteria cannot produce a writing score", () => {
  for (const invalid of [
    null,
    undefined,
    {},
    { taskResponse: { score: 6 }, coherence: { score: 6 }, lexical: { score: 6 } },
    criteria(null, 6, 6, 7),
    criteria("6", 6, 6, 7),
    criteria(Number.NaN, 6, 6, 7),
    criteria(Number.POSITIVE_INFINITY, 6, 6, 7),
    criteria(-0.5, 6, 6, 7),
    criteria(9.5, 6, 6, 7),
    criteria(6.25, 6, 6, 7),
  ]) assert.equal(writingOverallBand(invalid), null);
});
