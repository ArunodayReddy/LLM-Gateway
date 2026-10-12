# llm-gateway — Architecture

> Living document. Updated every milestone. If the code and this file ever
> disagree, the code wins — then fix this file.

**Status:** Milestones 1–5 complete (2026-10-12) — full gateway: auth →
safety → cache → budgets → multi-provider failover → cost accounting.

## What this is

An OpenAI-compatible LLM gateway: a single front door that applications use
instead of calling model providers directly. Any OpenAI SDK works against it
with one config change (`baseURL`). Each milestone adds one capability to the
request pipeline without breaking the ones before it.

The portfolio story: *cut LLM spend with caching, stop runaway agents with
budgets, ship reliability with failover* — cost control and operational
sanity, not just tech.

## System overview

```
                    ┌──────────────────────────────────────────────────┐
  Client app        │                   llm-gateway                    │  Upstream
  (any OpenAI SDK,  │                                                  │  providers
   baseURL pointed  │  ┌──────┐ ┌────────┐ ┌───────┐ ┌──────────────┐  │  (ordered
   at the gateway)  │  │ Auth │→│ Safety │→│ Cache │→│  /v1/chat/   │──┼─▶ list,
  ─────────────────▶│  │      │ │blocklst│ │ hit?  │ │ completions  │◀─┼── failover
                    │  └──────┘ └───┬────┘ └───┬───┘ │              │  │  on 5xx /
                    │               │          │     │  ┌────────┐  │  │  timeout /
                    │               │          │     │  │Budgets │  │  │  net err)
                    │               │          │     │  │(402)   │  │  │
                    │               │          │     │  └───┬────┘  │  │
                    │               ▼          ▼     ▼      ▼      │  │
                    │          ┌────────────────────────────────┐  │  │
                    │          │  SQLite log store (request_logs)│  │  │
                    │          │  key_prefix · model · tokens ·  │  │  │
                    │          │  cost · latency · status ·      │  │  │
                    │          │  cached · provider · created_at │  │  │
                    │          └────────────────────────────────┘  │  │
                    │                                                  │
                    │  Ops: GET /v1/usage (JSON) · GET /dashboard (HTML)│
                    └──────────────────────────────────────────────────┘
```

Pipeline order is deliberate: authenticate first (never log unauthenticated
traffic), then safety (block before anything billable), then cache (free hits
bypass budgets), then budgets, then provider failover. Every stage writes one
SQLite row — the log is the system's memory.

## Components

| Component | File | Responsibility |
|---|---|---|
| App bootstrap | `src/index.ts` | Wiring, request-id + access-log middleware, `/health`, route mounting, boot logging |
| Shared env type | `src/env.ts` | `AppEnv`: `requestId` + `apiKey` on every Hono context |
| Config | `src/config.ts` | Env parsing with clear errors; fails fast on missing gateway keys and malformed `PROVIDERS` JSON; degrades gracefully on missing provider keys |
| Auth middleware | `src/middleware/auth.ts` | Bearer-token check against `GATEWAY_API_KEYS`; 401 on missing/unknown key; stashes key on context (only the prefix is ever persisted) |
| Completions route | `src/routes/completions.ts` | `POST /v1/chat/completions`: full pipeline — auth → blocklist → cache → spend cap → provider failover → log |
| Pricing | `src/pricing.ts` | Per-model USD/1M-token table; unknown models cost $0 with a one-time warning |
| Log store | `src/db.ts` | `node:sqlite` wrapper: schema init + `provider` column migration, inserts, usage aggregates, month-to-date spend per key |
| Cache | `src/cache.ts` | `Cache` interface; Redis backend when `REDIS_URL` set, in-memory `Map` fallback; `sha256(model + messages)` keys; non-streaming only |
| Safety | `src/safety.ts` | PII redaction (email/phone/SSN), prompt-text extraction, blocklist substring matching |
| Providers | `src/providers.ts` | `PROVIDERS` JSON parsing + back-compat single provider; ordered failover on network error / timeout / 5xx (never on 4xx) |
| Usage API | `src/routes/usage.ts` | `GET /v1/usage`: totals, per-key breakdown, cache stats, recent rows (auth required) |
| Dashboard | `src/routes/dashboard.ts` | `GET /dashboard`: single-file HTML ops page, key via localStorage, no build step (auth required) |

## Request lifecycle (M1–M5)

1. Client `POST /v1/chat/completions` with `Authorization: Bearer <gw-key>`.
2. Gateway assigns a UUID request id, starts the timer.
3. Auth middleware: unknown/missing key → `401 { error: "unauthorized …" }` (never logged).
4. Body parsed as JSON; invalid JSON → `400` (logged, model "unknown").
5. **M4** — Blocklist: prompt text scanned for `BLOCKED_PATTERNS` substrings → `400 { error: "request blocked by safety filter" }` (logged).
6. **M3** — Cache lookup (`sha256(model + messages)`), non-streaming only. Hit → logged with `cached=1` (cost row = dollars saved), returned with `x-gateway-cache: hit`. Hits bypass the spend cap.
7. **M5** — Provider configured? No key on any provider → `500` (logged).
8. **M4** — Spend cap: key's UTC-month spend ≥ `PER_KEY_MONTHLY_CAP_USD` → `402 { error: "monthly spend cap exceeded" }` (logged).
9. **M5** — Providers tried in order; failover on network error, timeout (`UPSTREAM_TIMEOUT_MS`), or 5xx. All fail → `502 { error: "all providers failed" }` (logged).
10. **M2** — Non-streaming: response buffered, `usage` extracted, cost estimated, row persisted (PII-redacted). Streaming: SSE relayed untouched, row persisted with null tokens.
11. Access log line: `METHOD path -> status (ms) [request-id]`.

