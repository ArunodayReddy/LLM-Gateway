import { Hono } from "hono";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";
import type { AppEnv } from "../env.js";
import { logRequest, getMonthSpendUsd } from "../db.js";
import { estimateCostUsd } from "../pricing.js";
import { cacheKeyFor, getCache } from "../cache.js";
import { getRateLimiter } from "../ratelimit.js";
import { fetchWithFailover } from "../providers.js";
import {
  extractPromptText,
  findBlockedPattern,
  redactPii,
} from "../safety.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

export const completions = new Hono<AppEnv>();

function relayHeaders(upstream: Response, requestId: string): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("x-gateway-request-id", requestId);
  return headers;
}

function requestModel(body: unknown): string {
  if (typeof body === "object" && body !== null && "model" in body) {
    const m = (body as Record<string, unknown>)["model"];
    if (typeof m === "string" && m) return m;
  }
  return "unknown";
}

/**
 * POST /v1/chat/completions
 *
 * Pipeline (each milestone adds a stage; order is deliberate):
 *   M1  auth → proxy upstream → relay
 *   M2  + persist a request log row (usage extracted from non-streaming
 *       responses; streams log with tokens null)
 *   M3  + cache lookup before proxying (non-streaming only); hits never
 *       touch the provider and record dollars saved
 *   M4  + blocklist (400) before anything billable; per-key monthly spend
 *       caps (402) after the cache lookup; PII redaction on all log rows
 *   M5  + ordered provider list with failover (network error / timeout /
 *       5xx); provider name recorded per row; 502 only if all fail
 *   M6  + fixed-window per-key rate limiting (429) — runs first, right
 *       after auth, so every request counts, including cache hits
 */
