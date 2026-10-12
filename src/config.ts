import "dotenv/config";
import { parseProviders, type ProviderDef } from "./providers.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional("PORT", "8787")),
  // Upstream provider (OpenAI-compatible). Default = OpenAI itself.
  providerBaseUrl: optional("PROVIDER_BASE_URL", "https://api.openai.com/v1"),
  // NOTE: intentionally NOT required at boot — the server starts without it
  // so you can smoke-test auth locally. Requests fail with a clear 500
  // until it is set.
  providerApiKey: process.env["PROVIDER_API_KEY"] ?? "",
  // Comma-separated gateway API keys clients must present as Bearer tokens.
  gatewayApiKeys: new Set(
    required("GATEWAY_API_KEYS")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  ),
  // SQLite request-log store (M2). Directory is created on boot.
  dbPath: optional("DB_PATH", "./data/gateway.db"),
  // Response cache (M3). Redis when set, in-memory Map otherwise.
  redisUrl: process.env["REDIS_URL"] ?? "",
  cacheTtlSeconds: Number(optional("CACHE_TTL_SECONDS", "3600")),
  // Safety (M4): comma-separated substrings blocked in prompts (case-insensitive).
  blockedPatterns: (process.env["BLOCKED_PATTERNS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // Budgets (M4): per-key calendar-month spend cap in USD.
  perKeyMonthlyCapUsd: Number(optional("PER_KEY_MONTHLY_CAP_USD", "50")),
  // Multi-provider (M5): ordered provider list with failover. Falls back to
  // the single M1 provider env vars when PROVIDERS is unset.
  providers: parseProviders(process.env) as ProviderDef[],
  upstreamTimeoutMs: Number(optional("UPSTREAM_TIMEOUT_MS", "30000")),
};
