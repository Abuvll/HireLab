import Redis from "ioredis";

export type RedisConnectionOptions = {
  /** BullMQ workers/queues need `null` (they manage retries themselves); plain clients usually want a small number. */
  maxRetriesPerRequest?: number | null;
};

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
