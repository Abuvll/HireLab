import { describe, it, expect } from "vitest";
import { percentileRank, computePercentiles, rankTopN } from "../scoring/rank";
import type { RankableApplication } from "../scoring/rank";

function makeApp(id: string, matchPct: number, meetsRequirements = true): RankableApplication {
  return {
    applicationId: id,
    meetsRequirements,
    matchPct,
    scores: { reqMatch: matchPct, consistency: matchPct, collaboration: matchPct, codeQuality: matchPct },
  };
}

describe("percentileRank", () => {
  it("gives the best value in a pool a percentile of 100", () => {
    expect(percentileRank(90, [50, 60, 90])).toBe(100);
  });
  it("gives the worst value in a pool a percentile of 0", () => {
    expect(percentileRank(50, [50, 60, 90])).toBe(0);
  });
  it("returns 100 for a pool of one", () => {
    expect(percentileRank(42, [42])).toBe(100);
  });
});

describe("computePercentiles", () => {
  it("excludes non-qualifying applicants from the pool", () => {
    const apps = [makeApp("a", 90), makeApp("b", 50, false), makeApp("c", 70)];
    const result = computePercentiles(apps);
    expect(result.map((r) => r.applicationId)).toEqual(["a", "c"]);
  });

  it("ranks the top scorer at the 100th percentile", () => {
    const apps = [makeApp("a", 90), makeApp("b", 60), makeApp("c", 75)];
    const result = computePercentiles(apps);
    const top = result.find((r) => r.applicationId === "a")!;
    expect(top.overall).toBe(100);
  });
});

describe("rankTopN", () => {
  const apps = [
    makeApp("a", 60),
    makeApp("b", 95),
    makeApp("c", 80),
    makeApp("d", 40, false), // unqualified — must never appear
    makeApp("e", 70),
  ];

  it("returns applicants sorted by matchPct descending", () => {
    const top = rankTopN(apps, "all");
    expect(top.map((a) => a.applicationId)).toEqual(["b", "c", "e", "a"]);
  });

  it("excludes unqualified applicants entirely", () => {
    const top = rankTopN(apps, "all");
    expect(top.find((a) => a.applicationId === "d")).toBeUndefined();
  });

  it("respects the topN slice size", () => {
    const top = rankTopN(apps, 2);
    expect(top.map((a) => a.applicationId)).toEqual(["b", "c"]);
  });
});
