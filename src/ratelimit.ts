import { Redis } from "ioredis";
import { config } from "./config.js";

export interface RateLimitState {
  allowed: boolean;
  /** Effective per-window cap = requestsPerMinute + burst. */
  limit: number;
  /** Requests left in the current window (0 when over the cap). */
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** Whole seconds until reset — drives the Retry-After header. */
  retryAfterSec: number;
}

export interface RateLimiter {
  readonly backend: "redis" | "memory";
  /** Check-and-consume one request for the key prefix. */
  check(keyPrefix: string): Promise<RateLimitState>;
  /** Read current state without consuming quota. */
  peek(keyPrefix: string): Promise<RateLimitState>;
}

function windowOf(now: number): number {
  return Math.floor(now / config.rateLimitWindowMs);
}

function buildState(count: number, now: number): RateLimitState {
  const limit = config.rateLimitRequestsPerMinute + config.rateLimitBurst;
  const resetAt = (windowOf(now) + 1) * config.rateLimitWindowMs;
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

class MemoryRateLimiter implements RateLimiter {
  readonly backend = "memory" as const;
  // `${keyPrefix}:${window}` -> requests consumed in that window
  private counts = new Map<string, number>();

  private keyFor(keyPrefix: string, now: number): string {
    return `${keyPrefix}:${windowOf(now)}`;
  }

  private sweep(now: number): void {
    if (this.counts.size < 5000) return;
    const cur = windowOf(now);
    for (const k of this.counts.keys()) {
      const w = Number(k.slice(k.lastIndexOf(":") + 1));
      if (w < cur) this.counts.delete(k);
    }
  }

  async check(keyPrefix: string): Promise<RateLimitState> {
    const now = Date.now();
    const k = this.keyFor(keyPrefix, now);
    const count = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, count);
    this.sweep(now);
    return buildState(count, now);
  }

  async peek(keyPrefix: string): Promise<RateLimitState> {
    const now = Date.now();
    return buildState(this.counts.get(this.keyFor(keyPrefix, now)) ?? 0, now);
  }
}

class RedisRateLimiter implements RateLimiter {
  readonly backend = "redis" as const;
  private client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.client.on("error", (err) => {
      // Fail open on Redis trouble — a down cache shouldn't 500 the
      // gateway, and a down limiter shouldn't 429 it.
      console.warn(`[ratelimit] redis error: ${(err as Error).message}`);
    });
  }

  private keyFor(keyPrefix: string, now: number): string {
    return `llmgw:rl:${keyPrefix}:${windowOf(now)}`;
  }

  private openState(): RateLimitState {
    const limit = config.rateLimitRequestsPerMinute + config.rateLimitBurst;
    return { allowed: true, limit, remaining: limit, resetAt: 0, retryAfterSec: 0 };
  }

  async check(keyPrefix: string): Promise<RateLimitState> {
    const now = Date.now();
    const k = this.keyFor(keyPrefix, now);
    try {
      // INCR is atomic, so concurrent gateway instances share one counter.
      const count = await this.client.incr(k);
      if (count === 1) {
        await this.client.expire(k, Math.ceil(config.rateLimitWindowMs / 1000) + 5);
      }
      return buildState(count, now);
    } catch {
      return this.openState();
    }
  }

  async peek(keyPrefix: string): Promise<RateLimitState> {
    const now = Date.now();
    try {
      const raw = await this.client.get(this.keyFor(keyPrefix, now));
      return buildState(raw ? Number(raw) : 0, now);
    } catch {
      return this.openState();
    }
  }
}

let limiter: RateLimiter | null = null;

/** Singleton. Logs which backend is active at boot. */
export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  if (config.redisUrl) {
    limiter = new RedisRateLimiter(config.redisUrl);
    console.log(`rate limiter backend: redis`);
  } else {
    limiter = new MemoryRateLimiter();
    console.log(`rate limiter backend: memory (set REDIS_URL for a shared limiter)`);
  }
  return limiter;
}
