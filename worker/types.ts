import type {
  D1Database,
  DurableObjectNamespace,
} from "@cloudflare/workers-types";
import type { ProviderEnv } from "../src/lib/reviewer";
export type Env = ProviderEnv & {
  DB: D1Database;
  AUTH_DB?: D1Database;
  AI_JOBS?: import("../src/lib/ai-jobs").AiJobs;
  FREE_ACCESS_ENABLED?: string;
  MEMBERSHIP_ENABLED?: string;
  MEMBERSHIP_REQUIRE_READY?: string;
  MEMBERSHIP_LAUNCH_AT?: string;
  MEMBERSHIP_LAUNCH_DEFERRED?: string;
  MEMBERSHIP_SITE?: string;
  MEMBERSHIP_BUY_URL?: string;
  STORE?: DurableObjectNamespace;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  REGISTRATION_CODE?: string;
  DAILY_REVIEW_LIMIT?: string;
};
