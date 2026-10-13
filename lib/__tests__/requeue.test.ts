import { describe, it, expect } from "vitest";
import { requeueProcessing } from "../jobs/requeue";

const NOW = new Date("2026-10-12T12:00:00Z");

function deps(ids: string[], enqueue: (id: string) => Promise<void> = async () => {}) {
  const asked: Date[] = [];
  const queued: string[] = [];
  return {
    asked,
    queued,
    deps: {
      now: () => NOW,
      findProcessing: async (before: Date) => {
        asked.push(before);
        return ids.map((id) => ({ id }));
      },
      enqueue: async (id: string) => {
        await enqueue(id);
        queued.push(id);
      },
    },
  };
}

describe("requeueProcessing", () => {
  it("looks for applications older than 15 minutes by default and queues each one", async () => {
    const d = deps(["a1", "a2"]);
    const r = await requeueProcessing(d.deps);
    expect(d.asked[0].toISOString()).toBe("2026-10-12T11:45:00.000Z");
    expect(d.queued).toEqual(["a1", "a2"]);
    expect(r).toEqual({ found: 2, requeued: 2, failed: [] });
  });

  it("honours olderThanMinutes", async () => {
    const d = deps([]);
    await requeueProcessing(d.deps, { olderThanMinutes: 60 });
    expect(d.asked[0].toISOString()).toBe("2026-10-12T11:00:00.000Z");
  });

  it("a dry run only counts", async () => {
    const d = deps(["a1", "a2", "a3"]);
    const r = await requeueProcessing(d.deps, { dryRun: true });
    expect(d.queued).toEqual([]);
    expect(r).toEqual({ found: 3, requeued: 0, failed: [] });
  });

  it("one failure doesn't stop the others and is reported with its id", async () => {
    const d = deps(["a1", "a2", "a3"], async (id) => {
      if (id === "a2") throw new Error("REDIS_URL is not set");
    });
    const r = await requeueProcessing(d.deps);
    expect(d.queued).toEqual(["a1", "a3"]);
    expect(r.found).toBe(3);
    expect(r.requeued).toBe(2);
    expect(r.failed).toEqual([{ id: "a2", error: "REDIS_URL is not set" }]);
  });

  it("nothing to do is not an error", async () => {
    const r = await requeueProcessing(deps([]).deps);
    expect(r).toEqual({ found: 0, requeued: 0, failed: [] });
  });
});
