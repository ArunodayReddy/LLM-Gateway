# llm-gateway — Architecture

> Living document. Updated every milestone. If the code and this file ever
> disagree, the code wins — then fix this file.

**Status:** Milestone 1 complete (2026-10-11) — authenticated passthrough proxy.

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
                    ┌─────────────────────────────────────────┐
  Client app        │              llm-gateway                │   Upstream
  (any OpenAI SDK,  │                                         │   provider
   baseURL pointed  │  ┌──────┐ ┌────────┐ ┌──────────────┐   │   (OpenAI-
   at the gateway)  │  │ Auth │→│ Logger │→│  /v1/chat/   │───┼──→ compatible
  ─────────────────▶│  │      │ │        │ │ completions  │◀──┼──  endpoint)
                    │  └──────┘ └────────┘ │  (passthrough│   │
                    │                      │   M1)         │   │
                    │                      └──────────────┘   │
                    │                                         │
                    │  M2: log store ──▶ M3: cache ──▶        │
                    │  M4: safety+budgets ──▶ M5: routing     │
                    └─────────────────────────────────────────┘
```

Pipeline order is deliberate: authenticate first (never log unauthenticated
traffic), then observe, then the feature stages in the order a request flows.

## Components (M1)

| Component | File | Responsibility |
|---|---|---|
| App bootstrap | `src/index.ts` | Wiring, request-id + access-log middleware, `/health`, route mounting |
| Config | `src/config.ts` | Env parsing with clear errors; fails fast on missing gateway keys, degrades gracefully on missing provider key |
| Auth middleware | `src/middleware/auth.ts` | Bearer-token check against `GATEWAY_API_KEYS`; 401 on missing/unknown key |
| Completions route | `src/routes/completions.ts` | `POST /v1/chat/completions`: validates JSON, forwards untouched to provider, relays status/body/headers (SSE streams pass through) |

## Request lifecycle (M1)

1. Client `POST /v1/chat/completions` with `Authorization: Bearer <gw-key>`.
2. Gateway assigns a UUID request id, starts the timer.
3. Auth middleware: unknown/missing key → `401 { error: "unauthorized …" }`.
4. Body parsed as JSON; invalid JSON → `400`.
5. Missing `PROVIDER_API_KEY` → `500 { error: "provider not configured …" }`.
6. Body forwarded verbatim to `{PROVIDER_BASE_URL}/chat/completions` with the
   provider key. Hop-by-hop headers stripped; `x-gateway-request-id` added.
7. Provider response (including SSE streams) relayed with original status.
8. Access log line: `METHOD path -> status (ms) [request-id]`.

## Interfaces

### HTTP API (stable across milestones — additive only)

- `GET /health` → `200 { ok, service, version }`. No auth.
- `POST /v1/chat/completions` → auth required. Accepts the OpenAI
  chat-completions schema verbatim; returns the provider's schema verbatim
  (plus `x-gateway-request-id` header). Error envelope:
  `{ error: "<human-readable message>" }` with 400 / 401 / 500.

### Configuration (env)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `GATEWAY_API_KEYS` | yes | — | Comma-separated Bearer keys for clients |
| `PROVIDER_API_KEY` | no* | — | Upstream provider key (*requests 500 clearly until set) |
| `PROVIDER_BASE_URL` | no | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint |
| `PORT` | no | `8787` | Listen port |

### Data model

M1 is stateless — nothing is persisted. (M2 introduces the request-log store;
its schema will be documented here when it lands.)

## What's intentionally not built yet

- M2: request-log store + cost dashboard (tokens, $, per-key usage)
- M3: Redis cache + "$ saved" counter
- M4: safety filters (PII redaction, blocklist) + per-key spend caps
- M5: multi-provider adapters + automatic failover

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-11 | Hono on Node 24, TypeScript throughout | Lightweight, fast; one language for gateway + future Next.js dashboard; plays to frontend strength |
| 2026-10-11 | OpenAI-compatible API surface, additive-only | Any existing app/SDK migrates with a one-line `baseURL` change; milestones never break clients |
| 2026-10-11 | Stateless M1; persistence starts at M2 | Smallest shippable slice; logging before storage |
| 2026-10-11 | Hono `Variables` generic for request id | `c.get("requestId")` needs the type declared on both Hono instances (see build log M1) |
| 2026-10-11 | GitHub pushes via API, repo created by owner | GitHub App cannot create repos (403); owner creates, grants access, agent pushes |

## Milestone map

- [x] M1 — Passthrough proxy + auth + logging (2026-10-11)
- [ ] M2 — Log store + cost dashboard
- [ ] M3 — Cache + savings counter
- [ ] M4 — Safety + spend caps
- [ ] M5 — Multi-provider failover
