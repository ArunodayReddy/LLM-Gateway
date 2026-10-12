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
