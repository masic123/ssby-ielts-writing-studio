import type { AdvancedSuggestion } from "./types";

export const advancedSuggestionLabels: Record<AdvancedSuggestion["kind"], string> = {
  vocabulary: "词汇进阶",
  phrase: "短语与搭配",
  sentence: "句式进阶",
};

export function advancedSuggestionsText(suggestions: AdvancedSuggestion[] = []) {
  if (!suggestions.length) return "";
  return "## 高分表达进阶\n\n" + suggestions.map((s) =>
    `${advancedSuggestionLabels[s.kind]}\n原表达：${s.original}\n建议表达：${s.replacement}\n用法：${s.explanation}\n例句：${s.example}`,
  ).join("\n\n");
}
