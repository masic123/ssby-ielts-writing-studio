import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bookPath = process.env.SIMON_BOOK_PATH;
const bankRoot = process.env.QUESTION_BANK_PATH;
if (!bookPath || !bankRoot) throw new Error("Set SIMON_BOOK_PATH and QUESTION_BANK_PATH to content you are authorized to use.");
const bank = JSON.parse(
  fs.readFileSync(path.join(bankRoot, "写作题库.json"), "utf8"),
);
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.mkdirSync(path.join(root, "public", "questions"), { recursive: true });
const questions = bank.questions.map((q) => ({
  id: q.id,
  name: q.name,
  task: q.task,
  examType: q.exam_type === "G 类" ? "G" : "A",
  category: q.category,
  topic: q.topic,
  book: q.book,
  test: q.test,
  date: q.site_date,
  stem: q.stem,
  sourceType: q.source_type,
  sourceUrl: q.source_url,
  futureDate: q.future_date,
  images: q.images
    .filter((i) => i.status === "ok")
    .map((i) => {
      const filename = path.basename(i.path);
      fs.copyFileSync(
        path.join(bankRoot, i.path),
        path.join(root, "public", "questions", filename),
      );
      return "/questions/" + filename;
    }),
}));
fs.writeFileSync(
  path.join(root, "data", "questions.json"),
  JSON.stringify(questions),
);
const source = fs.readFileSync(bookPath, "utf8");
const chunks = [];
let section = "卷首",
  subsection = "",
  page = 0,
  start = 1,
  buffer = [];
function flush() {
  if (!buffer.join("").trim()) return;
  const text = buffer.join("\n").trim();
  if (text.length < 100) {
    buffer = [];
    return;
  }
  chunks.push({
    id: "simon-" + String(chunks.length + 1).padStart(4, "0"),
    section,
    subsection,
    page,
    startLine: start,
    endLine: start + buffer.length - 1,
    text,
  });
  buffer = [];
}
const lines = source.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const heading = line.match(/^## (.+)$/);
  const sub = line.match(/^### (.+)$/);
  const marker = line.match(/<!-- p\.(\d+) -->/);
  if (heading) {
    flush();
    section = heading[1];
    subsection = "";
    start = i + 1;
  }
  if (sub) {
    flush();
    subsection = sub[1];
    start = i + 1;
  }
  if (marker) {
    flush();
    page = Number(marker[1]);
    start = i + 1;
    continue;
  }
  if (!buffer.length) start = i + 1;
  buffer.push(line);
  if (buffer.join("\n").length > 2300 && !line.trim()) {
    flush();
    start = i + 2;
  }
}
flush();
fs.writeFileSync(
  path.join(root, "data", "book-chunks.json"),
  JSON.stringify(chunks),
);
fs.writeFileSync(
  path.join(root, "data", "content-manifest.json"),
  JSON.stringify(
    {
      questionCount: questions.length,
      bookTitle: "跟雅思考官 Simon 学写作（A 类）",
      sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
      chunkCount: chunks.length,
      importedAt: new Date().toISOString(),
      sourceBookPath: bookPath,
      bankAsOf: bank.metadata.as_of_date,
    },
    null,
    2,
  ),
);
console.log(
  `Imported ${questions.length} questions, ${chunks.length} book passages. Original book remains server-only.`,
);
