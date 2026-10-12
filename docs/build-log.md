# Build log

One entry per milestone. Each entry has four parts:

1. **What shipped** — the engineering facts.
2. **Why it matters** — the business framing (this is the portfolio story).
3. **Hiccup → fix** — what broke and how it was resolved (this is the content gold).
4. **Content pack** — ready-to-post drafts: LinkedIn post, reel script, YouTube Shorts.

---

## M1 — Authenticated passthrough proxy (2026-10-11)

### What shipped

- `POST /v1/chat/completions`: OpenAI-compatible endpoint. Forwards the request
  body untouched to the upstream provider and relays the response — including
  SSE streams — back to the client.
- Bearer-token auth (`src/middleware/auth.ts`): per-key gateway keys, 401 on
  missing/unknown key.
- Request ids (UUID) + one access-log line per request:
  `POST /v1/chat/completions -> 200 (42ms) [request-id]`.
- `GET /health` liveness check. Config via env with fail-fast on missing
  gateway keys and a clear 500 (not a cryptic crash) when the provider key
  isn't set yet.
- Verified: `tsc --noEmit` clean; live smoke test returned 200 / 401 / 401 /
  500 exactly as designed.

### Why it matters

Every AI app starts by calling a provider directly — which means API keys
scattered in code, zero visibility into spend, and no place to add guardrails
later. M1 puts a front door in front of all of that with a one-line client
change (`baseURL`). Nothing intelligent yet — but every future capability
(caching, safety, budgets, failover) now has exactly one place to live.

### Hiccup → fix

1. **Forgot a dependency.** `src/index.ts` imported `@hono/node-server` but it
   wasn't in `package.json`. Caught at install review, not at runtime.
   *Lesson: read your own imports before you run.*
2. **TypeScript rejected `c.get("requestId")`.** Hono's context typing needs the
   variable declared: both Hono instances needed
   `new Hono<{ Variables: { requestId: string } }>()`. Two-line fix once
   understood. *Lesson: framework type errors are usually a missing generic,
   not broken code.*
3. **GitHub App can't create repos (403).** The automation hit a permission
   wall; the human created the repo in 30 seconds and granted access.
   *Lesson: know what your agent can't do and hand it over fast instead of
   retrying.*

### Content pack

**LinkedIn post:**
> Milestone 1 of my LLM gateway is live — and it's deliberately boring.
>
> It's an OpenAI-compatible proxy: any app points its baseURL at the gateway
> instead of calling the provider directly. Bearer-token auth, request IDs,
> and a log line per request. That's it. No caching, no safety filters yet.
>
> Why start here? Because every AI app I've seen calls providers directly —
> keys scattered in code, zero spend visibility, nowhere to add guardrails.
> A front door has to exist before anything smart can live behind it.
>
> Next: a request-log store and a cost dashboard, so every key's spend is
> visible in one place.
>
> Building in public — full build log in the repo. Would you add caching or
> safety filters first? 👇
>
> #AIengineering #LLM #BuildInPublic #TypeScript

**Reel script (~55s):**
- *Hook:* "I just built the front door every AI app needs — and it's boring on purpose."
- *Beat 1:* "It's a proxy. Your app talks to my gateway instead of OpenAI directly. One config change — baseURL — and you're in."
- *Beat 2:* "Every request gets an API key check, a request ID, and a log line. That's milestone one. Nothing smart yet."
- *Beat 3:* "Why? Because right now your API keys are scattered in code, you can't see what you're spending, and there's nowhere to add safety later. The front door comes first."
- *Payoff:* "Next milestone: a dashboard showing exactly what every key spends. Follow — I'm building this whole thing in public."
- *On-screen text:* "The boring front door" → "baseURL → gateway" → "auth + logs" → "Next: cost dashboard"

**YouTube Shorts:**
- *Title:* I Built the Front Door Every AI App Needs (M1)
- *Caption:* Milestone 1 of my open-source LLM gateway: an OpenAI-compatible proxy with auth and request logging. Boring on purpose — the front door has to exist before caching, safety filters, and spend caps can live behind it. Full build log in the repo. Next: cost dashboard. #BuildInPublic #LLM #AIEngineering
- *Hashtags:* #BuildInPublic #LLM #AIEngineering #TypeScript #OpenSource #SoftwareEngineer

