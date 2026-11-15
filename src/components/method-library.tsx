"use client";
import { useState } from "react";
import type { MethodRule } from "@/lib/types";
import { methodCriterionLabels, methodProvider, methodSourceLabel } from "@/lib/methods";

export default function MethodLibrary({ methods }: { methods: MethodRule[] }) {
  const [source, setSource] = useState("all");
  const [task, setTask] = useState("all");
  const visible = methods.filter((rule) =>
    (source === "all" || methodProvider(rule) === source) &&
    (task === "all" || rule.task === "all" || rule.task === task),
  );
  return (
    <>
      <div className="method-library-filters">
        <div className="method-filter" role="group" aria-label="按方法来源筛选">
          {[
            ["all", "全部来源"],
            ["simon", "Simon"],
            ["tian-nan", "新东方课堂"],
          ].map(([value, label]) => (
            <button key={value} aria-pressed={source === value} onClick={() => setSource(value)}>
              {label}
              <span>{methods.filter((r) => value === "all" || methodProvider(r) === value).length}</span>
            </button>
          ))}
        </div>
        <div className="method-filter" role="group" aria-label="按写作任务筛选">
          {["all", "Task 2", "Task 1"].map((value) => (
            <button key={value} aria-pressed={task === value} onClick={() => setTask(value)}>
              {value === "all" ? "全部任务" : value}
            </button>
          ))}
        </div>
      </div>
      <p className="small muted method-result-count" aria-live="polite">
        {visible.length} 条方法 · 选择适合本题的做法
      </p>
      <div className="method-library">
        {visible.map((rule, i) => (
          <article key={rule.id}>
            <span className="method-number">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div className="inline-tags">
                <span className="tag subtle">{methodProvider(rule) === "tian-nan" ? "新东方课堂" : "Simon"}</span>
                <span className="tag subtle">{rule.task === "all" ? "Task 1 / Task 2" : rule.task}</span>
              </div>
              <h2>{rule.title}</h2>
              <p className="method-summary">{rule.summary}</p>
              <p>{rule.detail}</p>
              {rule.condition && <p className="method-condition">{rule.condition}</p>}
              {rule.criteria && (
                <p className="method-criteria">{rule.criteria.map((c) => methodCriterionLabels[c]).join(" · ")}</p>
              )}
              <span className="small muted method-source">{methodSourceLabel(rule)}</span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
