import { Hono } from "hono";
import { auth } from "../middleware/auth.js";
import type { AppEnv } from "../env.js";
import { getUsage } from "../db.js";
import { getRateLimiter } from "../ratelimit.js";

export const usage = new Hono<AppEnv>();

/**
 * GET /v1/usage — aggregate cost/usage stats (auth required; cost data is
 * sensitive). Shape:
 * {
 *   totalRequests, totalPromptTokens, totalCompletionTokens,
 *   totalCostUsd,            // actual provider spend (excludes cached)
 *   cacheHits, dollarsSaved, // M3: avoided spend from cache hits
 *   byKey: [{ keyPrefix, requests, costUsd }],
 *   recent: [ ...last 20 log rows ],
 *   rateLimit: { limit, remaining, resetAt }  // M6: calling key's window
 * }
 */
usage.get("/", auth, async (c) => {
  const keyPrefix = c.get("apiKey").slice(0, 8);
  const rl = await getRateLimiter().peek(keyPrefix);
  return c.json({
    ...getUsage(),
    rateLimit: {
      limit: rl.limit,
      remaining: rl.remaining,
      resetAt: rl.resetAt,
    },
  });
});
