import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  on: vi.fn(),
  constructed: [] as unknown[][],
  connection: { fake: "connection" },
}));

vi.mock("bullmq", () => ({
  Queue: class FakeQueue {
    constructor(...args: unknown[]) {
      mocks.constructed.push(args);
    }
    add = mocks.add;
    on = mocks.on;
  },
}));

vi.mock("../security/redis-connection", () => ({
  createRedisConnection: vi.fn(() => mocks.connection),
}));

import { enqueueAnalysis, analysisJobId, ANALYSIS_QUEUE_NAME } from "../jobs/queue";
import { createRedisConnection } from "../security/redis-connection";

describe("analysis queue", () => {
  it("job ids contain no ':' (BullMQ reserves it) and are stable per application", () => {
    expect(analysisJobId("app_123")).toBe("analyze-app_123");
    expect(analysisJobId("app_123")).not.toContain(":");
  });

  it("enqueues with the colon-free job id, retries and the expected payload", async () => {
    await enqueueAnalysis("app_1");

    expect(mocks.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = mocks.add.mock.calls[0];
    expect(name).toBe("analyze");
    expect(data).toEqual({ applicationId: "app_1" });
    expect(opts.jobId).toBe("analyze-app_1");
    expect(opts.attempts).toBe(3);
  });

  it("builds the queue once, on a real ioredis connection created by our helper (never a { url } object)", async () => {
    await enqueueAnalysis("app_2");

    expect(mocks.constructed).toHaveLength(1);
    const [queueName, options] = mocks.constructed[0] as [string, { connection: unknown }];
    expect(queueName).toBe(ANALYSIS_QUEUE_NAME);
    expect(options.connection).toBe(mocks.connection);
    expect(createRedisConnection).toHaveBeenCalledWith({ maxRetriesPerRequest: null });
  });

  it("registers an error listener on the queue", async () => {
    await enqueueAnalysis("app_3");
    expect(mocks.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
