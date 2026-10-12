import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";

export interface CacheEntry {
  status: number;
  /** Raw upstream response body (JSON text). */
  body: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Estimated cost of this response — on a hit this is "dollars saved". */
  costUsd: number;
}

export interface Cache {
  readonly backend: "redis" | "memory";
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * Cache key: sha256(model + messages). Deliberately ignores sampling params
 * (temperature etc.) — documented tradeoff: identical messages share one
 * cached response. Only non-streaming requests are cached.
 */
export function cacheKeyFor(model: string, messages: unknown): string {
  return createHash("sha256")
    .update(model + "\n" + JSON.stringify(messages))
    .digest("hex");
}

class RedisCache implements Cache {
  readonly backend = "redis" as const;
  private client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.client.on("error", (err) => {
      // Never crash the gateway because the cache is unhappy; misses just
      // fall through to the provider.
      console.warn(`[cache] redis error: ${(err as Error).message}`);
    });
  }

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const raw = await this.client.get(`llmgw:${key}`);
      return raw ? (JSON.parse(raw) as CacheEntry) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    try {
      await this.client.setex(
        `llmgw:${key}`,
        ttlSeconds,
        JSON.stringify(entry),
      );
    } catch {
      // best-effort
    }
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}

class MemoryCache implements Cache {
  readonly backend = "memory" as const;
  private store = new Map<string, { entry: CacheEntry; expiresAt: number }>();

  async get(key: string): Promise<CacheEntry | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return hit.entry;
  }

  async set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      entry,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

let cache: Cache | null = null;

/** Singleton. Logs which backend is active at boot. */
export function getCache(): Cache {
  if (cache) return cache;
  if (config.redisUrl) {
    cache = new RedisCache(config.redisUrl);
    console.log(`cache backend: redis`);
  } else {
    cache = new MemoryCache();
    console.log(`cache backend: memory (set REDIS_URL for a shared cache)`);
  }
  return cache;
}
