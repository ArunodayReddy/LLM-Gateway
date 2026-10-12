# llm-gateway

An OpenAI-compatible LLM gateway. Point any OpenAI SDK at it with one config
change (`baseURL`) and get auth, safety filters, caching, spend caps,
multi-provider failover, and cost accounting — the whole arc, milestones 1–6.

## What it does

- `POST /v1/chat/completions` — OpenAI-compatible. Pipeline per request:
  **auth → rate limit → safety blocklist → cache → spend cap → provider failover → log**.
  SSE streams relay untouched (never cached; logged with null tokens).
- **Auth**: per-key Bearer tokens, 401 on missing/unknown key.
- **Rate limiting** (M6): fixed-window per-key caps
  (`RATE_LIMIT_REQUESTS_PER_MINUTE`, default 60, plus `RATE_LIMIT_BURST`,
  default 10 grace requests). Over the cap → 429 with a `Retry-After`
  header and `{ error: "rate limit exceeded", retry_after: N }`. 401s never
  consume quota; streaming counts the same as non-streaming. Current window
  state is exposed on `GET /v1/usage` (`rateLimit`) and the dashboard.
- **Safety** (M4): `BLOCKED_PATTERNS` substrings in prompts → 400;
  PII (emails, phones, SSNs) redacted from everything persisted —
  prompt/response bodies are never stored at all.
- **Cache** (M3): `sha256(model + messages)` keys, non-streaming only,
  Redis when `REDIS_URL` is set, in-memory otherwise. Hits return
  `x-gateway-cache: hit` and never touch the provider.
- **Budgets** (M4): per-key calendar-month spend cap
  (`PER_KEY_MONTHLY_CAP_USD`, default 50) → 402 when exceeded. Cache hits
  bypass the cap — they're free.
- **Failover** (M5): `PROVIDERS` JSON list tried in order on network error,
  timeout, or 5xx (never on 4xx). 502 only when all fail. Falls back to the
  single `PROVIDER_BASE_URL`/`PROVIDER_API_KEY` pair when `PROVIDERS` is unset.
- **Observability** (M2): every request lands in SQLite
  (`request_logs`: key prefix only — never full keys — model, tokens, cost,
  latency, status, cached, provider). `GET /v1/usage` returns aggregates
  (totals, per-key spend, `cacheHits`, `dollarsSaved`, recent rows);
  `GET /dashboard` renders a single-file ops page (auth via a key prompt,
  no build step).
- Request ids + access log line per request; `GET /health` for liveness.

## Quickstart

```bash
cp .env.example .env   # then fill in PROVIDER_API_KEY and GATEWAY_API_KEYS
npm install
npm run dev            # http://localhost:8787
```

Smoke test (no provider key needed for the auth checks):

```bash
# health
curl localhost:8787/health

# missing key -> 401
curl -X POST localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'

# wrong key -> 401
curl -X POST localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer nope' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'

# right key, no provider configured -> clear 500
curl -X POST localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer gw-dev-key-1' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
```

With `PROVIDER_API_KEY` set, the last call returns the provider's real
completion. Any OpenAI SDK works — just set its base URL to
`http://localhost:8787/v1`.

Multi-provider example:

```bash
PROVIDERS='[{"name":"primary","baseUrl":"https://api.openai.com/v1","apiKey":"sk-..."},
            {"name":"fallback","baseUrl":"https://openrouter.ai/api/v1","apiKey":"sk-..."}]'
```

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `GATEWAY_API_KEYS` | (required) | Comma-separated Bearer keys for clients |
| `PROVIDER_API_KEY` / `PROVIDER_BASE_URL` | — / `https://api.openai.com/v1` | Single provider (back-compat) |
| `PROVIDERS` | — | JSON `[{name, baseUrl, apiKey}]` tried in order |
| `UPSTREAM_TIMEOUT_MS` | `30000` | Per-provider timeout before failover |
| `DB_PATH` | `./data/gateway.db` | SQLite log store |
| `REDIS_URL` | — | Set → Redis cache; unset → in-memory |
| `CACHE_TTL_SECONDS` | `3600` | Cache TTL |
| `BLOCKED_PATTERNS` | — | Comma-separated prompt substrings → 400 |
| `PER_KEY_MONTHLY_CAP_USD` | `50` | Per-key monthly spend cap → 402 |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | `60` | Per-key requests per window → 429 |
| `RATE_LIMIT_BURST` | `10` | Grace requests above the per-minute limit |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window length |
| `PORT` | `8787` | Listen port |

## Dashboard

`GET /dashboard` (gateway key required) shows totals cards — requests, tokens,
spend, **cache hits**, **dollars saved**, **rate limit remaining** — plus a recent-requests table
(model, tokens, cost, latency, status, cache hit/miss, serving provider) and
a per-key spend breakdown. Single HTML file, no build step.

## Roadmap

1. ✅ Passthrough proxy + auth + logging
2. ✅ Request log store + cost dashboard (tokens, $, per-key usage)
3. ✅ Redis/in-memory caching + "dollars saved" counter
4. ✅ Safety filters (PII redaction, blocklist) + per-key spend caps
5. ✅ Multi-provider failover
6. ✅ Per-key rate limiting (fixed window + burst, 429 + Retry-After)

Possible next: per-model routing rules, usage webhooks, multi-user dashboard auth. Full spec: `LLM Gateway — Project Spec`
(PDF). Per-milestone stories: `docs/build-log.md`.
