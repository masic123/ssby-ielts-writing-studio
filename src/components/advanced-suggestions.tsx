import { advancedSuggestionLabels } from "@/lib/advanced-suggestions";
import type { AdvancedSuggestion } from "@/lib/types";

export default function AdvancedSuggestions({ suggestions = [] }: { suggestions?: AdvancedSuggestion[] }) {
  if (!suggestions.length) return null;
  return (
    <section className="report-section advanced-suggestions" aria-labelledby="advanced-suggestions-heading">
      <h2 id="advanced-suggestions-heading">高分表达进阶</h2>
      <p className="small muted">结合这篇作文练习更准确、自然的表达。原表达正确时，以下替换是可选进阶。</p>
      {(["vocabulary", "phrase", "sentence"] as const).map((kind) => {
        const items = suggestions.filter((s) => s.kind === kind);
        if (!items.length) return null;
        return (
          <div className={`advanced-group advanced-${kind}`} key={kind}>
            <h3>{advancedSuggestionLabels[kind]}</h3>
            <div className="advanced-list">
              {items.map((s, i) => (
                <article key={i}>
                  <div className="advanced-expression"><span>原表达</span><p lang="en">{s.original}</p></div>
                  <div className="advanced-expression advanced-replacement"><span>建议表达</span><p lang="en">{s.replacement}</p></div>
                  <p className="advanced-explanation">{s.explanation}</p>
                  <div className="advanced-expression advanced-example"><span>例句</span><p lang="en">{s.example}</p></div>
                </article>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
