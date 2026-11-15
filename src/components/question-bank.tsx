"use client";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  MagnifyingGlass,
  BookOpen,
  ChartLineUp,
  ListNumbers,
  PenNib,
  SlidersHorizontal,
  UploadSimple,
} from "@phosphor-icons/react";
import type { Question } from "@/lib/types";
import { questionTitles } from "@/lib/question-titles";
import SelectField from "./select-field";
import { QuestionStatsLine, useQuestionStats } from "./question-stats";
import {
  bookOrder,
  orderedCategories,
  sortQuestionsForSequence,
} from "@/lib/question-bank";

type BankMode = "order" | "task1" | "task2" | "all";

export default function QuestionBank({
  questions,
  onSelect,
  onCustom,
  customDisabled,
  loading = false,
}: {
  questions: Question[];
  onSelect: (q: Question) => void;
  onCustom: () => void;
  customDisabled?: boolean;
  loading?: boolean;
}) {
  const stats = useQuestionStats();
  const byQuestion = useMemo(() => new Map(stats.data?.stats.map(value => [value.questionId, value]) || []), [stats.data]);
  const [mode, setMode] = useState<BankMode>("order");
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);
  const [task, setTask] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [book, setBook] = useState("");
  const [test, setTest] = useState("");
  const [page, setPage] = useState(0);
  const activeTask: Question["task"] | "" = mode === "task1" ? "Task 1" : mode === "task2" ? "Task 2" : mode === "all" && (task === "Task 1" || task === "Task 2") ? task : "";
  const categoryOptions = useMemo(
    () => {
      if (!activeTask) return [];
      return orderedCategories(activeTask, "A");
    },
    [activeTask],
  );
  const bookOptions = useMemo(
    () => bookOrder.filter((value) => questions.some((q) => q.book === value)),
    [questions],
  );
  const testOptions = useMemo(
    () => [...new Set(questions.filter((q) => (!book || (book === "__recall__" ? !q.book : q.book === book))).map((q) => q.test).filter(Boolean))]
      .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, ""))),
    [questions, book],
  );
  const filtered = useMemo(
    () =>
      questions.filter(
        (q) =>
          (!activeTask || q.task === activeTask) &&
          (mode !== "all" || !source || q.sourceType === source) &&
          (!category || q.category === category) &&
          (mode !== "order" || !book || (book === "__recall__" ? !q.book : q.book === book)) &&
          (mode !== "order" || !test || q.test === test) &&
          (!query ||
            `${questionTitles[q.id] || ""} ${q.name} ${q.stem} ${q.topic} ${q.category} ${q.date} ${q.book}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [questions, mode, activeTask, source, category, book, test, query],
  );
  const displayed = useMemo(
    () => mode === "order" ? sortQuestionsForSequence(filtered) : filtered,
    [filtered, mode],
  );
  const pages = Math.max(1, Math.ceil(displayed.length / 12));
  const current = Math.min(page, pages - 1);
  function reset(action: () => void) {
    action();
    setPage(0);
  }
  function changeMode(next: BankMode) {
    reset(() => {
      setMode(next);
      setCategory("");
      setBook("");
      setTest("");
      setTask("");
      setSource("");
      setSearch("");
    });
  }
  const task1Count = questions.filter((q) => q.task === "Task 1").length;
  const task2Count = questions.filter((q) => q.task === "Task 2").length;
  const activeTaskCount = activeTask
    ? questions.filter((q) => q.task === activeTask).length
    : 0;
  return (
    <div className="bank-view">
      <div className="bank-intro-row">
      <div className="page-intro">
        <h1>真题题库</h1>
        
      </div>
      <button className="button secondary" onClick={onCustom} disabled={customDisabled}><UploadSimple size={18} />上传自己的题目</button>
      </div>
      <div className="bank-search">
        <MagnifyingGlass size={21} />
        <input
          aria-label="搜索题库"
          placeholder="搜索关键词、话题、剑桥册数…"
          value={search}
          onChange={(e) => reset(() => setSearch(e.target.value))}
        />
        <span className="key-hint">{loading ? "载入中" : `${questions.length} 题`}</span>
      </div>
      <div className="bank-mode-nav" role="group" aria-label="题库练习方式">
        <button type="button" className={mode === "order" ? "active" : ""} aria-pressed={mode === "order"} onClick={() => changeMode("order")}>
          <ListNumbers size={18} />顺序练习<span>{questions.length}</span>
        </button>
        <button type="button" className={mode === "task1" ? "active" : ""} aria-pressed={mode === "task1"} onClick={() => changeMode("task1")}>
          <ChartLineUp size={18} />Task 1<span>{task1Count}</span>
        </button>
        <button type="button" className={mode === "task2" ? "active" : ""} aria-pressed={mode === "task2"} onClick={() => changeMode("task2")}>
          <PenNib size={18} />Task 2<span>{task2Count}</span>
        </button>
        <button type="button" className={mode === "all" ? "active" : ""} aria-pressed={mode === "all"} onClick={() => changeMode("all")}>
          全部题库<span>{questions.length}</span>
        </button>
      </div>
      {mode === "order" && (
        <div className="sequence-panel">
          <div className="sequence-copy"><strong>按剑雅顺序练习</strong></div>
          <div className="sequence-field"><span>剑雅册数</span><SelectField label="剑雅册数" value={book} onChange={(value) => reset(() => { setBook(value); setTest(""); })} options={[{ value: "", label: "全部题目", meta: `${questions.length} 题` }, ...bookOptions.map((value) => ({ value, label: value.replace("剑", "剑雅 "), meta: `${questions.filter((q) => q.book === value).length} 题` })), { value: "__recall__", label: "历次考试回忆题" }]} /></div>
          <div className="sequence-field"><span>Test</span><SelectField label="Test 顺序" value={test} onChange={(value) => reset(() => setTest(value))} options={[{ value: "", label: "全部 Test" }, ...testOptions.map((value) => ({ value, label: value }))]} /></div>
        </div>
      )}
      {(mode === "task1" || mode === "task2") && (
        <div className="category-panel" aria-label={`${activeTask}题型分类`}>
          <span className="category-panel-label">按题型</span>
          <button type="button" className={!category ? "selected" : ""} aria-pressed={!category} onClick={() => reset(() => setCategory(""))}>全部 <small>{activeTaskCount}</small></button>
          {categoryOptions.map((value) => {
            const count = questions.filter((q) => q.task === activeTask && q.category === value).length;
            return count > 0 ? <button type="button" key={value} className={category === value ? "selected" : ""} aria-pressed={category === value} onClick={() => reset(() => setCategory(value))}>{value}<small>{count}</small></button> : null;
          })}
        </div>
      )}
      <div className="filters">
        {(mode === "all" || mode === "order") && <SlidersHorizontal size={18} />}
        {mode === "all" && <SelectField
          label="写作任务"
          value={task}
          onChange={(value) =>
            reset(() => {
              setTask(value);
              setCategory("");
            })
          }
          options={[{ value: "", label: "全部任务" }, { value: "Task 1", label: "Task 1" }, { value: "Task 2", label: "Task 2" }]}
        />}
        {mode === "all" && <SelectField
          label="题目来源"
          value={source}
          onChange={(value) => reset(() => setSource(value))}
          options={[{ value: "", label: "全部来源" }, ...[...new Set(questions.map((q) => q.sourceType))].map((value) => ({ value, label: value }))]}
        />}
        {(mode === "all" || mode === "order") && <SelectField
          label="题型"
          value={category}
          onChange={(value) => reset(() => setCategory(value))}
          options={[{ value: "", label: "全部题型" }, ...[
            ...new Set(
              questions
                .filter(
                  (q) =>
                    (!activeTask || q.task === activeTask),
                )
                .map((q) => q.category),
            ),
          ].map((value) => ({ value, label: value }))]}
        />}
        {(task || source || category || search || book || test) && (
          <button
            className="text-button"
            onClick={() => {
              setTask("");
              setSource("");
              setCategory("");
              setSearch("");
              setBook("");
              setTest("");
              setPage(0);
            }}
          >
            重置
          </button>
        )}
      </div>
      <div className="results-heading">
        <span>
          {loading ? "正在连接题库…" : <>找到 <b>{displayed.length}</b> 道题目</>}
        </span>
        <span className="small muted">{mode === "order" ? "按顺序排列" : "每道题保留来源链接"}</span>
      </div>
      <p className="bank-stats-note">人数去重，均分取每人首次得分。{stats.error && <> 统计暂时未能{stats.data ? "刷新" : "载入"}。<button type="button" className="text-button" onClick={stats.retry}>重试</button></>}</p>
      {questions.length === 0 ? (
        <div className="empty">
          <BookOpen size={32} />
          <h2>正在载入题库</h2>
          <p>连接恢复后会自动载入。你也可以先上传自己的题目。</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty">
          <MagnifyingGlass size={32} />
          <h2>没有找到匹配的题目</h2>
          <p>试试更短的关键词，或减少筛选条件。</p>
        </div>
      ) : (
        <div className="question-card-grid">
          {displayed.slice(current * 12, current * 12 + 12).map((q) => (
            <button
              className="question-card"
              type="button"
              key={q.id}
              onClick={() => onSelect(q)}
            >
                <span className="question-card-tags">
                  <span className="tag">{q.task}</span>
                  <span className="tag subtle">{q.category}</span>
                  {q.futureDate && (
                    <span className="tag warning">日期待核实</span>
                  )}
                </span>
                <span className="question-card-title" lang="zh-CN">{questionTitles[q.id] || q.topic || q.category}</span>
                <QuestionStatsLine stat={byQuestion.get(q.id)} loaded={!!stats.data} error={stats.error} maxScore={9} />
                <span className="question-card-excerpt" lang="en">{q.stem.split(/\n/)[0]}</span>
                <span className="question-card-footer">
                  <span className="question-card-source">{q.name}<br />{q.sourceType}{q.date ? ` · ${q.date}` : ""}{q.images.length ? " · 含题图" : ""}</span>
                  <ArrowRight size={20} aria-hidden="true" />
                </span>
            </button>
          ))}
        </div>
      )}
      <div className="pagination">
        <button
          className="button secondary"
          onClick={() => {
            setPage(current - 1);
            window.scrollTo({ top: 160, behavior: "smooth" });
          }}
          disabled={current === 0}
        >
          <ArrowLeft size={16} />
          上一页
        </button>
        <span className="small">
          {current + 1} / {pages}
        </span>
        <button
          className="button secondary"
          onClick={() => {
            setPage(current + 1);
            window.scrollTo({ top: 160, behavior: "smooth" });
          }}
          disabled={current >= pages - 1}
        >
          下一页
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
