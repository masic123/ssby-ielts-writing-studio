import { test } from "node:test";
import assert from "node:assert/strict";
import { thinkingOptions } from "../src/lib/provider-thinking";

test("relay feedback explicitly disables reasoning so answer tokens remain available", () => {
  assert.deepEqual(thinkingOptions({ DEEPSEEK_BASE_URL: "https://hgapi.dieqiyun.top/v1/" }, false), {
    thinking: { type: "disabled" }, reasoning_effort: "none",
  });
});
test("relay independent scoring retains high reasoning", () => {
  assert.deepEqual(thinkingOptions({ DEEPSEEK_BASE_URL: "https://hgapi.dieqiyun.top/v1" }, true), {
    thinking: { type: "enabled" }, reasoning_effort: "high",
  });
});
test("native provider and lookalike hosts retain their original request parameters", () => {
  for (const base of [undefined, "https://api.deepseek.com", "https://hgapi.dieqiyun.top.example/v1", "http://hgapi.dieqiyun.top/v1"]) {
    for (const enabled of [false, true]) assert.deepEqual(thinkingOptions({ DEEPSEEK_BASE_URL: base }, enabled), {
      thinking: { type: enabled ? "enabled" : "disabled" },
    });
  }
});