---

## M2 — Log store + cost dashboard (planned)

*Entry lands with the milestone.*

## M3 — Cache + savings counter (planned)

*Entry lands with the milestone.*

## M4 — Safety + spend caps (planned)

*Entry lands with the milestone.*

## M5 — Multi-provider failover (planned)

*Entry lands with the milestone.*

---

## M2 — Request-log store + cost dashboard (2026-10-12)

### What shipped

- SQLite log store (`src/db.ts`, `node:sqlite` — zero new native deps):
  `request_logs(id, key_prefix, model, prompt_tokens, completion_tokens,
  cost_usd, latency_ms, status, cached, provider, created_at)`. Only the
  first 8 chars of a gateway key are ever persisted — full keys never touch
  disk.
- Cost accounting (`src/pricing.ts`): per-model USD-per-1M-tokens table;
  unknown models log a one-time warning and record $0.
- Logging wired into `POST /v1/chat/completions`: usage extracted from
  non-streaming JSON responses; SSE streams relay untouched and log with
  null tokens. 401s are never logged (unauthenticated traffic stays invisible).
- `GET /v1/usage` (auth): totals, per-key breakdown, cache stats, last 20 rows.
- `GET /dashboard` (auth): single-file HTML ops page — totals cards,
  recent-requests table, per-key spend. Key entered once via localStorage;
  no build step, no external assets.
- Verified: stub provider returning `usage: {prompt_tokens: 100,
  completion_tokens: 25}` → row logged at exactly $0.00003; streams logged
  with null tokens; `/v1/usage` aggregates matched the rows.

### Why it matters

You can't control what you can't see. Most teams discover their LLM bill the
way they discover a leak — when the ceiling stains. M2 makes every request,
token, and cent visible per API key, in one dashboard. This is the foundation
every later milestone reasons about: caching needs to know what a response
was worth, budgets need to know what a key already spent.

### Hiccup → fix

**`datetime('utc', 'now')` is not a date.** The `created_at` default was
written with the arguments backwards — `'utc'` isn't a valid timestring, so
SQLite evaluated it to NULL and every insert died with `NOT NULL constraint
failed`. The gateway 500'd on real requests while `/health` stayed green.
Fix: `datetime('now')` (already UTC). *Lesson: a green health check only
proves the process is alive — the smoke test has to touch the real path.*

### Content pack

**LinkedIn post:**
> Milestone 2 of my LLM gateway: I can now see every cent.
>
> Every request through the gateway lands in a SQLite log — model, tokens,
> latency, cost — keyed by API key prefix (full keys never touch disk). A
> `/v1/usage` endpoint aggregates it, and a single-file dashboard renders
> totals, per-key spend, and recent requests. No build step, no external deps.
>
> The unglamorous truth about LLM cost control: it starts with a ledger, not
> with cleverness. You can't optimize what you can't see.
>
> Next: the cache — and a dashboard number I'm excited about: "dollars saved."
>
> #BuildInPublic #LLM #AIEngineering #TypeScript

**Reel script (~55s):**
- *Hook:* "Your AI app is spending money right now. Can you prove it isn't wasting it?"
- *Beat 1:* "Milestone 2 of my gateway: every request gets logged — model, tokens, latency, cost. Per API key."
- *Beat 2:* "Full keys never touch the disk. Just the first 8 characters. Enough to bill, not enough to steal."
- *Beat 3:* "One endpoint aggregates it all. One HTML file renders the dashboard. No build step."
- *Payoff:* "Cost control doesn't start with clever tricks. It starts with a ledger. Next milestone: the cache — and a number called 'dollars saved.' Follow for it."
- *On-screen text:* "Where's your LLM spend going?" → "every request: logged" → "keys: prefix only" → "Next: dollars saved"

