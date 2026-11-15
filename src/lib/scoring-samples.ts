// Server-side only: never expose sample essays through public assets or APIs.
import sampleData from "../../data/scoring-samples.json";
import { writingRubricSource } from "./official-writing-rubric";
import { wordCount, type Question, type ScoringCalibration } from "./types";

export type ScoringSample = {
  id: string;
  sourceGroup: string;
  title: string;
  task: Question["task"];
  examType: Question["examType"];
  band: number | null;
  question: string;
  essay: string;
  comment: string;
  sourceUrl: string;
  provenance: string;
  wordCount: number;
  imageUrls: string[];
  isUnscoredModelAnswer: boolean;
};
export const scoringSamples = sampleData.samples as ScoringSample[];
export const scoredSampleCount = scoringSamples.filter((s) => s.band !== null && !s.isUnscoredModelAnswer).length;

const stopwords = new Set(("a an the this that these those and or but of to in on at for from with by as is are was were be been being it its they their them he she his her we our us i you your can could may might must should would will do does did have has had not more most some many much all any both other than which what when where why how about into also such people think believe give reasons answer include relevant examples own knowledge experience write least words writing task spend minutes extent agree disagree discuss views opinion below shows chart table graph information summarise selecting reporting main features comparisons make advantages disadvantages outweigh").split(" "));
const tokens = (text: string) => text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
const terms = (text: string) => new Set(tokens(text).filter((s) => s.length > 2 && !stopwords.has(s)));
function similarity(a: Set<string>, b: Set<string>) {
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap++;
  return overlap / Math.max(1, Math.sqrt(a.size * b.size));
}

function nearDuplicate(a: string, b: string) {
  const left = tokens(a), right = tokens(b);
  if (left.join(" ") === right.join(" ")) return true;
  const shingles = (words: string[]) => new Set(words.slice(0, -4).map((_, i) => words.slice(i, i + 5).join(" ")));
  if (Math.min(left.length, right.length) < 20) return false;
  const x = shingles(left), y = shingles(right);
  let overlap = 0;
  for (const value of x) if (y.has(value)) overlap++;
  return overlap / Math.max(1, x.size + y.size - overlap) >= 0.75;
}

export function scoringTaskFamily(q: Pick<Question, "task" | "examType" | "category" | "stem">) {
  const text = `${q.category} ${q.stem}`.toLowerCase().replace(/give reasons for your answer[\s\S]*/, "");
  if (q.task === "Task 1") {
    if (q.examType === "G") return "letter";
    if (/地图|map\b|maps\b|plans?\b|layout\b/.test(text)) return "map";
    if (/流程|process\b|stages?\b|life cycle|manufactur|how .{0,70}(?:produced|made|works)/.test(text)) return "process";
    return "chart";
  }
  if (/discuss both|both views|讨论双方/.test(text)) return "discussion";
  if (/outweigh|利弊比较/.test(text)) return "outweigh";
  if (/advantages|disadvantages|利弊/.test(text)) return "advantages";
  if (/agree|disagree|同意|观点/.test(text)) return "opinion";
  if (/causes?|reasons?|problems?|solutions?|解决|原因/.test(text)) return "causes-solutions";
  return "two-part";
}

export function selectScoringSamples(
  q: Question,
  essay: string,
  pool: ScoringSample[] = scoringSamples,
): ScoringSample[] {
  const family = scoringTaskFamily(q);
  const questionTerms = terms(q.stem), essayTerms = terms(essay);
  const count = wordCount(essay);
  const candidates = pool.filter((s) =>
    s.task === q.task && s.examType === q.examType &&
    s.band !== null && !s.isUnscoredModelAnswer && !nearDuplicate(essay, s.essay),
  ).map((sample) => {
    const sampleFamily = scoringTaskFamily({ task: sample.task, examType: sample.examType, category: "", stem: sample.question });
    return {
      sample,
      family: sampleFamily,
      // Length affects retrieval only, never the estimated score.
      relevance: (family === sampleFamily ? 2 : 0) +
        3 * similarity(questionTerms, terms(sample.question)) +
        similarity(essayTerms, terms(sample.essay)) +
        0.25 / (1 + Math.abs(Math.log((count + 1) / (sample.wordCount + 1)))),
    };
  }).filter((s) => q.task !== "Task 1" || s.family === family)
    .sort((a, b) => b.relevance - a.relevance || a.sample.id.localeCompare(b.sample.id));

  // Include different score boundaries instead of letting the target band or
  // the highest-scoring prose determine the examples supplied to the assessor.
  const selected: ScoringSample[] = [];
  const buckets = [(n: number) => n <= 5, (n: number) => n > 5 && n <= 6,
    (n: number) => n > 6 && n <= 7, (n: number) => n > 7];
  for (const inBucket of buckets) {
    const anchor = candidates.find(({ sample }) => inBucket(sample.band!));
    if (anchor) selected.push(anchor.sample);
  }
  for (const { sample } of candidates) {
    if (selected.length >= 4) break;
    if (!selected.some((s) => s.id === sample.id)) selected.push(sample);
  }
  return selected.sort((a, b) => a.band! - b.band! || a.id.localeCompare(b.id));
}

export function scoringCalibration(samples: ScoringSample[]): ScoringCalibration {
  return {
    rubricVersion: writingRubricSource.version,
    rubricUrl: writingRubricSource.url,
    availableScoredSamples: scoredSampleCount,
    references: samples.map((s) => ({
      id: s.id, title: s.title, band: s.band!, sourceUrl: s.sourceUrl, provenance: s.provenance,
    })),
  };
}
