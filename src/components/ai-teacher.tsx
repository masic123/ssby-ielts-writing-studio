"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BookOpen, ChalkboardTeacher, Plus, UserCircle, WarningCircle } from "@phosphor-icons/react";
import type { TeacherMessage, TeacherReply, TeacherSource } from "@/lib/types";
import { api } from "./ui";

type Turn = TeacherMessage & { id: string; sources?: TeacherSource[] };
type Topic = "all" | "Task 1" | "Task 2";
const suggestions: Record<Topic, string[]> = {
  all: ["Simon 建议怎样写 Task 2 的开头？", "只有一个观点，怎样把主体段展开？", "Task 1 的概述应该写什么？", "怎样积累自然的主题词汇搭配？"],
  "Task 1": ["概述和细节段应该怎样分工？", "图表里的数据太多，怎样挑选？", "地图题应该怎样组织段落？", "流程图怎么写才清楚？"],
  "Task 2": ["双边讨论题应该怎样表达立场？", "怎样把一个观点解释充分？", "部分同意的作文怎样组织？", "结尾段怎样写得简短清楚？"],
};

export default function AiTeacher({ loggedIn, active, configured, onLogin }: {
  loggedIn: boolean;
  active: boolean;
  configured: boolean | null;
  onLogin: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState<Topic>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const end = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (active && turns.length) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, turns.length, busy]);

  async function send(text = question, retry = false) {
    if (!loggedIn) { onLogin(); return; }
    if (inFlight.current || (!retry && !text.trim())) return;
    if (configured === false) { setError("AI 老师暂未连接，请稍后再来。"); return; }
    const next: Turn[] = retry ? turns : [...turns, { id: crypto.randomUUID(), role: "user", content: text.trim() }];
    // Keep complete user/assistant pairs and the current question within the context window.
    const context = next.slice(-13).map(({ role, content }) => ({ role, content }));
    while (context.length > 1 && context.reduce((sum, message) => sum + message.content.length, 0) > 26000) context.splice(0, 2);
    inFlight.current = true;
    setBusy(true); setError(""); setFailed(false); setTurns(next); setQuestion("");
    try {
      const reply = await api<TeacherReply>("/api/teacher", { method: "POST", body: JSON.stringify({ task: topic, messages: context }) });
      if (mounted.current) setTurns([...next, { id: crypto.randomUUID(), role: "assistant", content: reply.answer, sources: reply.sources }]);
    } catch (error) {
      if (mounted.current) { setError((error as Error).message); setFailed(true); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function newConversation() {
    setTurns([]); setError(""); setFailed(false); setQuestion(""); composer.current?.focus();
  }
  return (
    <div className="teacher-view">
      <div className="teacher-heading">
        <div className="page-intro">
          <h1>AI 老师</h1>
          
        </div>
        <button className="button secondary" onClick={newConversation} disabled={busy || turns.length === 0}><Plus size={17} />新对话</button>
      </div>
      <div className="teacher-scope-row">
        <div className="teacher-topics" role="group" aria-label="提问范围">
          {(["all", "Task 1", "Task 2"] as const).map((item) => <button key={item} type="button" aria-pressed={topic === item} disabled={busy} onClick={() => setTopic(item)}>{item === "all" ? "全部写作" : item}</button>)}
        </div>
        <span className="teacher-knowledge"><BookOpen size={15} />Simon 方法 · 新东方课堂笔记</span>
      </div>
      <section className="teacher-conversation" aria-label="与 AI 老师的对话">
        {turns.length === 0 ? <div className="teacher-welcome">
          <span className="teacher-emblem"><ChalkboardTeacher size={34} weight="light" /></span>
          <h2>哪里卡住了？</h2>
          <p>审题、展开观点、图表概述，或一句话怎么改。<br />从一个具体的问题开始。</p>
          <div className="teacher-suggestions">
            {suggestions[topic].map((prompt) => <button key={prompt} type="button" onClick={() => void send(prompt)}><span>{prompt}</span><ArrowRight size={16} /></button>)}
          </div>
        </div> : <div className="teacher-turns" role="log" aria-label="对话记录" aria-live="polite" aria-relevant="additions">
          {turns.map((turn) => <article key={turn.id} className={`teacher-turn ${turn.role}`}>
            <div className="teacher-turn-label">{turn.role === "assistant" ? <ChalkboardTeacher size={19} /> : <UserCircle size={19} />}{turn.role === "assistant" ? "AI 老师" : "你"}</div>
            <div className="teacher-message">{turn.content}</div>
            {turn.role === "assistant" && (turn.sources?.length ? <details className="teacher-sources">
              <summary><BookOpen size={14} />参考依据 · {turn.sources.length} 条</summary>
              <ol>{turn.sources.map((source) => <li key={source.id}><b>{source.provider === "simon" ? "Simon 写作书" : "新东方课堂笔记"} · {source.title}</b><span>{source.file || source.section} · 第 {source.page} 页</span></li>)}</ol>
            </details> : <p className="teacher-general-note">本次为一般写作建议，未引用知识库资料。</p>)}
          </article>)}
        </div>}
        {busy && <div className="teacher-thinking" role="status"><ChalkboardTeacher size={19} /><div><span>正在查阅资料，整理回答…</span><i /><i /><i /></div></div>}
        <div ref={end} />
      </section>
      {error && <div className="error-box teacher-error" role="alert"><WarningCircle size={19} /><span>{error}</span>{failed && <button type="button" className="text-button" onClick={() => void send("", true)} disabled={busy}>重试</button>}</div>}
      <form className="teacher-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="teacher-question">向 AI 老师提问</label>
        <textarea id="teacher-question" ref={composer} value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} maxLength={2000} disabled={busy || failed} readOnly={!loggedIn} placeholder={!loggedIn ? "邮箱登录后，即可向 AI 老师提问。" : failed ? "可以重试上一个问题，或开启新对话。" : "说说你的写作问题…"} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} />
        <div className="teacher-composer-bottom"><span>{loggedIn ? "Enter 发送 · Shift + Enter 换行" : "游客可浏览，提问需要登录"}</span><button className="teacher-send" type={loggedIn ? "submit" : "button"} onClick={loggedIn ? undefined : onLogin} disabled={busy || (loggedIn && (!question.trim() || failed))} aria-label={loggedIn ? "发送问题" : "登录后提问"}>{loggedIn ? <ArrowUp size={20} weight="bold" /> : <>邮箱登录<ArrowRight size={16} /></>}</button></div>
      </form>
      <p className="teacher-footnote">刷新后本次对话会清空。</p>
    </div>
  );
}