**YouTube Shorts:**
- *Title:* I Gave My AI Gateway a Ledger (M2)
- *Caption:* Milestone 2: SQLite request logging with per-model cost accounting, a /v1/usage API, and a zero-build dashboard. Full keys never touch disk. Next: caching and the "dollars saved" counter. #BuildInPublic #LLM #AIEngineering
- *Hashtags:* #BuildInPublic #LLM #AIEngineering #TypeScript #OpenSource

---

## M3 — Response cache + savings counter (2026-10-12)

### What shipped

- `Cache` interface (`src/cache.ts`) with two backends: **Redis** when
  `REDIS_URL` is set (ioredis), **in-memory `Map`** otherwise. The active
  backend is logged at boot.
- Cache key: `sha256(model + JSON.stringify(messages))`. Only non-streaming
  responses are cached; TTL from `CACHE_TTL_SECONDS` (default 3600).
- Hits never touch the provider and return `x-gateway-cache: hit`.
- Accounting: a hit logs `cached=1` with `cost_usd` set to the response's
  estimated cost — so `dollars_saved = SUM(cost_usd WHERE cached=1)` and
  actual spend stays clean. Both surface on `/v1/usage` and the dashboard.
- Verified: same request twice → miss then `x-gateway-cache: hit` with
  byte-identical body; different messages → miss; streams never cached;
  usage showed 2 hits / $0.00006 saved against $0.00006 spent.

### Why it matters

This is where the gateway starts *paying for itself*. In real AI apps the
same prompts repeat constantly — system prompts, retries, popular queries.
Every repeat is a provider bill you already paid once. The cache turns
repeats into a dashboard number that goes up: dollars saved. It's the first
milestone a finance person would understand.

### Hiccup → fix

**ioredis's default import isn't constructable.** `import Redis from
"ioredis"` compiled under `module: NodeNext` threw "Cannot use namespace as
a type" — the package's types export the class both ways, and the default
interop didn't survive. Fix: `import { Redis } from "ioredis"`. Two-second
fix, twenty-minute stare. *Lesson: when the import looks right and the
compiler disagrees, check the .d.ts exports before anything else.*

### Content pack

**LinkedIn post:**
> Milestone 3 of my LLM gateway: it now pays for itself.
>
> Identical prompts hit a cache (Redis when configured, in-memory otherwise)
> keyed on model + messages — streams excluded, TTL configurable. A hit never
> touches the provider, and the dashboard tracks the number I care about most:
> dollars saved.
>
> The design decision I'm happiest with: a cache hit logs its row with the
> *avoided* cost, so "actual spend" and "dollars saved" stay cleanly separated
> in the same table. One table, two stories.
>
> Next: safety — PII redaction, prompt blocklists, and per-key spend caps. The
> fun part where the gateway starts saying "no."
>
> #BuildInPublic #LLM #AIEngineering

**Reel script (~55s):**
- *Hook:* "What if your AI app got cheaper the more people used it?"
- *Beat 1:* "Milestone 3: a response cache. Same prompt twice? The second one never touches the provider."
- *Beat 2:* "Redis if you have it, in-memory if you don't. Streams are never cached — you can't cache a live river."
- *Beat 3:* "And the dashboard now has my favorite number: dollars saved. Real money, not vibes."
- *Payoff:* "Cache hits are free, so they skip every budget check downstream. Next: the milestone where the gateway learns to say no. Follow."
- *On-screen text:* "Same prompt, twice" → "2nd one: $0" → "dollars saved: going up" → "Next: the gateway says no"

**YouTube Shorts:**
- *Title:* My AI Gateway Now Pays for Itself (M3)
- *Caption:* Milestone 3: Redis/in-memory response caching with a "dollars saved" counter on the dashboard. Same prompt twice = second one free. Next: safety filters and spend caps. #BuildInPublic #LLM #AIEngineering
- *Hashtags:* #BuildInPublic #LLM #AIEngineering #Redis #TypeScript

---

## M4 — Safety filters + spend caps (2026-10-12)

### What shipped

- **PII redaction** (`src/safety.ts`): emails, US-style phone numbers, and
  SSN-like patterns are redacted in every text value written to the log
  store. Backed by a stronger guarantee: prompt/response bodies are never
  persisted at all — the store holds metadata only.
