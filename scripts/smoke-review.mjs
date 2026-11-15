import fs from "node:fs";
import { randomUUID } from "node:crypto";
const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const email = `qa-${randomUUID()}@example.test`;
const password = randomUUID() + randomUUID();
async function call(route, data, cookie, method) {
  const response = await fetch(base + route, {
    method: method || (data ? "POST" : "GET"),
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
  return { result, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const { result: account, cookie } = await call("/api/auth", {
  action: "register",
  acceptNotice: true,
  noticeVersion: "ielts-2026-11-11-v1",
  email,
  password,
  name: "界面验收账号",
});
const essay = `It is often argued that constructing tall apartment blocks is the most effective way to provide housing in large cities. I partly agree with this view because high-rise buildings can make efficient use of limited land, but I believe that affordability and transport also need attention.

The main advantage of tall residential buildings is that they can accommodate many households on a relatively small site. In a city where land is expensive and there is little room for new development, building upwards allows more people to live near their jobs. For example, replacing a small group of old houses with a well-designed apartment building could provide homes for several times as many families. This may also reduce pressure to expand the city into surrounding farmland.

However, increasing the number of apartments does not necessarily mean that ordinary residents can afford them. Developers may focus on luxury flats because these generate higher profits. Local authorities should therefore require some new homes to be available at reasonable prices. In addition, building more housing without improving public transport can create crowded roads and long journeys to work. Investment in rail and bus services could make less central areas more attractive places to live and spread housing demand more evenly.

In conclusion, tall apartment blocks can be an effective response to a shortage of urban land. Nevertheless, they should form part of a wider housing policy that also makes homes affordable and connects residential areas to employment.`;
const input = {
  questionId: 11723,
  essay,
  targetBand: 7,
  title: "验收作文 · 城市住房",
};
const { result: saved } = await call("/api/drafts", { input }, cookie);
console.log(
  JSON.stringify({
    stage: "draft_saved",
    wordCount: essay.split(/\s+/).length,
  }),
);
const started = Date.now();
let reviewed;
try {
  ({ result: reviewed } = await call(
    "/api/reviews",
    { input, draftId: saved.draft.id, requestKey: randomUUID() },
    cookie,
  ));
} catch (error) {
  await call("/api/auth", undefined, cookie, "DELETE").catch(() => {});
  throw error;
}
fs.mkdirSync("storage", { recursive: true });
fs.writeFileSync(
  "storage/browser-test.json",
  JSON.stringify({
    email,
    password,
    userId: account.user.id,
    reviewId: reviewed.review.id,
  }),
  { mode: 0o600 },
);
fs.writeFileSync(
  "storage/real-smoke-result.json",
  JSON.stringify(
    {
      status: reviewed.review.status,
      elapsedMs: Date.now() - started,
      overall: reviewed.review.feedback?.overallBand,
      criteria: reviewed.review.feedback?.criteria,
      references: reviewed.review.references.length,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    stage: "review_complete",
    status: reviewed.review.status,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    overall: reviewed.review.feedback?.overallBand,
    references: reviewed.review.references.length,
  }),
);
const detail = await call(
  `/api/reviews?id=${reviewed.review.id}`,
  undefined,
  cookie,
);
if (detail.result.review.status !== "completed")
  throw new Error("Saved report did not complete.");
if (process.env.SMOKE_KEEP_ACCOUNT !== "true") {
  await call("/api/auth", undefined, cookie, "DELETE");
  const after = await call("/api/auth", undefined, cookie);
  if (after.result.user) throw new Error("Test session was not removed.");
  console.log(JSON.stringify({ stage: "test_account_removed" }));
}
