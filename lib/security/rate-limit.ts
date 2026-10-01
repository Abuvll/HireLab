import Redis from "ioredis";

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

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getClient();
  const redisKey = `ratelimit:${key}`;

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
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "unknown";
}
