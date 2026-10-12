import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

export interface RequestLogInput {
  keyPrefix: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number;
  latencyMs: number;
  status: number;
  /** 1 when served from cache (cost_usd then means "dollars saved"). */
  cached: 0 | 1;
  /** M5: which provider served the request. Null for M2–M4 rows. */
  provider: string | null;
}

export interface RecentLog extends RequestLogInput {
  id: number;
  createdAt: string;
}

export interface UsageAggregates {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  /** Actual provider spend: sum of cost_usd for non-cached requests. */
  totalCostUsd: number;
  cacheHits: number;
  /** Avoided spend: sum of cost_usd for cached requests. */
  dollarsSaved: number;
  byKey: Array<{
    keyPrefix: string;
    requests: number;
    costUsd: number;
  }>;
  recent: RecentLog[];
}

let db: DatabaseSync | null = null;

function columnExists(table: string, column: string): boolean {
  const rows = db!
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

/** Open (and migrate) the SQLite store. Idempotent. */
export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_prefix TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cost_usd REAL NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL,
      status INTEGER NOT NULL,
      cached INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logs_created ON request_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_key ON request_logs(key_prefix);
  `);

  // M5 migration: record which provider served each request.
  if (!columnExists("request_logs", "provider")) {
    db.exec(`ALTER TABLE request_logs ADD COLUMN provider TEXT`);
  }

  return db;
}

export function logRequest(input: RequestLogInput): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO request_logs
       (key_prefix, model, prompt_tokens, completion_tokens, cost_usd,
        latency_ms, status, cached, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.keyPrefix,
    input.model,
    input.promptTokens,
    input.completionTokens,
    input.costUsd,
    input.latencyMs,
    input.status,
    input.cached,
    input.provider,
  );
}

export function getUsage(): UsageAggregates {
  const d = getDb();

  const totals = d
    .prepare(
      `SELECT
         COUNT(*) AS total_requests,
         COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
         COALESCE(SUM(CASE WHEN cached = 0 THEN cost_usd ELSE 0 END), 0) AS total_cost_usd,
         COALESCE(SUM(cached), 0) AS cache_hits,
         COALESCE(SUM(CASE WHEN cached = 1 THEN cost_usd ELSE 0 END), 0) AS dollars_saved
       FROM request_logs`,
    )
    .get() as {
    total_requests: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_cost_usd: number;
    cache_hits: number;
    dollars_saved: number;
  };

  const byKey = d
    .prepare(
      `SELECT key_prefix AS keyPrefix, COUNT(*) AS requests,
              COALESCE(SUM(CASE WHEN cached = 0 THEN cost_usd ELSE 0 END), 0) AS costUsd
       FROM request_logs GROUP BY key_prefix ORDER BY requests DESC`,
    )
    .all() as Array<{ keyPrefix: string; requests: number; costUsd: number }>;

  const recent = d
    .prepare(
      `SELECT id, key_prefix AS keyPrefix, model,
              prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
              cost_usd AS costUsd, latency_ms AS latencyMs, status, cached,
              provider, created_at AS createdAt
       FROM request_logs ORDER BY id DESC LIMIT 20`,
    )
    .all() as unknown as RecentLog[];

  return {
    totalRequests: totals.total_requests,
    totalPromptTokens: totals.total_prompt_tokens,
    totalCompletionTokens: totals.total_completion_tokens,
    totalCostUsd: totals.total_cost_usd,
    cacheHits: totals.cache_hits,
    dollarsSaved: totals.dollars_saved,
    byKey: byKey.map((r) => ({
      keyPrefix: r.keyPrefix,
      requests: r.requests,
      costUsd: r.costUsd,
    })),
    recent,
  };
}

/** Month-to-date actual spend for one key prefix (UTC month). Used by M4 caps. */
export function getMonthSpendUsd(keyPrefix: string): number {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN cached = 0 THEN cost_usd ELSE 0 END), 0) AS spend
       FROM request_logs
       WHERE key_prefix = ?
         AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`,
    )
    .get(keyPrefix) as { spend: number };
  return row.spend;
}
