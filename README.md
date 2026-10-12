# llm-gateway

An OpenAI-compatible LLM gateway. Point any OpenAI SDK at it with one config
change (`baseURL`) and get auth, logging, and — in later milestones — caching,
safety filters, smart routing, and cost accounting for free.

## Milestone 1 (this scaffold): authenticated passthrough

- `POST /v1/chat/completions` — forwards the request untouched to the upstream
  provider and relays the response (including SSE streams).
- Bearer-token auth on a per-key basis.
- Request ids + access log line per request (`method path -> status (ms)`).
- `GET /health` for liveness checks.

Explicitly NOT here yet: caching, safety filters, multi-provider routing,
spend caps, dashboard. Those are milestones 2–5 in the project spec.

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

## Roadmap

1. ✅ Passthrough proxy + auth + logging (this)
2. Request log store + cost dashboard (tokens, $, per-key usage)
3. Redis caching + "$ saved" counter
4. Safety filters (PII redaction, blocklist) + per-key spend caps
5. Multi-provider adapters + automatic failover

Full spec: `LLM Gateway — Project Spec` (PDF).