completions.post("/", auth, async (c) => {
  const started = Date.now();
  const requestId = c.get("requestId");
  const keyPrefix = c.get("apiKey").slice(0, 8);

  // M6: rate limit before anything else (even body parsing). Unauthenticated
  // requests never reach this middleware, so 401s don't consume quota.
  // Rejected requests are still logged (status 429) like every other stage.
  const rlState = await getRateLimiter().check(keyPrefix);
  if (!rlState.allowed) {
    logRequest({
      keyPrefix, model: "unknown", promptTokens: null, completionTokens: null,
      costUsd: 0, latencyMs: Date.now() - started, status: 429, cached: 0, provider: null,
    });
    c.header("Retry-After", String(rlState.retryAfterSec));
    return c.json(
      { error: "rate limit exceeded", retry_after: rlState.retryAfterSec },
      429,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    logRequest({
      keyPrefix, model: "unknown", promptTokens: null, completionTokens: null,
      costUsd: 0, latencyMs: Date.now() - started, status: 400, cached: 0, provider: null,
    });
    return c.json({ error: "request body must be valid JSON" }, 400);
  }

  const model = requestModel(body);
  const stream =
    typeof body === "object" && body !== null &&
    (body as Record<string, unknown>)["stream"] === true;
  const messages =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)["messages"]
      : undefined;

  // M4: blocklist — scan prompt text for forbidden substrings before
  // anything billable happens. Blocked requests are logged (status 400)
  // for visibility, with PII redacted like every other log row.
  const blocked = findBlockedPattern(
    extractPromptText(body),
    config.blockedPatterns,
  );
  if (blocked) {
    logRequest({
      keyPrefix, model: redactPii(model), promptTokens: null, completionTokens: null,
      costUsd: 0, latencyMs: Date.now() - started, status: 400, cached: 0, provider: null,
    });
    return c.json({ error: "request blocked by safety filter" }, 400);
  }

  // M5: at least one provider must have an API key.
  if (!config.providers.some((p) => p.apiKey)) {
    logRequest({
      keyPrefix, model: redactPii(model), promptTokens: null, completionTokens: null,
      costUsd: 0, latencyMs: Date.now() - started, status: 500, cached: 0, provider: null,
    });
    return c.json(
      { error: "provider not configured — set PROVIDERS or PROVIDER_API_KEY" },
      500,
    );
  }

  // M3: cache lookup for non-streaming requests. A hit never touches the
  // provider; the saved cost is recorded on the log row (dollars_saved).
  const cache = getCache();
  const cacheKey = !stream ? cacheKeyFor(model, messages) : null;
  if (cacheKey) {
    const hit = await cache.get(cacheKey);
    if (hit) {
      logRequest({
        keyPrefix,
        model: hit.model,
        promptTokens: hit.promptTokens,
        completionTokens: hit.completionTokens,
        costUsd: hit.costUsd,
        latencyMs: Date.now() - started,
        status: hit.status,
        cached: 1,
        provider: null,
      });
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.set("x-gateway-request-id", requestId);
      headers.set("x-gateway-cache", "hit");
      return new Response(hit.body, { status: hit.status, headers });
    }
  }

  // M4: per-key monthly spend cap. Checked after the cache lookup so
  // cache hits (which cost $0) are never blocked by the cap.
  const monthSpend = getMonthSpendUsd(keyPrefix);
  if (monthSpend >= config.perKeyMonthlyCapUsd) {
    logRequest({
      keyPrefix, model: redactPii(model), promptTokens: null, completionTokens: null,
      costUsd: 0, latencyMs: Date.now() - started, status: 402, cached: 0, provider: null,
    });
    return c.json({ error: "monthly spend cap exceeded" }, 402);
  }

  // M5: try providers in priority order; fail over on network errors,
  // timeouts, and 5xx. 502 only when every provider fails.
  let upstream: Response;
  let providerName: string;
  try {
    const result = await fetchWithFailover(
      config.providers,
      "/chat/completions",
      JSON.stringify(body),
      config.upstreamTimeoutMs,
    );
    upstream = result.response;
    providerName = result.providerName;
  } catch {
    logRequest({
      keyPrefix, model: redactPii(model), promptTokens: null, completionTokens: null,
      costUsd: 0, latencyMs: Date.now() - started, status: 502, cached: 0, provider: null,
    });
    return c.json({ error: "all providers failed" }, 502);
  }

  // Streaming responses relay untouched (SSE passes through); usage is only
  // available in non-streaming JSON bodies, so streams log with null tokens.
  if (stream) {
    logRequest({
      keyPrefix, model: redactPii(model), promptTokens: null, completionTokens: null,
      costUsd: 0, latencyMs: Date.now() - started, status: upstream.status,
      cached: 0, provider: providerName,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: relayHeaders(upstream, requestId),
    });
  }

  const rawText = await upstream.text();
  let data: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed === "object" && parsed !== null) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON upstream body: relay as-is, log without usage.
  }

  const usage =
    data && typeof data["usage"] === "object" && data["usage"] !== null
      ? (data["usage"] as Record<string, unknown>)
      : {};
  const promptTokens =
    typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : null;
  const completionTokens =
    typeof usage["completion_tokens"] === "number"
      ? usage["completion_tokens"]
      : null;
  const responseModel =
    data && typeof data["model"] === "string" && data["model"]
      ? data["model"]
      : model;
  const costUsd =
    upstream.status === 200
      ? estimateCostUsd(responseModel, promptTokens, completionTokens)
      : 0;

  // M3: store successful non-streaming responses for future cache hits.
  if (cacheKey && upstream.status === 200) {
    await cache.set(
      cacheKey,
      {
        status: upstream.status,
        body: rawText,
        model: responseModel,
        promptTokens,
        completionTokens,
        costUsd,
      },
      config.cacheTtlSeconds,
    );
  }

  logRequest({
    keyPrefix,
    model: redactPii(responseModel),
    promptTokens,
    completionTokens,
    costUsd,
    latencyMs: Date.now() - started,
    status: upstream.status,
    cached: 0,
    provider: providerName,
  });

  return new Response(rawText, {
    status: upstream.status,
    headers: relayHeaders(upstream, requestId),
  });
});
