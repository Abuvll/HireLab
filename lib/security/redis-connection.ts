import Redis from "ioredis";

export type RedisConnectionOptions = {
  /** BullMQ workers/queues need `null` (they manage retries themselves); plain clients usually want a small number. */
  maxRetriesPerRequest?: number | null;
};

/**
 * Creates an ioredis client from REDIS_URL.
 *
 * - `rediss://` URLs (TLS, used by most managed Redis services) get the host name sent as the TLS server name (SNI).
 *   Some providers route connections by SNI and refuse clients that don't send it.
 * - We always pass a real ioredis client (never `{ url }`) to BullMQ: ioredis' documented way to use a URL is
 *   `new Redis(url)`, and an options object with a `url` key is not guaranteed to be honoured — it could silently
 *   fall back to localhost.
 * - An "error" listener is always attached so a connection hiccup (e.g. a managed Redis waking up) is logged
 *   instead of becoming an unhandled "error" event.
 */
export function createRedisConnection(options: RedisConnectionOptions = {}): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");

  const parsed = new URL(url);
  const client = new Redis(url, {
    ...(parsed.protocol === "rediss:" ? { tls: { servername: parsed.hostname } } : {}),
    ...options,
  });

  client.on("error", (err: Error) => {
    console.error(`[redis] connection error: ${err.message}`);
  });

  return client;
}
