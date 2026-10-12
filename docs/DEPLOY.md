# Deploying the LLM Gateway

The gateway is a single Node service. It needs:
- `PORT` (default 3000)
- `GATEWAY_API_KEYS` — comma-separated keys you hand out
- `PROVIDER_BASE_URL` + `PROVIDER_API_KEY` — your upstream (OpenAI-compatible)
- Optional: `REDIS_URL`, `RATE_LIMIT_*`, `PER_KEY_MONTHLY_CAP_USD`, `BLOCKED_PATTERNS`, `CACHE_TTL_SECONDS`
- A persistent volume mounted at `/app/data` if you want the SQLite log store to survive restarts

## Option A — Render (easiest, free tier)

1. Push this repo (already on GitHub).
2. Render dashboard → New → Web Service → select `ArunodayReddy/LLM-Gateway`.
3. Render auto-detects the `Dockerfile`. Set env vars above.
4. Add a disk: Mount Path `/app/data`, size 1 GB.
5. Deploy. Your gateway is at `https://<name>.onrender.com`.

## Option B — Railway

1. New project → Deploy from GitHub → select the repo.
2. Add variables (same list as above).
3. Add a volume mounted at `/app/data`.

## Option C — Fly.io

```bash
fly launch  # accept the Dockerfile build
fly volumes create llm_data --size 1
fly secrets set GATEWAY_API_KEYS=... PROVIDER_API_KEY=...
fly deploy
```

## Smoke test after deploy

```bash
curl https://<your-url>/health
curl -H "Authorization: Bearer <your-key>" https://<your-url>/v1/usage
```

Then run one real completion through it and watch the cost dashboard log the
request, tokens, and dollar cost.