- **Blocklist**: `BLOCKED_PATTERNS` env (comma-separated substrings,
  case-insensitive) scanned against extracted prompt text *before anything
  billable happens* → `400 { error: "request blocked by safety filter" }`.
- **Spend caps**: `PER_KEY_MONTHLY_CAP_USD` (default 50). The key's UTC-month
  spend is checked before proxying → `402 { error: "monthly spend cap
  exceeded" }`. Cache hits bypass the cap (they cost $0 — blocking them
  would be wrong).
- All three are logged with their real statuses (400/402), PII-redacted.
- Verified: cap of $0.00001 → first request 200, repeat served from cache,
  new request 402; blocked substring → 400; redactor unit-tested on
  emails/phones/SSNs.

### Why it matters

An API key is a credit card with no limit — until this milestone. Runaway
agents, prompt-injection loops, and leaked keys are how AI bills go from
annoying to career-limiting. Spend caps turn "please don't" into "can't":
the gateway enforces the budget itself, per key, per month. The blocklist
and PII redaction are the same idea applied to content: decide the policy
once, in one place, instead of in every app.

### Hiccup → fix

**Where should the cap check live — before or after the cache?** First
instinct was "check the budget before doing anything," but that would block
cache hits for a key that's over cap — punishing the one request type that
costs nothing. The check moved *after* the cache lookup: free requests
always serve, billable ones respect the budget. *Lesson: order your pipeline
by what each stage costs, not by how strict it feels.*

### Content pack

**LinkedIn post:**
> Milestone 4 of my LLM gateway: it learned to say "no."
>
> Three guardrails, one pipeline position — before anything billable happens:
> a prompt blocklist (configurable substrings → 400), per-key monthly spend
> caps (→ 402 when exceeded), and PII redaction on everything written to the
> log store. Prompt and response bodies are never persisted at all.
>
> The subtle call: the spend cap is checked *after* the cache lookup, so free
> cache hits always serve. Budgets should block spending, not freeloading.
>
> An API key is a credit card with no limit. Now it has one.
>
> Next and last: multi-provider failover — because one provider is a single
> point of failure. #BuildInPublic #LLM #AISecurity

**Reel script (~55s):**
- *Hook:* "Your API key is a credit card with no limit. I just gave mine one."
- *Beat 1:* "Milestone 4: three guardrails. A blocklist that scans prompts before anything billable happens."
- *Beat 2:* "Per-key monthly spend caps. Hit your budget? 402. The gateway says no so your wallet doesn't have to."
- *Beat 3:* "And PII redaction — emails, phone numbers never touch the log. Actually, prompt bodies never touch the log at all."
- *Payoff:* "The clever bit: cache hits skip the budget check, because they're free. One milestone left: what happens when your provider goes down. Follow."
- *On-screen text:* "API key = unlimited credit card?" → "now: monthly cap" → "blocked prompts: 400" → "PII: never stored" → "Next: provider goes down"

**YouTube Shorts:**
- *Title:* My AI Gateway Learned to Say No (M4)
- *Caption:* Milestone 4: prompt blocklists, per-key monthly spend caps (402 when exceeded), and PII redaction. Cache hits bypass the cap because they're free. Last milestone next: multi-provider failover. #BuildInPublic #LLM #AISecurity
- *Hashtags:* #BuildInPublic #LLM #AISecurity #AIEngineering #TypeScript

---

## M5 — Multi-provider routing + failover (2026-10-12)

### What shipped

- `PROVIDERS` env: JSON array `[{name, baseUrl, apiKey}]`, tried in priority
  order. Falls back to the single `PROVIDER_BASE_URL`/`PROVIDER_API_KEY`
  pair when unset — M1 configs keep working untouched.
- Failover (`src/providers.ts`): on network error, timeout
  (`UPSTREAM_TIMEOUT_MS`, default 30s, via `AbortController`), or HTTP 5xx,
  the gateway tries the next provider. Deliberately **no failover on 4xx** —
  a 401/429 would just repeat against the next provider.
