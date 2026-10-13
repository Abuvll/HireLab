import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ping: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../db", () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock("../security/redis-connection", () => ({
  createRedisConnection: () => ({ ping: mocks.ping, disconnect: mocks.disconnect }),
}));

import { GET as liveness } from "../../app/api/health/route";
import { GET as readiness } from "../../app/api/health/ready/route";

describe("GET /api/health (liveness)", () => {
  it("returns 200 {status: ok} without touching the database or Redis", async () => {
    const res = await liveness();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.ping).not.toHaveBeenCalled();
  });
});

describe("GET /api/health/ready (readiness)", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.ping.mockReset();
    mocks.disconnect.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns 200 when both PostgreSQL and Redis answer", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mocks.ping.mockResolvedValue("PONG");

    const res = await readiness();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: { database: "ok", redis: "ok" } });
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("returns 503 and names the failing dependency when the database is down", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED postgres://user:hunter2@db.example:5432"));
    mocks.ping.mockResolvedValue("PONG");

    const res = await readiness();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"database":"down"');
    expect(text).toContain('"redis":"ok"');
    // never leaks error details / connection strings to the caller
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("ECONNREFUSED");
  });

  it("returns 503 when Redis is down, and still disconnects its short-lived client", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mocks.ping.mockRejectedValue(new Error("Connection is closed."));

    const res = await readiness();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable", checks: { database: "ok", redis: "down" } });
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});
