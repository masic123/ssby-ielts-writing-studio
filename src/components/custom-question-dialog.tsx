"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, SpinnerGap, UploadSimple, X } from "@phosphor-icons/react";
import type { Question } from "@/lib/types";
import { customCategories, questionTextFile, type CustomQuestion } from "@/lib/custom-question";
import { customQuestionSchema } from "@/lib/validation";
import { api, Modal } from "./ui";

export default function CustomQuestionDialog({ initial, task, examType, loggedIn, onLogin, onClose, onUse }: {
  initial?: CustomQuestion;
  task: Question["task"];
  examType: Question["examType"];
  loggedIn: boolean;
  onLogin: () => void;
  onClose: () => void;
  onUse: (value: CustomQuestion) => void;
}) {
  const [value, setValue] = useState<CustomQuestion>(() => initial ? { ...initial, examType: "A" } : { stem: "", task, examType: "A" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const [recognized, setRecognized] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function update(patch: Partial<CustomQuestion>) { setValue((old) => ({ ...old, ...patch })); setError(""); }
  async function importText(file?: File) {
    if (!file) return;
    setBusy(true);setError("");
    try {
      const stem = await questionTextFile(file);
      if (alive.current) { update({ stem }); setFilename(file.name); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function importImage(file?: File) {
    if (!file) return;
    setBusy(true);setError("");
    try {
      if (file.size > 1_000_000 || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
        throw new Error("请选择不超过 1MB 的 PNG、JPG、WebP 或 GIF 题图。");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("题图读取失败，请重新选择文件。"));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const image = new Image(); image.src = data;
      await image.decode().catch(() => { throw new Error("无法打开这张图片，请选择有效的题图文件。"); });
      if (alive.current) { update({ chartData: data }); setRecognized(""); }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function recognize() {
    if (!value.chartData || busy) return;
    if (!loggedIn) { onLogin(); return; }
    setBusy(true);setRecognizing(true);setError("");setRecognized("");
    try {
      const result = await api<{ question: Omit<CustomQuestion, "chartData">; uncertain: boolean }>("/api/questions/parse", {
        method: "POST", body: JSON.stringify({ image: value.chartData, task: value.task, examType: value.examType }),
      });
      if (alive.current) {
        update({ ...result.question, category: result.question.category });
        setRecognized(result.uncertain ? "部分文字可能识别不准，请对照原图逐项核对题干和题型。" : "题干已填入下方，请对照原图确认后再使用。");
      }
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) { setBusy(false);setRecognizing(false); } }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = customQuestionSchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "请核对题目内容。"); return; }
    onUse(parsed.data);
  }
  return (
    <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={initial ? "编辑自传题目" : "上传自己的题目"} description="大小作文均支持图片识别，也可粘贴文字或导入 TXT。题目只随你的草稿保存。">
      <form className="form-stack custom-question-form" onSubmit={submit}>
        <div className="custom-image-area">
          <label className="chart-upload">
            <span><UploadSimple size={18} />上传题目图片</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传自己的题目图片" disabled={busy} onChange={(e) => { void importImage(e.target.files?.[0]); e.target.value = ""; }} />
            <small className="muted">PNG、JPG、WebP 或 GIF，最多 1MB。请包含完整题干；每次上传一道题。</small>
            {value.chartData && <img src={value.chartData} alt="自传题目的图片预览" />}
          </label>
          {value.chartData && <div className="custom-image-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => void recognize()}>{recognizing ? <SpinnerGap size={18} className="spin" /> : <FileText size={18} />}{recognizing ? "DeepSeek 正在识别" : loggedIn ? "用 DeepSeek 识别题目" : "登录后用 DeepSeek 识别"}</button>
            <button className="text-button" type="button" disabled={busy} onClick={() => { update({ chartData: undefined }); setRecognized(""); }}><X size={16} />移除图片</button>
          </div>}
          {recognized && <p className="custom-recognition-note" role="status">{recognized}</p>}
        </div>
        <div className="question-import-row">
          <label className="button secondary file-button">
            {busy ? <SpinnerGap size={18} className="spin" /> : <FileText size={18} />}
            导入 TXT 题目
            <input className="file-overlay" type="file" accept=".txt,text/plain" aria-label="导入 TXT 题目文件" disabled={busy} onChange={(e) => { void importText(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <span className="small muted">{filename || "导入题目后，新练习从空白正文开始"}</span>
        </div>
        <label>写作任务
          <select value={value.task} disabled={busy} onChange={(e) => update({ task: e.target.value as "Task 1" | "Task 2", category: undefined })}>
            <option>Task 1</option><option>Task 2</option>
          </select>
        </label>
        <label>题型
          <select value={value.category || ""} disabled={busy} onChange={(e) => update({ category: e.target.value || undefined })}>
            <option value="">暂不确定</option>{customCategories(value.task, value.examType).map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label>英文题干与写作要求
          <textarea required minLength={15} maxLength={6000} rows={6} value={value.stem} disabled={busy} onChange={(e) => update({ stem: e.target.value })} placeholder="粘贴完整英文题目，包括问题和所有要点…" />
          <span className="small muted">{value.stem.length} / 6000 字符 · 请确认题干完整且题型正确</span>
        </label>
        {error && <p className="error-box" role="alert">{error}</p>}
        <button className="button primary full" type="submit" disabled={busy}>{recognizing ? "正在识别，请稍候" : busy ? "正在读取文件" : "确认题目，开始练习"}{!busy && <ArrowRight size={18} />}</button>
      </form>
    </Modal>
  );
}