- 502 `{ error: "all providers failed" }` only when every provider fails.
- The serving provider's name is recorded on every log row (schema migration
  via `ALTER TABLE` at boot) and shown on the dashboard.
- Verified: `[bad(500), good(200)]` → 200 served by "good", row logged with
  `provider: "good"`; all-dead list → 502; no `PROVIDERS` env → back-compat
  single "default" provider, 200.

### Why it matters

One provider is a single point of failure with a monopoly on your uptime.
Outages, rate limits, and price hikes all argue for optionality — but every
app hardcoding one provider's SDK can't switch without a deploy. The gateway
makes failover a config change: list providers in priority order, and the
front door routes around the fire. This is the milestone that turns the
project from "cost tool" into "infrastructure."

### Hiccup → fix

**The test gateway booted in the wrong directory.** The back-compat check
spawned `npx tsx src/index.ts` from `$HOME` instead of the project dir and
died with `Cannot find module '/home/hatch/src/index.ts'` — while the
"real" test looked broken. Two minutes of confusion, one `cd` to fix.
*Lesson: when a smoke test fails in a way the code can't explain, suspect
the harness before the code.*

### Content pack

**LinkedIn post:**
> Milestone 5 of my LLM gateway — the last one: it routes around failure.
>
> `PROVIDERS` is now an ordered list. On network errors, timeouts, or 5xx,
> the gateway fails over to the next provider automatically. No failover on
> 4xx — a bad key would just fail twice. 502 only when everything is down.
> Every row logs which provider served it, so the dashboard shows your
> real traffic split.
>
> That's the full arc: M1 the front door → M2 the ledger → M3 the cache →
> M4 the guardrails → M5 the failover. One config change migrates any
> OpenAI-compatible app onto all of it.
>
> Five milestones, one repo, zero broken clients. What would you add next?
> #BuildInPublic #LLM #AIEngineering

**Reel script (~55s):**
- *Hook:* "What happens to your AI app when OpenAI goes down?"
- *Beat 1:* "Final milestone of my gateway: multi-provider failover. You list providers in order. The gateway tries each one."
- *Beat 2:* "Network error? Timeout? 500? It moves to the next. But never on 4xx — a bad request would just fail twice."
- *Beat 3:* "Everything down? Then — and only then — 502. Every row logs which provider served it."
- *Payoff:* "Five milestones. Front door, ledger, cache, guardrails, failover. One repo. And any OpenAI app migrates with one config change. Series complete — what should I build next? Follow."
- *On-screen text:* "Provider down?" → "failover: automatic" → "4xx: no retry (would fail twice)" → "5 milestones. Done." → "What next?"

**YouTube Shorts:**
- *Title:* My AI Gateway Routes Around Outages (M5 — Final)
- *Caption:* Final milestone: ordered multi-provider failover on network errors, timeouts, and 5xx — never on 4xx. 502 only when all fail. Full arc: front door → ledger → cache → guardrails → failover. #BuildInPublic #LLM #AIEngineering
- *Hashtags:* #BuildInPublic #LLM #AIEngineering #Reliability #TypeScript

---

## M6 — Per-key rate limiting (2026-10-12)

### What shipped

- `src/ratelimit.ts`: `RateLimiter` interface with check-and-consume plus
  non-consuming `peek`. Fixed-window per-key counters: `RATE_LIMIT_REQUESTS_PER_MINUTE`
  (default 60) + `RATE_LIMIT_BURST` (default 10) flat grace allowance.
  `RATE_LIMIT_WINDOW_SECONDS` (default 60) makes the window configurable.
- Backend follows the cache's Redis-or-memory pattern: atomic `INCR` +
  `EXPIRE` on `llmgw:rl:<keyPrefix>:<window>` when `REDIS_URL` is set (safe
  across gateway instances), in-memory `Map` otherwise. Fail-open on Redis
  errors — a down limiter never 429s everyone.
- Enforcement sits right after auth, before body parsing: every request
  counts (streaming too, cache hits too, malformed JSON too). Unauthenticated
  401s never reach the limiter, so they don't consume quota.
