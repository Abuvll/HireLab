import Redis from "ioredis";

// Redis-backed fixed-window rate limiter. Deliberately NOT in-memory:
// this app runs the Next.js server and the analysis worker as separate
// processes (see lib/jobs/worker.ts), and in production you'd run more
// than one web instance behind a load balancer — an in-memory counter
// would silently under-count (each instance/process only sees its own
// share of requests) and give a false sense of protection. Reuses
// REDIS_URL, the same connection this app already requires for BullMQ.

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set");
    client = new Redis(url, { maxRetriesPerRequest: 2 });
  }
  return client;
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
};

// key should already identify the scope you want limited, e.g.
// `login:${ip}`, `login:${email}`, `apply-upload:${ip}`. Combine
// per-IP and per-identity keys at the call site (check both, reject if
// either is exhausted) rather than this function trying to be clever
// about it — see lib/api/auth.ts for the pattern used on login.
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getClient();
  const redisKey = `ratelimit:${key}`;

  // INCR + EXPIRE-if-new, atomically enough for this purpose via a small
  // Lua script — avoids a race where two concurrent requests both see
  // count=1 and both set an expiry, which could otherwise let the window
  // silently extend forever under sustained load.
  const luaScript = `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then
      redis.call("EXPIRE", KEYS[1], ARGV[1])
    end
    local ttl = redis.call("TTL", KEYS[1])
    return {current, ttl}
  `;
  const [count, ttl] = (await redis.eval(luaScript, 1, redisKey, windowSeconds.toString())) as [
    number,
    number
  ];

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAtMs: Date.now() + Math.max(0, ttl) * 1000,
  };
}

// Fails OPEN (allows the request) if Redis is unreachable — a rate-limiter
// outage should degrade to "unprotected," not "the whole app is down,"
// since the endpoints it guards have their own auth/validation as a
// second layer regardless. Logs loudly so the outage isn't silent.
export async function checkRateLimitSafe(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    return await checkRateLimit(key, limit, windowSeconds);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[rate-limit] Redis unavailable, failing open for key "${key}":`, err);
    return { allowed: true, remaining: limit, resetAtMs: Date.now() + windowSeconds * 1000 };
  }
}

export function getClientIp(headers: Headers): string {
  // Behind most reverse proxies / platforms (Vercel, nginx, Cloudflare),
  // the real client IP is the first entry in x-forwarded-for. Falls back
  // to a constant so requests without the header (e.g. direct-to-origin
  // in local dev) still get rate-limited as "one bucket" rather than
  // throwing — not a bypass, since local dev has no adversarial traffic
  // and a misconfigured proxy in production is a deploy-config bug to
  // catch via the production-readiness checklist, not something this
  // function should paper over silently.
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "unknown";
}
