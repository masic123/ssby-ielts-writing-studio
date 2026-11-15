export type Question = {
  id: number;
  name: string;
  task: "Task 1" | "Task 2";
  examType: "A" | "G";
  category: string;
  topic: string;
  book: string;
  test: string;
  date: string;
  stem: string;
  sourceType: string;
  sourceUrl: string;
  futureDate: boolean;
  images: string[];
};
export type User = { id: string; name: string; email: string };
export type TeacherMessage = { role: "user" | "assistant"; content: string };
export type TeacherSource = {
  id: string;
  title: string;
  provider: "simon" | "tian-nan";
  section: string;
  page: number;
  file?: string;
};
export type TeacherReply = { answer: string; sources: TeacherSource[] };
export type WritingOutline = {
  analysis: string;
  position: string;
  paragraphs: { id: string; point: string; support: string }[];
  ending: string;
};
export type EssayInput = {
  questionId: number | null;
  customQuestion?: {
    stem: string;
    task: "Task 1" | "Task 2";
    examType: "A" | "G";
    category?: string;
    chartData?: string;
  };
  essay: string;
  outline?: WritingOutline;
  targetBand: number;
  title: string;
};
export type RecordAttachments = { chart: { url: string; mimeType: string; bytes: number; sha256: string } };
export type Draft = {
  attachments?: RecordAttachments;
  id: string;
  input: EssayInput;
  version: number;
  updatedAt: string;
  wordCount: number;
};
export type DraftHistoryItem = Pick<Draft, "id" | "version" | "updatedAt" | "wordCount"> & {
  input: Pick<EssayInput, "title" | "questionId">;
};
export type MethodRule = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  task: "Task 1" | "Task 2" | "all";
  criteria?: ("taskResponse" | "coherence" | "lexical" | "grammar")[];
  scope?: "chart" | "map" | "process";
  condition?: string;
  requiresVisual?: boolean;
  source: {
    section: string;
    page: number;
    chunkId: string;
    provider?: "simon" | "tian-nan";
    title?: string;
    file?: string;
    pages?: number[];
    verification?: "pdf_text_checked";
  } | null;
};
export type Criterion = {
  score: number | null;
  reason: string;
  evidence: string;
};
export type AdvancedSuggestion = {
  kind: "vocabulary" | "phrase" | "sentence";
  original: string;
  replacement: string;
  explanation: string;
  example: string;
};
export type ScoringReference = {
  id: string;
  title: string;
  band: number;
  sourceUrl: string;
  provenance: string;
};
export type ScoringCalibration = {
  rubricVersion: string;
  rubricUrl: string;
  availableScoredSamples: number;
  references: ScoringReference[];
  assessmentVersion?: string;
  assessmentMode?: "independent_scorecard_then_feedback" | "language_only";
  chartEvidenceStatus?: "readable" | "unreadable";
};
export type Feedback = {
  targetCoaching?: import("./target-coaching-types").TargetCoaching;
  revisionAssessment?: import("./revision-assessment").RevisionAssessment;
  summary: string;
  criteria: {
    taskResponse: Criterion;
    coherence: Criterion;
    lexical: Criterion;
    grammar: Criterion;
  };
  strengths: string[];
  priorities: { title: string; reason: string; action: string }[];
  methodChecks: {
    ruleId: string;
    status: "met" | "partial" | "missing" | "not_applicable";
    evidence: string;
    advice: string;
  }[];
  paragraphs: {
    index: number;
    role: string;
    feedback: string;
    suggestion: string;
  }[];
  corrections: {
    original: string;
    replacement: string;
    reason: string;
    kind: "grammar" | "vocabulary" | "clarity" | "logic" | "naturalness";
  }[];
  improvedEssay: string;
  exercises: { title: string; instruction: string }[];
  overallBand: number | null;
  assessmentScope: "full" | "language_only";
  advancedSuggestions?: AdvancedSuggestion[];
  calibration?: ScoringCalibration;
};
export type Review = {
  attachments?: RecordAttachments;
  queue?: import("./ai-jobs").ReviewQueueInfo;
  id: string;
  draftId: string | null;
  status: "processing" | "completed" | "failed";
  createdAt: string;
  input: EssayInput;
  question: Question;
  feedback: Feedback | null;
  error: string | null;
  model: string;
  references: MethodRule[];
};
export type ReviewHistoryItem = Pick<Review, "id" | "draftId" | "status" | "createdAt" | "queue"> & {
  input: Pick<EssayInput, "title">;
  question: Pick<Question, "name" | "task">;
  feedback: Pick<Feedback, "overallBand"> | null;
};
export const wordCount = (text: string) =>
  text.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g)?.length || 0;