## Interfaces

### HTTP API (stable across milestones — additive only)

- `GET /health` → `200 { ok, service, version }`. No auth.
- `POST /v1/chat/completions` → auth required. Accepts the OpenAI
  chat-completions schema verbatim; returns the provider's schema verbatim
  (plus `x-gateway-request-id` header; `x-gateway-cache: hit` on cache hits).
  Error envelope: `{ error: "<human-readable message>" }` with
  400 (bad JSON / blocked by safety filter) / 401 / 402 (spend cap) /
  500 (no provider configured) / 502 (all providers failed).
- `GET /v1/usage` → auth required. JSON aggregates:
  `totalRequests`, `totalPromptTokens`, `totalCompletionTokens`,
  `totalCostUsd` (actual provider spend — cached requests excluded),
  `cacheHits`, `dollarsSaved` (avoided spend from cache hits),
  `byKey: [{ keyPrefix, requests, costUsd }]`, `recent: [...]` (last 20 rows).
- `GET /dashboard` → auth required. Single-file HTML ops page: totals cards,
  recent-requests table, per-key breakdown. Prompts for the gateway key once
  (localStorage); no build step, no external assets.

### Configuration (env)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GATEWAY_API_KEYS` | yes | — | Comma-separated Bearer keys for clients |
| `PROVIDER_API_KEY` | no* | — | Single upstream key, back-compat (*500 until some provider has a key) |
| `PROVIDER_BASE_URL` | no | `https://api.openai.com/v1` | Single upstream endpoint, back-compat |
| `PROVIDERS` | no | — | JSON array `[{name, baseUrl, apiKey}]`, tried in order (M5) |
| `UPSTREAM_TIMEOUT_MS` | no | `30000` | Per-provider timeout before failover (M5) |
| `DB_PATH` | no | `./data/gateway.db` | SQLite log store path (M2) |
| `REDIS_URL` | no | — | Set → Redis cache backend; unset → in-memory `Map` (M3) |
| `CACHE_TTL_SECONDS` | no | `3600` | Cache TTL for non-streaming responses (M3) |
| `BLOCKED_PATTERNS` | no | — | Comma-separated substrings blocked in prompts, case-insensitive (M4) |
| `PER_KEY_MONTHLY_CAP_USD` | no | `50` | Per-key calendar-month (UTC) spend cap; 402 when exceeded (M4) |
| `PORT` | no | `8787` | Listen port |

### Data model

SQLite (`node:sqlite`, no native deps), one table:

```sql
request_logs(
  id INTEGER PK, key_prefix TEXT,        -- first 8 chars of gateway key ONLY
  model TEXT,                             -- PII-redacted
  prompt_tokens INTEGER NULL,             -- NULL for streams / errors
  completion_tokens INTEGER NULL,
  cost_usd REAL,                          -- actual spend; on cached rows = dollars saved
  latency_ms INTEGER, status INTEGER,
  cached INTEGER,                         -- 0/1
  provider TEXT NULL,                     -- M5 migration via ALTER TABLE
  created_at TEXT DEFAULT (datetime('now'))
)
```

Only metadata is persisted — prompt/response bodies never touch the store
(by design; `redactPii` guards every text field as defense-in-depth).

## What's intentionally not built yet

- Per-model routing rules (e.g. "cheap model for classification")
- Token-bucket rate limiting per key
- Retry with backoff inside a single provider
- Usage webhooks / alerts on cap approach
- Multi-user dashboard auth (single shared gateway key today)

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-11 | Hono on Node 24, TypeScript throughout | Lightweight, fast; one language for gateway + future Next.js dashboard; plays to frontend strength |
| 2026-10-11 | OpenAI-compatible API surface, additive-only | Any existing app/SDK migrates with a one-line `baseURL` change; milestones never break clients |
| 2026-10-11 | Stateless M1; persistence starts at M2 | Smallest shippable slice; logging before storage |
| 2026-10-11 | Hono `Variables` generic for request id | `c.get("requestId")` needs the type declared on both Hono instances (see build log M1) |
| 2026-10-11 | GitHub pushes via API, repo created by owner | GitHub App cannot create repos (403); owner creates, grants access, agent pushes |
| 2026-10-12 | `node:sqlite` for the log store, zero new native deps | Built into Node 24; Postgres/Redis would be overkill for a single-node v1 |
| 2026-10-12 | Cache key = `sha256(model + messages)` only | Ignores sampling params — documented tradeoff; identical messages share one response |
| 2026-10-12 | Cache hits bypass the spend cap | Hits cost $0, so blocking them would be wrong; logged with cost = dollars saved |
| 2026-10-12 | Failover on 5xx/timeout/network — never on 4xx | A 401/429 would just repeat against the next provider |
| 2026-10-12 | Prompt/response bodies never persisted | PII can't leak from a store that never holds it; `redactPii` guards text fields anyway |
| 2026-10-12 | `PROVIDERS` JSON with single-provider back-compat | M1 env vars keep working; migration path is additive |

## Milestone map

- [x] M1 — Passthrough proxy + auth + logging (2026-10-11)
- [x] M2 — Log store + cost dashboard (2026-10-12)
- [x] M3 — Cache + savings counter (2026-10-12)
- [x] M4 — Safety + spend caps (2026-10-12)
- [x] M5 — Multi-provider failover (2026-10-12)
