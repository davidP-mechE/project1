import "server-only";
import { Redis } from "ioredis";
import { redisConnection } from "./queue";
import { jsonError } from "./http";
import { fixedWindow, type RateRule } from "@/lib/usage/rate-limit";

/**
 * A small fixed-window rate limiter in Redis, shared by every server instance.
 * Used for routes that are free for us but could be hammered (downloads,
 * answer checks, test submissions). If Redis is unreachable it lets requests
 * through: the database-backed limits on anything that costs money still apply.
 */

let client: Redis | null = null;
function redis() {
  if (!client) {
    client = new Redis({ ...redisConnection(), maxRetriesPerRequest: 1 });
    client.on("error", () => {}); // reported by the call that fails
  }
  return client;
}

export type RateResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export async function rateLimit(rule: RateRule, subject: string, now = Date.now()): Promise<RateResult> {
  const w = fixedWindow(now, rule.windowSeconds);
  const key = `rl:${rule.name}:${subject}:${w.bucket}`;
  try {
    const count = await redis().incr(key);
    if (count === 1) await redis().pexpire(key, w.resetsInMs + 1000);
    if (count > rule.max) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(w.resetsInMs / 1000)) };
    return { ok: true, remaining: rule.max - count };
  } catch (err) {
    console.warn(`[rate-limit] ${rule.name}: Redis unavailable, allowing request`, err instanceof Error ? err.message : err);
    return { ok: true, remaining: rule.max };
  }
}

/** For route handlers: null if allowed, or a 429 response with Retry-After. */
export async function limitOrResponse(rule: RateRule, subject: string) {
  const r = await rateLimit(rule, subject);
  if (r.ok) return null;
  const res = jsonError(`Too many requests. Please wait ${r.retryAfterSeconds} seconds and try again.`, 429);
  res.headers.set("Retry-After", String(r.retryAfterSeconds));
  return res;
}
