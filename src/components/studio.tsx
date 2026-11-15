"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  BookOpen,
  ChalkboardTeacher,
  Check,
  CheckCircle,
  Clock,
  CloudCheck,
  DownloadSimple,
  FileText,
  FloppyDisk,
  GraduationCap,
  HouseLine,
  Info,
  Moon,
  NotePencil,
  Plus,
  SignOut,
  SpinnerGap,
  Sun,
  Target,
  UploadSimple,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  Draft,
  DraftHistoryItem,
  EssayInput,
  MethodRule,
  Question,
  Review,
  ReviewHistoryItem,
  User,
} from "@/lib/types";
import { wordCount } from "@/lib/types";
import { api, ApiError, AuthDialog } from "./ui";
import CustomQuestionDialog from "./custom-question-dialog";
import { customQuestionDetails, type CustomQuestion } from "@/lib/custom-question";
import QuestionBank from "./question-bank";
import Report, { downloadText } from "./report";
import MethodLibrary from "./method-library";
import { hasOutline } from "@/lib/outline";
import { simonCourse } from "@/lib/resources";
import AiTeacher from "./ai-teacher";
import SelectField from "./select-field";
import FriendSiteLink from "./friend-site-link";
import FontSizeControl from "./font-size-control";
import StudioMotion from "./studio-motion";
import Leaderboard from "./leaderboard";
import MobileNavigation from "./mobile-navigation";
import { useTargetPreference } from "@/lib/use-target-preference";
import { useAuthSession } from "@/lib/use-auth-session";
import { readLocalDrafts, writeLocalDraft, type DraftMeta, type LocalDraft } from "@/lib/local-drafts";
import { createReviewViewState, pollReview, reviewProgress } from "@/lib/review-progress";
import { createDraftSaveFlight, reconcileLocalDraftMeta, sameDraftInput, savedDraftSwitchStatus } from "@/lib/draft-save-client";
import { createResourceLoader } from "@/lib/resource-loader";
import { mergeDraftHistory, mergeReviewHistory } from "@/lib/history-merge";
import { materializeRecord, readRecord, recordErrorDetail, retainSubmittedImage } from "@/lib/record-client";
type View = "writer" | "bank" | "history" | "methods" | "report" | "teacher";
const fresh = (id: number, targetBand = 7): EssayInput => ({
  questionId: id,
  essay: "",
  targetBand,
  title: "",
});
const dateLabel = (date: string) =>
  new Date(date).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function Studio({
  initialQuestion,
  methods: initialMethods,
  total: initialTotal,
}: {
  initialQuestion: Question;
  methods: MethodRule[];
  total: number;
}) {
  const [view, setView] = useState<View>("writer");
  const { user, setUser, authLoaded, authError, invitation, reconnect } = useAuthSession(api, "judu:session-expired");
  const [loginOpen, setLoginOpen] = useState(false);
  useEffect(() => { if (user) setLoginOpen(false); }, [user?.id]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([initialQuestion]);
  const [methods, setMethods] = useState<MethodRule[]>(initialMethods);
  const [bankReady, setBankReady] = useState(false);
  const total = bankReady ? questions.length : initialTotal;
  const [resourceErrors, setResourceErrors] = useState<Record<string, string>>({});
  const resourceReconnect = useRef(new Set<() => void>());
  function resourceProblem(name: string, message: string) {
    setResourceErrors(old => ({ ...old, [name]: message }));
  }
  function reconnectResources() { for (const retry of resourceReconnect.current) retry(); }
  function reconnectAll() { reconnect(); reconnectResources(); }
  const [input, setInput] = useState<EssayInput>(fresh(initialQuestion.id));
  const [hydrated, setHydrated] = useState(false);
  const [draftMeta, setDraftMeta] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [drafts, setDrafts] = useState<DraftHistoryItem[]>([]);
  const [localCache, setLocalCache] = useState<{ owner: string; drafts: LocalDraft[] } | null>(null);
  const localDrafts = localCache?.owner === user?.id ? localCache?.drafts || [] : [];
  const recoverableLocalDrafts = localDrafts.filter((draft) =>
    (draft.input.essay.trim() || hasOutline(draft.input.outline) || draft.input.customQuestion) &&
    !drafts.some((cloud) => cloud.id === draft.meta?.id && sameDraftInput(cloud.input, draft.input)),
  );
  const [reviews, setReviews] = useState<ReviewHistoryItem[]>([]);
  const [historyReady, setHistoryReady] = useState({ drafts: false, reviews: false });
  const [openingReview, setOpeningReview] = useState<string | null>(null);
  const [openingDraft, setOpeningDraft] = useState<string | null>(null);
  const reportRequest = useRef<AbortController | null>(null);

  const [selectedReview, setSelectedReviewState] = useState<Review | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewConnectionNotice, setReviewConnectionNotice] = useState("");
  const [localSaved, setLocalSaved] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draftConflict, setDraftConflict] = useState<{ scope: string; message: string } | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [vision, setVision] = useState(true);
  const [theme, setTheme] = useState("system");
  const [customOpen, setCustomOpen] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerOn, setTimerOn] = useState(false);
  const [focus, setFocus] = useState(false);
  const generation = useRef(0);
  const shell = useRef<HTMLDivElement>(null);
  const reviewView = useRef(createReviewViewState());
  const draftScope = useRef(0);
  const draftSaveFlight = useRef(createDraftSaveFlight<Draft | undefined>());
  const ownerRef = useRef(user?.id ?? null);
  ownerRef.current = user?.id ?? null;
  const localExerciseId = useRef<string | null>(null);
  const switchingExercise = useRef<object | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const targetPreference = useTargetPreference(user?.id ?? null, authLoaded, api, (target, owner) => {
    if (ownerRef.current !== owner || inputRef.current.targetBand === target) return;
    const next = { ...inputRef.current, targetBand: target };
    inputRef.current = next;
    setInput(next);
  });
  const metaRef = useRef(draftMeta);
  function currentReviewScope() { return `${ownerRef.current}:${generation.current}`; }
  function selectReview(review: Review | null) {
    const scope = currentReviewScope();
    reviewView.current.choose(scope, review);
    setSelectedReviewState(review);
    setReviewConnectionNotice("");
    setReviewing(reviewView.current.busy(scope));
  }
  function currentDraftScope() { return `${ownerRef.current}:${generation.current}:${draftScope.current}`; }
  function changeDraftMeta(meta: DraftMeta | null) {
    metaRef.current = meta;
    setDraftMeta(meta);
  }
  function changeDraftContext() {
    draftScope.current++;
    setDraftConflict(null);
    setSaving(false);
    switchingExercise.current = null;
  }
  function draftSwitchSnapshot() { return { scope: currentDraftScope(), input: structuredClone(inputRef.current) }; }
  function canSwitchDraft(snapshot: ReturnType<typeof draftSwitchSnapshot>) {
    const status = savedDraftSwitchStatus(snapshot, { scope: currentDraftScope(), input: inputRef.current });
    if (status === "changed") showMessage("保存期间有新输入，已保留最新作答。请重试切换练习。");
    return status === "ready";
  }
  const requestRef = useRef<{ signature: string; key: string } | null>(null);
  const textImport = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const selectedQuestion = useMemo<Question>(
    () =>
      input.questionId === null && !user
        ? initialQuestion
        : input.questionId === null
        ? customQuestionDetails(input.customQuestion || { stem: "", task: "Task 2", examType: "A" })
        : questions.find((q) => q.id === input.questionId) || initialQuestion,
    [input.questionId, input.customQuestion, questions, initialQuestion, user],
  );
  const words = user ? wordCount(input.essay) : 0;
  const minimum = selectedQuestion.task === "Task 2" ? 250 : 150;
  const paragraphCount = user && input.essay.trim()
    ? input.essay.trim().split(/\n\s*\n/).length
    : 0;
  useEffect(() => {
    const onExpired = () => {
      generation.current++;
      changeDraftContext();
      setUser(null);
      setHydrated(false);
      setTimerOn(false);
      setError("登录已失效，已返回游客浏览。请重新登录继续练习。");
    };
    window.addEventListener("judu:session-expired", onExpired);
    return () => {
      window.removeEventListener("judu:session-expired", onExpired);
    };
  }, [setUser]);
  useEffect(() => {
    const resources = [
      createResourceLoader(signal => api<{ configured: boolean; vision: boolean }>("/api/config", { signal }), {
        receive(config) { setConfigured(config.configured); setVision(config.vision); },
        problem(error) { resourceProblem("config", error ? "服务配置暂未载入，正在自动重试。" : ""); },
      }),
      createResourceLoader(signal => api<{ questions: Question[] }>("/api/questions", { signal }), {
        receive(library) { setQuestions(library.questions.filter(question => question.examType === "A")); setBankReady(true); },
        problem(error) { resourceProblem("questions", error ? "题库暂未载入，正在自动重试。你仍可上传自己的题目。" : ""); },
      }),
      createResourceLoader(signal => api<{ methods: MethodRule[] }>("/api/methods", { signal }), {
        receive(teaching) { setMethods(teaching.methods); },
        problem(error) { resourceProblem("methods", error ? "写作方法暂未同步，正在自动重试。" : ""); },
      }),
    ];
    const reconnect = () => resources.forEach(resource => resource.reconnect());
    const resume = () => { if (document.visibilityState !== "hidden") resources.forEach(resource => resource.resume()); };
    resourceReconnect.current.add(reconnect);
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", resume);
    resources.forEach(resource => resource.start());
    return () => {
      resources.forEach(resource => resource.dispose());
      resourceReconnect.current.delete(reconnect);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", resume);
    };
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("judu:theme");
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.dataset.theme = saved;
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!authLoaded) return;
    generation.current++;
    changeDraftContext();
    setHydrated(false);
    setDrafts([]);
    setReviews([]);
    setHistoryReady({ drafts: false, reviews: false });
    reportRequest.current?.abort();
    reportRequest.current = null;
    setOpeningReview(null);
    setOpeningDraft(null);
    selectReview(null);
    changeDraftMeta(null);
    setLocalSaved(false);
    setLocalCache(null);
    localExerciseId.current = null;
    inputRef.current = fresh(initialQuestion.id, targetPreference.current());
    setInput(inputRef.current);
    setTimerOn(false);
    setTimerSeconds(0);
    resourceProblem("drafts", "");
    resourceProblem("reviews", "");
    if (!user) {
      setHydrated(true);
      setTimerOn(false);
      setReviewing(false);
      setSaving(false);
      setCustomOpen(false);
      return;
    }
    try {
      setLocalCache({ owner: user.id, drafts: readLocalDrafts(localStorage, user.id) });
    } catch {}
    // Local work is ready now; cloud history synchronizes independently in the background.
    setHydrated(true);
    const resources = [
      createResourceLoader(signal => api<{ drafts: DraftHistoryItem[] }>("/api/drafts?summary=1", { signal }), {
        receive(data) { if (ownerRef.current === user.id) { setDrafts(old => mergeDraftHistory(old, data.drafts)); setHistoryReady(old => ({ ...old, drafts: true })); } },
        problem(error) { if (ownerRef.current === user.id) resourceProblem("drafts", error ? `云端草稿暂未同步（${recordErrorDetail(error)}），正在自动重试。本机草稿可从“我的练习”打开。` : ""); },
      }),
      createResourceLoader(signal => api<{ reviews: ReviewHistoryItem[] }>("/api/reviews?summary=1", { signal }), {
        receive(data) { if (ownerRef.current === user.id) { setReviews(old => mergeReviewHistory(old, data.reviews)); setHistoryReady(old => ({ ...old, reviews: true })); } },
        problem(error) { if (ownerRef.current === user.id) resourceProblem("reviews", error ? "批改记录暂未同步，正在自动重试。可以继续写作和上传题目。" : ""); },
      }),
    ];
    const reconnect = () => resources.forEach(resource => resource.reconnect());
    const resume = () => { if (document.visibilityState !== "hidden") resources.forEach(resource => resource.resume()); };
    resourceReconnect.current.add(reconnect);
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", resume);
    resources.forEach(resource => resource.start());
    return () => {
      resources.forEach(resource => resource.dispose());
      reportRequest.current?.abort();
      resourceReconnect.current.delete(reconnect);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", resume);
    };
  }, [user?.id, authLoaded, initialQuestion.id]);
  useEffect(() => {
    const exerciseId = localExerciseId.current;
    if (!hydrated || !user || !exerciseId) return;
    setLocalSaved(false);
    const persist = () => {
      try {
        const drafts = writeLocalDraft(localStorage, user.id, { id: exerciseId, input, meta: draftMeta, updatedAt: Date.now() });
        setLocalCache({ owner: user.id, drafts });
        setLocalSaved(true);
      } catch {
        setLocalSaved(false);
      }
    };
    const timeout = setTimeout(persist, 600);
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);
    return () => {
      clearTimeout(timeout);
      persist();
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", persist);
    };
  }, [input, draftMeta, hydrated, user?.id]);
  useEffect(() => {
    if (!timerOn) return;
    const start = Date.now() - timerSeconds * 1000;
    const interval = setInterval(
      () => setTimerSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [timerOn]); // elapsed time survives pauses
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    setReviewConnectionNotice("");
    if (!user || !selectedReview || selectedReview.status !== "processing") return;
    const scope = currentReviewScope();
    const token = reviewView.current.capture(scope, selectedReview.id);
    if (!token) return;
    const expectedReviewId = selectedReview.id;
    return pollReview<Review>({
      read: async (signal) => (await api<{ review: Review }>(`/api/reviews?id=${encodeURIComponent(expectedReviewId)}&view=report`, { signal })).review,
      receive: (review) => {
        if (review.id !== expectedReviewId || !reviewView.current.accept(token, review, currentReviewScope())) return;
        setSelectedReviewState(review);
        setReviews((old) => [review, ...old.filter((r) => r.id !== review.id)]);
        setReviewing(reviewView.current.busy(currentReviewScope()));
        if (review.status !== "processing") requestRef.current = null;
      },
      problem: (message, stopped) => {
        if (!reviewView.current.owns(token, currentReviewScope())) return;
        setReviewConnectionNotice(message);
        if (stopped) {
          reviewView.current.block(token, currentReviewScope());
          setReviewing(reviewView.current.busy(currentReviewScope()));
        }
      },
      visible: () => document.visibilityState === "visible",
    });
  }, [user?.id, selectedReview?.id, selectedReview?.status]);

  function navigate(next: View) {
    reportRequest.current?.abort();
    reportRequest.current = null;
    setOpeningReview(null);
    setOpeningDraft(null);
    setView(next);
    setFocus(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function update(patch: Partial<EssayInput>) {
    if (!user) { setLoginOpen(true); return; }
    localExerciseId.current ||= crypto.randomUUID();
    const next = { ...inputRef.current, ...patch, targetBand: targetPreference.current() };
    inputRef.current = next;
    setInput(next);
    setError("");
  }
  function showMessage(message: string) {
    setNotice(message);
    setError("");
  }
  async function save(snapshot = inputRef.current, options: { copy?: boolean } = {}): Promise<Draft | undefined> {
    if (!user) {
      setLoginOpen(true);
      return;
    }
    const scope = currentDraftScope();
    const meta = options.copy ? null : metaRef.current;
    const payload = { input: structuredClone(snapshot), ...(meta ? { id: meta.id, version: meta.version } : {}) };
    const body = JSON.stringify(payload);
    return draftSaveFlight.current.run(scope, body, async () => {
      if (scope !== currentDraftScope()) return;
      setSaving(true);
      try {
        const response = await api<{ draft: Draft }>("/api/drafts?view=editor", { method: "POST", body });
        const result = { draft: await retainSubmittedImage(response.draft, payload.input) };
        if (scope !== currentDraftScope()) return;
        changeDraftMeta({ id: result.draft.id, version: result.draft.version });
        setDraftConflict(null);
        setDrafts((old) => [result.draft, ...old.filter((d) => d.id !== result.draft.id)]);
        return result.draft;
      } catch (error) {
        if (scope !== currentDraftScope()) return;
        if (error instanceof ApiError && error.code === "DRAFT_CONFLICT") {
          const message = "云端草稿已有其他版本，当前作答已保留。可以另存当前草稿，保留两个版本。";
          setDraftConflict({ scope, message });
          throw new ApiError(message, error.status, error.code);
        }
        throw error;
      } finally {
        if (scope === currentDraftScope()) setSaving(false);
      }
    });
  }
  async function saveConflictCopy() {
    if (!draftConflict || draftConflict.scope !== currentDraftScope()) return;
    setError("");
    try {
      if (await save(inputRef.current, { copy: true })) showMessage("当前作答已另存为新草稿，云端原稿保持不变。");
    } catch (error) { setError((error as Error).message); }
  }
  async function manualSave() {
    setError("");
    try {
      if (await save()) showMessage("草稿已保存到你的账号。");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function submitReview() {
    if (!user) {
      setLoginOpen(true);
      return;
    }
    if (reviewing || reviewView.current.busy(currentReviewScope()) || saving || draftSaveFlight.current.busy(currentDraftScope())) return;
    if (words < 30) {
      setError("请至少写 30 个英文单词再提交批改。");
      editor.current?.focus();
      return;
    }
    if (configured === false) {
      setError("批改服务尚未配置。你仍然可以保存草稿，稍后再来批改。");
      return;
    }
    setError("");
    const snapshot = structuredClone(inputRef.current);
    const id = generation.current;
    const submission = reviewView.current.beginSubmission(currentReviewScope());
    setReviewing(true);
    setTimerOn(false);
    try {
      const saved = await save(snapshot);
      if (!saved || id !== generation.current) {
        if (id === generation.current) {
          reviewView.current.finishSubmission(submission, undefined, currentReviewScope());
          setReviewing(reviewView.current.busy(currentReviewScope()));
        }
        return;
      }
      const signature = JSON.stringify(snapshot);
      if (requestRef.current?.signature !== signature)
        requestRef.current = { signature, key: crypto.randomUUID() };
      const result = await api<{ review: Review }>("/api/reviews?view=report", {
        method: "POST",
        body: JSON.stringify({
          input: snapshot,
          draftId: saved.id,
          requestKey: requestRef.current!.key,
        }),
      });
      if (id !== generation.current) return;
      const selected = reviewView.current.finishSubmission(submission, result.review, currentReviewScope());
      setReviews((old) => [result.review, ...old.filter((r) => r.id !== result.review.id)]);
      setReviewing(reviewView.current.busy(currentReviewScope()));
      if (selected) {
        setSelectedReviewState(result.review);
        navigate("report");
      }
      if (result.review.status !== "processing") requestRef.current = null;
    } catch (error) {
      if (id === generation.current) {
        const current = reviewView.current.finishSubmission(submission, undefined, currentReviewScope());
        if (current) setError((error as Error).message);
        setReviewing(reviewView.current.busy(currentReviewScope()));
        requestRef.current = null;
        api<{ reviews: ReviewHistoryItem[] }>("/api/reviews?summary=1")
          .then((r) => { if (id === generation.current) { setReviews(old => mergeReviewHistory(old, r.reviews)); setHistoryReady(old => ({ ...old, reviews: true })); } })
          .catch(() => {});
      }
    }
  }
  async function openExercise(next: EssayInput, meta: DraftMeta | null = null, localId: string | null = null) {
    if (!hydrated || reviewing || saving || draftSaveFlight.current.busy(currentDraftScope()) || switchingExercise.current) {
      showMessage("请等待当前操作完成后再切换练习。");
      return false;
    }
    const beforeSwitch = draftSwitchSnapshot();
    const transition = {};
    switchingExercise.current = transition;
    try {
      if (user && (beforeSwitch.input.essay.trim() || hasOutline(beforeSwitch.input.outline))) await save(beforeSwitch.input);
      if (!canSwitchDraft(beforeSwitch)) return false;
      changeDraftContext();
      localExerciseId.current = localId;
      const nextWithTarget = { ...next, targetBand: targetPreference.current() };
      inputRef.current = nextWithTarget;
      changeDraftMeta(meta);
      setInput(nextWithTarget);
      setLocalSaved(false);
      requestRef.current = null;
      setTimerOn(false);
      setTimerSeconds(0);
      navigate("writer");
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      if (switchingExercise.current === transition) switchingExercise.current = null;
    }
  }
  async function newExercise() {
    if (!user) { setLoginOpen(true); return; }
    await openExercise(fresh(initialQuestion.id, targetPreference.current()));
  }
  async function chooseQuestion(q: Question) {
    if (!user) {
      await openExercise(fresh(q.id));
      return;
    }
    await openExercise(fresh(q.id, targetPreference.current()));
  }
  async function openSavedDraft(draft: DraftHistoryItem) {
    if (reviewing || saving || draftSaveFlight.current.busy(currentDraftScope()) || switchingExercise.current) { showMessage("请等待当前操作完成后再切换草稿。"); return; }
    if (metaRef.current?.id === draft.id) { navigate("writer"); return; }
    reportRequest.current?.abort();
    const controller = reportRequest.current = new AbortController();
    const owner = ownerRef.current, version = generation.current;
    setOpeningDraft(draft.id);setError("");
    try {
      const response = await readRecord(() => api<{ draft: Draft }>(`/api/drafts?id=${encodeURIComponent(draft.id)}&view=editor`, { signal: controller.signal }), controller.signal);
      const full = await materializeRecord(response.draft, controller.signal);
      if (controller.signal.aborted || ownerRef.current !== owner || generation.current !== version) return;
      await openExercise(full.input, { id: full.id, version: full.version }, `cloud:${full.id}`);
    } catch (error) {
      if (!controller.signal.aborted && ownerRef.current === owner) setError(`草稿暂未完整载入（${recordErrorDetail(error)}），已自动重试，原作答仍保留。请点击该条草稿重试。`);
    } finally { if (reportRequest.current === controller) { reportRequest.current = null;setOpeningDraft(null); } }
  }
  async function openLocalDraft(draft: LocalDraft) {
    if (reviewing || saving || draftSaveFlight.current.busy(currentDraftScope()) || switchingExercise.current) { showMessage("请等待当前操作完成后再切换草稿。"); return; }
    if (localExerciseId.current === draft.id) { navigate("writer"); return; }
    const restored = reconcileLocalDraftMeta(draft, drafts);
    if (await openExercise(draft.input, restored.meta, draft.id) && restored.detached)
      showMessage("本机作答已保留；下次保存会另存为新草稿，云端原稿保持不变。");
  }
  async function logout() {
    if (reviewing || saving || draftSaveFlight.current.busy(currentDraftScope())) return;
    try {
      await api("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "logout" }),
      });
      generation.current++;
      setHydrated(false);
      setTimerOn(false);
      setUser(null);
      navigate("writer");
      showMessage("已退出账号，当前为游客浏览。");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function importEssay(file?: File) {
    if (!user) { setLoginOpen(true); return; }
    if (!file) return;
    if (file.size > 120000) {
      setError("文本文件太大，请选择不超过 120KB 的 TXT 文件。");
      return;
    }
    const scope = currentDraftScope();
    const text = await file.text();
    if (scope !== currentDraftScope()) return;
    if (text.length > 30000) {
      setError("作文最多支持 30000 个字符。");
      return;
    }
    update({ essay: text });
    showMessage("正文已从文本文件导入。");
  }
  async function saveCustom(value: CustomQuestion) {
    if (!user) { setLoginOpen(true); return; }
    const current = inputRef.current;
    if (current.questionId === null && current.customQuestion?.stem === value.stem && current.customQuestion.task === value.task) {
      update({ customQuestion: value });
    } else if (!await openExercise({ ...fresh(initialQuestion.id, targetPreference.current()), questionId: null, customQuestion: value }, null, crypto.randomUUID())) return;
    setCustomOpen(false);
    navigate("writer");
    showMessage("自传题目已准备好，可以开始写作。");
  }
  async function openReviewRecord(record: ReviewHistoryItem) {
    reportRequest.current?.abort();
    const controller = reportRequest.current = new AbortController();
    const owner = ownerRef.current, version = generation.current;
    setOpeningReview(record.id);
    setError("");
    try {
      const result = await readRecord(() => api<{ review: Review }>(`/api/reviews?id=${encodeURIComponent(record.id)}&view=report`, { signal: controller.signal }), controller.signal);
      if (controller.signal.aborted || ownerRef.current !== owner || generation.current !== version) return;
      selectReview(result.review);
      navigate("report");
    } catch (error) {
      if (!controller.signal.aborted && ownerRef.current === owner && generation.current === version)
        setError(`报告暂未完整载入（${recordErrorDetail(error)}），已自动重试，记录仍保存在账号中。请点击该条记录重试。`);
    } finally {
      if (reportRequest.current === controller) { reportRequest.current = null; setOpeningReview(null); }
    }
  }
  async function rewriteReview(record: Review) {
    if (reviewing) { showMessage("当前批改尚未完成，请稍候。"); return; }
    reportRequest.current?.abort();
    const controller = reportRequest.current = new AbortController();
    const owner = ownerRef.current, version = generation.current;
    setOpeningReview(record.id);setError("");
    try {
      const full = await materializeRecord(record, controller.signal);
      if (controller.signal.aborted || ownerRef.current !== owner || generation.current !== version) return;
      await openExercise({ ...full.input, targetBand: targetPreference.current(), title: `${full.input.title || full.question.name} · 再练一次` }, null, crypto.randomUUID());
    } catch (error) {
      if (!controller.signal.aborted && ownerRef.current === owner) setError(`题图暂未载入（${recordErrorDetail(error)}），原报告仍保留。请重试“重新写这道题”。`);
    } finally { if (reportRequest.current === controller) { reportRequest.current = null;setOpeningReview(null); } }
  }
  function toggleTheme() {
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("judu:theme", next);
    } catch {}
  }
  const navItems = [
    { id: "writer" as const, label: "写作练习", icon: NotePencil },
    { id: "bank" as const, label: "真题题库", icon: BookOpen },
    { id: "teacher" as const, label: "AI 老师", icon: ChalkboardTeacher },
    { id: "history" as const, label: "我的练习", icon: Clock },
    { id: "methods" as const, label: "写作方法", icon: GraduationCap },
  ];
  return (
    <div ref={shell} className={`app-shell ${focus ? "focus-mode" : ""}`} data-scene={view}>
      <StudioMotion root={shell} scene={view} questionKey={`${selectedQuestion.id}:${selectedQuestion.stem}`} />
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <a href="/" className="brand" aria-label="莎试笔雅写作练习室首页">
          <span className="brand-mark">
            <NotePencil size={26} weight="light" />
          </span>
          <span>
            <b className="brand-name">莎试笔雅</b>
          </span>
        </a>
        <div className="sidebar-divider" />
        <nav aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id || (view === "report" && item.id === "history") ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon
                size={21}
                weight={view === item.id ? "fill" : "regular"}
              />
              <span>{item.label}</span>
              {item.id === "bank" && <small>{total}</small>}
            </button>
          ))}
        </nav>
        <Leaderboard placement="sidebar" user={user} refreshKey={reviews.filter(r => r.status === "completed").map(r => r.id).join(",")} />
        <div className="sidebar-bottom">
          <button className="theme-control" onClick={toggleTheme}>
            <Sun size={18} />
            <span>切换明暗主题</span>
            <Moon size={15} />
          </button>
          {user ? <div className="user-card">
              <span className="avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <b>{user.name}</b>
                <small title={user.email}>{user.email}</small>
              </div>
              <button
                className="icon-button"
                aria-label="退出账号"
                disabled={reviewing || saving}
                onClick={logout}
              >
                <SignOut size={18} />
              </button>
            </div>
            : <button className="user-card login-button" disabled={!authLoaded} onClick={() => setLoginOpen(true)}>
              <UserCircle size={32} weight="light" />
              <span><b>{authLoaded ? "游客浏览" : "正在恢复登录…"}</b><small>{authLoaded ? "邮箱登录后开始练习" : ""}</small></span><ArrowRight size={18} />
            </button>}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <HouseLine size={17} />
            <span>莎试笔雅</span>
            <span className="slash">/</span>
            <b>
              {
                {
                  writer: "写作练习",
                  bank: "真题题库",
                  history: "我的练习",
                  methods: "写作方法",
                  report: "批改报告",
                  teacher: "AI 老师",
                }[view]
              }
            </b>
          </div>
          <div className="topbar-right">
            <FontSizeControl />
            <FriendSiteLink />
            <button type="button" className="mobile-account icon-button" disabled={!authLoaded} aria-label={user ? "账号与设置" : "登录账号"} onClick={() => user ? setMobileMenuOpen(true) : setLoginOpen(true)}><UserCircle size={23} /></button>
          </div>
        </header>
        <MobileNavigation items={navItems} view={view} onNavigate={navigate} open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} user={user} onLogin={() => setLoginOpen(true)} onLogout={() => void logout()} onTheme={toggleTheme} busy={reviewing || saving} />
        <main id="main" className="workspace">
          {authLoaded && !user && <div className="guest-notice">
            <span><UserCircle size={19} />登录后保存和批改</span>
            <button className="text-button" onClick={() => setLoginOpen(true)}>登录 / 注册<ArrowRight size={16} /></button>
          </div>}
          {authError && <div className="error-box workspace-error" role="alert">
            <WarningCircle size={20} /><span>{authError}</span>
            <button className="text-button" onClick={reconnectAll}>重新连接</button>
          </div>}
          {Object.values(resourceErrors).some(Boolean) && <div className="error-box workspace-error" role="alert">
            <WarningCircle size={20} /><span>{Object.values(resourceErrors).filter(Boolean).join(" ")}</span>
            <button className="text-button" onClick={reconnectResources}>重试加载</button>
          </div>}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle size={19} />
              {notice}
              <button
                className="icon-button"
                aria-label="关闭提示"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {draftConflict && draftConflict.scope === currentDraftScope() && (
            <div className="error-box workspace-error" role="alert">
              <WarningCircle size={20} />
              <span>{draftConflict.message}</span>
              <button className="text-button" disabled={saving || reviewing} onClick={() => void saveConflictCopy()}>另存当前草稿</button>
            </div>
          )}
          {error && error !== draftConflict?.message && (
            <div className="error-box workspace-error" role="alert">
              <WarningCircle size={20} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="关闭错误提示"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {view === "writer" && (
            <div className="writer-view">
              <div className="home-intro-row">
              <div className="page-intro writer-intro">
                <h1>写作练习</h1>
                <div className="writer-context"><span>{selectedQuestion.examType === "A" ? "学术类" : "培训类"}</span><b>{selectedQuestion.task}</b></div>
              </div>
              {!focus && <Leaderboard placement="mobile" user={user} refreshKey={reviews.filter(r => r.status === "completed").map(r => r.id).join(",")} />}
              </div>
              <div className="practice-toolbar" aria-label="练习设置">
                <div className="practice-target">
                  <label htmlFor="target" title="用于目标改稿和提升建议，原文按实际水平评分"><Target size={18} />我的目标</label>
                  <div className="practice-target-control" style={{ display: "grid", gap: 5, maxWidth: 220 }}>
                  <SelectField
                    id="target"
                    label="我的目标"
                    value={String(input.targetBand)}
                    onChange={(value) => targetPreference.choose(Number(value))}
                    disabled={reviewing || !authLoaded || !hydrated}
                    options={[4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map((band) => ({ value: String(band), label: `目标 ${band.toFixed(1)} 分` }))}
                  />
                    <small className={`target-sync-status${targetPreference.status === "error" ? " is-error" : ""}`} role="status">{targetPreference.message}{targetPreference.status === "error" && <> <button type="button" className="text-button" onClick={targetPreference.retry}>重试保存</button></>}</small>
                  </div>
                </div>
              </div>
              <div className="writing-grid practice-layout">
                <div className="writing-main">
                  <section className="question-panel">
                    <div className="panel-topline">
                      <div className="inline-tags">
                        <span className="tag">
                          {selectedQuestion.examType} 类 ·{" "}
                          {selectedQuestion.task}
                        </span>
                        <span className="small muted">
                          {selectedQuestion.book
                            ? `${selectedQuestion.book} · ${selectedQuestion.test}`
                            : selectedQuestion.name}
                        </span>
                      </div>
                      <div className="question-actions">
                        <button className="button secondary" disabled={reviewing || saving} onClick={() => user ? setCustomOpen(true) : setLoginOpen(true)}>
                          <UploadSimple size={17} />{input.questionId === null ? "编辑自传题目" : "上传题目"}
                        </button>
                        <button className="text-button" disabled={reviewing || saving} onClick={() => navigate("bank")}>
                          <BookOpen size={16} />换一题<ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="question-title">
                      <h2>题目</h2>
                      <span className="tag subtle">
                        {selectedQuestion.category}
                      </span>
                    </div>
                    <div className="question-stem" lang="en">
                      {selectedQuestion.stem
                        .split(/\n\s*\n/)
                        .map((paragraph, i) => (
                          <p
                            key={i}
                            className={
                              /^(Give reasons|Write at least)/i.test(paragraph)
                                ? "question-rubric"
                                : ""
                            }
                          >
                            {paragraph}
                          </p>
                        ))}
                    </div>
                    {selectedQuestion.images.length > 0 && (
                      <div className="question-images">
                        {selectedQuestion.images.map((image, i) => (
                          <a
                            key={image}
                            href={image}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`放大查看题图 ${i + 1}`}
                          >
                            <img
                              src={image}
                              alt={`${selectedQuestion.name} 的原始题图 ${i + 1}`}
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    {user && input.customQuestion?.chartData && (
                      <div className="question-images">
                        <img
                          src={input.customQuestion.chartData}
                          alt="你上传的写作题图"
                        />
                      </div>
                    )}
                    <div className="question-footnote">
                      <span>
                        <Clock size={15} />
                        {selectedQuestion.task === "Task 2"
                          ? "建议用时 40 分钟"
                          : "建议用时 20 分钟"}
                        <span>·</span>至少 {minimum} 词
                      </span>
                      {selectedQuestion.sourceUrl ? (
                        <a
                          href={selectedQuestion.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          题目来源
                          <ArrowSquareOut size={14} />
                        </a>
                      ) : (
                        <span>自选题目</span>
                      )}
                    </div>
                    {selectedQuestion.futureDate && (
                      <p className="small error-text">
                        原站日期晚于收集日期，本题时间记录待核实。
                      </p>
                    )}
                    {selectedQuestion.task === "Task 1" &&
                      selectedQuestion.examType === "A" &&
                      (!vision ||
                        (!selectedQuestion.images.length &&
                          !input.customQuestion?.chartData)) && (
                        <p className="inline-note">
                          <Info size={17} />
                          题图暂不可读取，批改将只提供语言与结构反馈，不给任务完成分与总分。
                        </p>
                      )}
                  </section>
                  <section className="editor-panel" aria-busy={reviewing}>
                    <div className="editor-heading">
                      <div className="question-title">
                        <label htmlFor="essay">写下你的观点</label>
                      </div>
                      <div className="editor-tools">
                        <input
                          ref={textImport}
                          type="file"
                          accept=".txt,text/plain"
                          hidden
                          onChange={(e) => {
                            void importEssay(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                        <button
                          className="icon-button"
                          title="导入 TXT 正文"
                          aria-label="导入 TXT 正文"
                          disabled={reviewing || !hydrated || !user}
                          onClick={() => textImport.current?.click()}
                        >
                          <UploadSimple size={19} />
                        </button>
                        <button
                          className="icon-button"
                          title="下载当前正文"
                          aria-label="下载当前正文"
                          onClick={() =>
                            downloadText(input.essay, "莎试笔雅-作文草稿.txt")
                          }
                          disabled={!user || !input.essay}
                        >
                          <DownloadSimple size={19} />
                        </button>
                        <button
                          className="text-button focus-toggle"
                          onClick={() => setFocus(!focus)}
                        >
                          {focus ? "退出专注" : "专注写作"}
                        </button>
                      </div>
                    </div>
                    <div className="editor-timer-row">
                      <button
                        className={`timer ${timerOn ? "running" : ""}`}
                        title="点击开始或暂停计时"
                        aria-label={`${String(Math.floor(timerSeconds / 60)).padStart(2, "0")}:${String(timerSeconds % 60).padStart(2, "0")}，${timerOn ? "暂停写作计时" : "开始写作计时"}`}
                        onClick={() => setTimerOn(!timerOn)}
                        disabled={!user}
                      >
                        <Clock size={16} />
                        {String(Math.floor(timerSeconds / 60)).padStart(2, "0")}
                        :{String(timerSeconds % 60).padStart(2, "0")}
                      </button>
                    </div>
                    <textarea
                      id="essay"
                      ref={editor}
                      className="essay-editor"
                      lang="en"
                      placeholder={
                        !user
                          ? "登录后开始写作…"
                          : hydrated
                          ? "输入英文作文…"
                          : "正在恢复你的草稿…"
                      }
                      spellCheck={false}
                      value={user ? input.essay : ""}
                      maxLength={30000}
                      onChange={(e) => update({ essay: e.target.value })}
                      readOnly={!user}
                      disabled={!hydrated || reviewing}
                      aria-describedby="word-count save-status"
                    />
                    <div className="editor-stats">
                      <div>
                        <span id="word-count">
                          <b>{words}</b> / {minimum} 词
                        </span>
                        <span className="stat-separator">·</span>
                        <span>{paragraphCount} 段</span>
                        <span className="word-progress" aria-hidden="true">
                          <i
                            style={{
                              width: `${Math.min((words / minimum) * 100, 100)}%`,
                            }}
                          />
                        </span>
                      </div>
                      <span
                        id="save-status"
                        className="save-status"
                        role="status"
                      >
                        {!user ? "游客模式 · 只读" : !localExerciseId.current ? "开始写作后自动保存" : localSaved ? (
                          <>
                            <Check size={14} />
                            本机已保存
                          </>
                        ) : (
                          "正在保存到本机"
                        )}
                      </span>
                    </div>
                    <div className="editor-actions">
                      <button
                        className="button secondary"
                        disabled={!hydrated || saving || reviewing}
                        onClick={manualSave}
                      >
                        {saving ? (
                          <SpinnerGap size={18} className="spin" />
                        ) : (
                          <FloppyDisk size={18} />
                        )}
                        {user ? "保存草稿" : "登录后保存"}
                      </button>
                      <button
                        className="button primary review-button"
                        disabled={!hydrated || reviewing || saving}
                        onClick={submitReview}
                      >
                        {reviewing ? (
                          <SpinnerGap size={19} className="spin" />
                        ) : (
                          <NotePencil size={19} />
                        )}{" "}
                        {reviewing ? "已提交批改" : user ? "提交批改" : "登录后批改"}
                        {!reviewing && <ArrowRight size={18} />}
                      </button>
                    </div>
                    {reviewing && (
                      <div className="review-progress" role="status">
                        <div className="loading-line" />
                        <b>正在认真读你的作文</b>
                        <span>
                          分析题目回应、段落逻辑与语言表达，通常需要一至两分钟。草稿已保存。
                        </span>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          )}
          <div hidden={view !== "teacher"}>
            <AiTeacher key={user?.id || "guest"} loggedIn={!!user} active={view === "teacher"} configured={configured} onLogin={() => setLoginOpen(true)} />
          </div>
          {view === "bank" && (
              <QuestionBank
                questions={bankReady ? questions : []}
                loading={!bankReady}
                onSelect={chooseQuestion}
                onCustom={() => user ? setCustomOpen(true) : setLoginOpen(true)}
                customDisabled={reviewing || saving}
              />
            )}
          {view === "methods" && (
            <div className="methods-view">
              <div className="page-intro">
                <h1>写作方法</h1>
              </div>
              <div className="method-intro">
                <GraduationCap size={30} weight="light" />
                <div>
                  <h2>好文章不必依赖复杂的句子</h2>
                  <p>
                    先回应题目，充分展开观点，再用准确自然的语言表达。每条方法标明来源与适用条件，批改时按题型选用。
                  </p>
                </div>
              </div>
              <a className="course-link method-course-link" href={simonCourse.url} target="_blank" rel="noopener noreferrer">
                <GraduationCap size={24} weight="light" />
                <span><b>{simonCourse.title}</b><small>在哔哩哔哩打开课程，配合下面的方法练习。</small></span>
                <span className="course-link-cta">打开课程 <ArrowSquareOut size={16} /></span>
              </a>
              <MethodLibrary methods={methods} />
              <p className="source-note">
                四段式等是练习建议，评分仍以官方四项标准为准。以上为方法转述，不代表 Simon、新东方或 IELTS 官方产品。
              </p>
              <button
                className="button primary"
                onClick={() => user ? navigate("writer") : setLoginOpen(true)}
              >
                带着方法写一篇
                <ArrowRight size={18} />
              </button>
            </div>
          )}
          {view === "history" && (
            <div className="history-view">
              <div className="page-intro">
                <h1>我的练习</h1>
                
              </div>
              {!user ? <div className="empty">
                <UserCircle size={36} weight="light" /><h2>登录后查看你的练习</h2>
                <p>草稿和批改记录仅当前账号可见。</p>
                <button className="button primary" onClick={() => setLoginOpen(true)}>邮箱登录<ArrowRight size={17} /></button>
              </div> : <>
                  {recoverableLocalDrafts.length > 0 && <>
                    <h2 className="history-heading">本机草稿 <span className="muted">{recoverableLocalDrafts.length}</span></h2>
                    <p className="muted small">本浏览器保留的写作内容，点击后才会载入答题区。</p>
                    <div className="history-list">
                      {recoverableLocalDrafts.map((draft) => <button className="history-row" key={draft.id} onClick={() => void openLocalDraft(draft)}>
                        <span className="history-icon"><FileText size={23} /></span>
                        <div><h3>{draft.input.title || questions.find((q) => q.id === draft.input.questionId)?.name || "自传题目练习"}</h3><p>{wordCount(draft.input.essay)} 词 · 更新于 {dateLabel(new Date(draft.updatedAt).toISOString())}</p></div>
                        <span className="tag subtle">本机</span><ArrowRight size={19} />
                      </button>)}
                    </div>
                  </>}
                  <div className="between history-heading">
                    <h2>
                      作文草稿 <span className="muted">{historyReady.drafts ? drafts.length : "加载中"}</span>
                    </h2>
                    <button
                      className="button secondary"
                      onClick={newExercise}
                      disabled={reviewing || saving}
                    >
                      <Plus size={17} />
                      新建练习
                    </button>
                  </div>
                  {drafts.length === 0 && !historyReady.drafts ? (
                    <div className="empty small-empty" role="status">
                      <SpinnerGap size={30} className="spin" />
                      <h3>{resourceErrors.drafts ? "云端草稿暂未载入" : "正在读取云端草稿"}</h3>
                      <p>连接恢复后会自动显示；本机作答仍可继续使用。</p>
                      <button className="text-button" onClick={reconnectResources}>重试加载</button>
                    </div>
                  ) : drafts.length === 0 ? (
                    <div className="empty small-empty">
                      <FileText size={30} />
                      <h3>第一篇作文，还在等你</h3>
                      <p>写好后点击“保存草稿”，就能在这里继续。</p>
                      <button
                        className="text-button"
                        onClick={() => navigate("writer")}
                      >
                        去写作
                        <ArrowRight size={17} />
                      </button>
                    </div>
                  ) : (
                    <div className="history-list">
                      {drafts.map((d) => (
                        <button
                          className="history-row"
                          key={d.id}
                          onClick={() => void openSavedDraft(d)}
                          disabled={openingDraft === d.id}
                          aria-busy={openingDraft === d.id}
                        >
                          <span className="history-icon">
                            {openingDraft === d.id ? <SpinnerGap size={23} className="spin" /> : <FileText size={23} />}
                          </span>
                          <div>
                            <h3>
                              {d.input.title ||
                                questions.find(
                                  (q) => q.id === d.input.questionId,
                                )?.name ||
                                "自选题目练习"}
                            </h3>
                            <p>
                              {d.wordCount} 词 · 更新于 {dateLabel(d.updatedAt)}
                            </p>
                          </div>
                          <span className="tag subtle">草稿</span>
                          <ArrowRight size={19} />
                        </button>
                      ))}
                    </div>
                  )}
                  <h2 className="history-heading">
                    批改记录 <span className="muted">{historyReady.reviews ? reviews.length : "加载中"}</span>
                  </h2>
                  {reviews.length === 0 && !historyReady.reviews ? (
                    <div className="empty small-empty" role="status">
                      <SpinnerGap size={30} className="spin" />
                      <h3>{resourceErrors.reviews ? "批改记录暂未载入" : "正在读取批改记录"}</h3>
                      <p>记录尚未加载完成，请稍候或重试连接。</p>
                      <button className="text-button" onClick={reconnectResources}>重试加载</button>
                    </div>
                  ) : reviews.length === 0 ? (
                    <div className="empty small-empty">
                      <CloudCheck size={30} weight="light" />
                      <h3>反馈，会从第一篇开始</h3>
                      <p>提交批改后，完整的评分与修改建议会保存在这里。</p>
                    </div>
                  ) : (
                    <div className="history-list">
                      {reviews.map((r) => (
                        <button
                          className="history-row"
                          key={r.id}
                          onClick={() => void openReviewRecord(r)}
                          disabled={openingReview === r.id}
                          aria-busy={openingReview === r.id}
                        >
                          <span className="history-icon">
                            {openingReview === r.id ? <SpinnerGap size={23} className="spin" /> : <NotePencil size={23} />}
                          </span>
                          <div>
                            <h3>{r.input.title || r.question.name}</h3>
                            <p>
                              {r.question.task} · {dateLabel(r.createdAt)}
                            </p>
                          </div>
                          <span
                            className={`tag ${r.status === "failed" ? "warning" : r.status === "processing" ? "subtle" : ""}`}
                          >
                            {r.status === "processing"
                              ? reviewProgress(r).label
                              : r.status === "failed"
                                ? "未完成"
                                : r.feedback?.overallBand?.toFixed(1) ||
                                  "语言反馈"}
                          </span>
                          <ArrowRight size={19} />
                        </button>
                      ))}
                    </div>
                  )}
                </>}
            </div>
          )}
          {user && view === "report" && selectedReview && (
            <Report
              key={selectedReview.id}
              review={selectedReview}
              connectionNotice={reviewConnectionNotice}
              onBack={() => navigate("history")}
              rewriteBusy={openingReview === selectedReview.id}
              onRewrite={() => void rewriteReview(selectedReview)}
            />
          )}
        </main>
      </div>
      <AuthDialog open={authLoaded && !user && loginOpen} onOpenChange={setLoginOpen} invitationRequired={invitation} onSuccess={(u) => {
        setUser(u);
        showMessage(`欢迎，${u.name}。`);
      }} />
      {user && customOpen && <CustomQuestionDialog
        initial={input.customQuestion}
        task={selectedQuestion.task}
        examType={selectedQuestion.examType}
        loggedIn={!!user}
        onLogin={() => setLoginOpen(true)}
        onClose={() => setCustomOpen(false)}
        onUse={saveCustom}
      />}
    </div>
  );
}
