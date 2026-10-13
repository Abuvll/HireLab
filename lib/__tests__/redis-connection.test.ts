import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  constructed: [] as Array<{ url: string; options: Record<string, unknown> }>,
  events: [] as string[],
}));

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    constructor(url: string, options: Record<string, unknown>) {
      mocks.constructed.push({ url, options });
    }
    on(event: string) {
      mocks.events.push(event);
      return this;
    }
  },
}));

import { createRedisConnection } from "../security/redis-connection";

describe("createRedisConnection", () => {
  const originalUrl = process.env.REDIS_URL;

  beforeEach(() => {
    mocks.constructed.length = 0;
    mocks.events.length = 0;
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalUrl;
  });

  it("throws a clear error when REDIS_URL is not set", () => {
    delete process.env.REDIS_URL;
    expect(() => createRedisConnection()).toThrow("REDIS_URL is not set");
  });

  it("connects with the URL from REDIS_URL and no TLS options for plain redis://", () => {
    process.env.REDIS_URL = "redis://cache.internal:6379";
    createRedisConnection();
    expect(mocks.constructed).toHaveLength(1);
    expect(mocks.constructed[0].url).toBe("redis://cache.internal:6379");
    expect(mocks.constructed[0].options).not.toHaveProperty("tls");
  });

  it("sends the host name as the TLS server name (SNI) for rediss:// URLs", () => {
    process.env.REDIS_URL = "rediss://default:secret@db-123.example.cloud:6379";
    createRedisConnection();
    expect(mocks.constructed[0].options.tls).toEqual({ servername: "db-123.example.cloud" });
  });

  it("passes maxRetriesPerRequest through, including null (required by BullMQ)", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    createRedisConnection({ maxRetriesPerRequest: null });
    expect(mocks.constructed[0].options.maxRetriesPerRequest).toBeNull();

    createRedisConnection({ maxRetriesPerRequest: 2 });
    expect(mocks.constructed[1].options.maxRetriesPerRequest).toBe(2);
  });

  it("attaches an error listener so connection errors are logged, not unhandled", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    createRedisConnection();
    expect(mocks.events).toContain("error");
  });
});