- Over the cap → `429 { error: "rate limit exceeded", retry_after: N }` with
  a `Retry-After` header (seconds to window reset). 429s are logged to
  SQLite like every other stage.
- `GET /v1/usage` now includes `rateLimit: { limit, remaining, resetAt }`
  for the calling key; the dashboard shows a "Rate limit" card.
- Verified: `tsc --noEmit` clean; smoke matrix — 7 allowed then 429s with
  correct `Retry-After` header and body, window reset restores quota,
  3 unauthenticated requests left `remaining` untouched, one SSE stream
  request decremented quota by exactly 1, 429 rows present in the log store.

### Why it matters

Spend caps (M4) protect your wallet from runaway agents; rate limits protect
your provider account from runaway *traffic*. A retry storm, a hot loop, or
a leaked key hammering the gateway can burn through quotas, trigger the
provider's own throttling, or just look like abuse. Per-key limits give every
API key its own lane: one misbehaving client gets 429s while everyone else
sails through. And because the limit runs before the cache, it also stops
someone from using your gateway as a free infinite-loop machine — even
cache hits count. This was the one piece of the original vision
(auth → rate limits → safety → cache → routing → cost) that never got its
own milestone. Now the architecture story is complete.

### Hiccup → fix

**The first smoke test lied to me.** I fired 9 requests at a 5+2 limit and
expected 7 allowed + 2 rejected — and got exactly that. Then the very next
check, milliseconds later, returned 200-style behavior where I expected a
429. For a moment the limiter looked broken. It wasn't: my test window was
3 seconds and the window had rolled over between the two shell commands.
The limiter was right; my test harness was racing the clock.
*Lesson: when testing time-based behavior, assert inside the window or
control the clock — don't trust two shell commands to land in the same
3 seconds.*
(The fix for the test: `RATE_LIMIT_WINDOW_SECONDS` exists precisely so
tests can use a tiny window deliberately, and the real assertions all run
back-to-back within one window.)

### Content pack

**LinkedIn post:**
> Milestone 6 of my LLM gateway — the one the original design always called
> for: per-key rate limiting.
>
> Fixed window, 60 requests/minute per key plus a 10-request burst allowance.
> Over the cap → 429 with a Retry-After header. It runs before everything —
> even cache hits count, because a hot loop on cached responses is still
> abuse. 401s never consume quota. Redis-backed (atomic INCR) when
> configured, in-memory otherwise, fail-open if Redis is down.
>
> Spend caps protect your wallet; rate limits protect your provider account.
> The full arc is now: auth → rate limit → safety → cache → budgets →
> failover → cost accounting. One repo, zero broken clients.
> #BuildInPublic #LLM #AIEngineering

**Reel script (~55s):**
- *Hook:* "Your API key is a credit card. I gave mine a speed limit."
- *Beat 1:* "Milestone 6 of my gateway: per-key rate limiting. 60 requests a minute, plus a burst allowance. Go over? 429 — try again in N seconds."
- *Beat 2:* "It runs before everything. Even cache hits count — a hot loop on free responses is still abuse. But failed logins never eat your quota."
- *Beat 3:* "Redis-backed with atomic counters when configured, in-memory otherwise. And if Redis dies, it fails open — never 429s everyone by accident."
- *Payoff:* "Spend caps protect your wallet, rate limits protect your provider account. Full arc complete: auth, rate limit, safety, cache, budgets, failover. Follow for the live demo next."
- *On-screen text:* "60/min per key" → "429 + Retry-After" → "cache hits count too" → "fail-open on Redis down" → "Next: live demo"

**YouTube Shorts:**
- *Title:* My AI Gateway Got a Speed Limit (M6)
- *Caption:* Milestone 6: fixed-window per-key rate limiting — 60/min + burst, 429 with Retry-After, enforced before everything (cache hits count, 401s don't). Redis or in-memory, fail-open. Full gateway arc complete. #BuildInPublic #LLM #AIEngineering
- *Hashtags:* #BuildInPublic #LLM #AIEngineering #TypeScript #APIDesign
