import { Hono } from "hono";
import { auth } from "../middleware/auth.js";
import type { AppEnv } from "../env.js";
import { getUsage } from "../db.js";

export const usage = new Hono<AppEnv>();

/**
 * GET /v1/usage — aggregate cost/usage stats (auth required; cost data is
 * sensitive). Shape:
 * {
 *   totalRequests, totalPromptTokens, totalCompletionTokens,
 *   totalCostUsd,            // actual provider spend (excludes cached)
 *   cacheHits, dollarsSaved, // M3: avoided spend from cache hits
 *   byKey: [{ keyPrefix, requests, costUsd }],
 *   recent: [ ...last 20 log rows ]
 * }
 */
usage.get("/", auth, (c) => {
  return c.json(getUsage());
});
