import { describe, it, expect } from "vitest";
import {
  buildRankedList,
  buildRankedListWithMatches,
  collectTechOptions,
  computeInitials,
  computeStandout,
  type RankableCandidate,
} from "../api/ranked-list";

function makeCandidate(overrides: Partial<RankableCandidate> = {}): RankableCandidate {
  return {
    applicationId: "app1",
    name: "Candidate",
    meetsRequirements: true,
    matchPct: 80,
    scores: { codeQuality: 80, consistency: 80, collaboration: 80, reqMatch: 80 },
    languages: ["Python"],
    languageBreakdown: [{ name: "Python", pct: 100 }],
    topSkills: ["Python"],
    tooling: { Docker: true },
    hasShippedProject: true,
    ...overrides,
  };
}

describe("computeInitials", () => {
  it("takes the first letter of the first and last word", () => {
    expect(computeInitials("Maren Ito")).toBe("MI");
  });
  it("handles a middle name by ignoring it", () => {
    expect(computeInitials("Maren Elizabeth Ito")).toBe("MI");
  });
  it("doubles the single letter for a one-word name", () => {
    expect(computeInitials("Cher")).toBe("CH");
  });
  it("handles extra whitespace", () => {
    expect(computeInitials("  Maren   Ito  ")).toBe("MI");
  });
});

describe("computeStandout", () => {
  it("calls out the top overall match specially", () => {
    const result = computeStandout({ overall: 100, codeQuality: 100, consistency: 50, collaboration: 50, reqMatch: 50 });
    expect(result).toBe("Top overall match in this pool");
  });

  it("picks the dimension with the highest percentile when not the overall leader", () => {
    const result = computeStandout({ overall: 60, codeQuality: 40, consistency: 90, collaboration: 30, reqMatch: 20 });
    expect(result).toBe("Most consistent contributor in this pool");
  });

  it("breaks ties deterministically using a fixed dimension order", () => {
    const result = computeStandout({ overall: 60, codeQuality: 80, consistency: 80, collaboration: 80, reqMatch: 80 });
    expect(result).toBe("Deepest requirement match in this pool"); // reqMatch is first in the tie-break order
  });
});

describe("buildRankedList — populates UI summary fields", () => {
  it("includes computed initials, standout, and passed-through skill/language data", () => {
    const candidates = [
      makeCandidate({
        applicationId: "a",
        name: "Diego Fuentes",
        matchPct: 95,
        topSkills: ["Go", "Kubernetes"],
        languageBreakdown: [{ name: "Go", pct: 80 }, { name: "Shell", pct: 20 }],
      }),
    ];
    const result = buildRankedList(candidates);
    expect(result[0].initials).toBe("DF");
    expect(result[0].topSkills).toEqual(["Go", "Kubernetes"]);
    expect(result[0].languageBreakdown).toEqual([{ name: "Go", pct: 80 }, { name: "Shell", pct: 20 }]);
    expect(result[0].standout).toBe("Top overall match in this pool"); // only candidate -> 100th percentile
  });
});

describe("buildRankedList — basic ranking", () => {
  it("excludes candidates that don't meet requirements", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", matchPct: 90 }),
      makeCandidate({ applicationId: "b", matchPct: 95, meetsRequirements: false }),
    ];
    const result = buildRankedList(candidates);
    expect(result.map((r) => r.applicationId)).toEqual(["a"]);
  });

  it("sorts by matchPct descending", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", matchPct: 70 }),
      makeCandidate({ applicationId: "b", matchPct: 95 }),
      makeCandidate({ applicationId: "c", matchPct: 82 }),
    ];
    const result = buildRankedList(candidates);
    expect(result.map((r) => r.applicationId)).toEqual(["b", "c", "a"]);
  });

  it("respects topN slicing", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", matchPct: 70 }),
      makeCandidate({ applicationId: "b", matchPct: 95 }),
      makeCandidate({ applicationId: "c", matchPct: 82 }),
    ];
    const result = buildRankedList(candidates, { topN: 2 });
    expect(result.map((r) => r.applicationId)).toEqual(["b", "c"]);
  });

  it("returns everyone qualified when topN is 'all'", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", matchPct: 70 }),
      makeCandidate({ applicationId: "b", matchPct: 95 }),
    ];
    const result = buildRankedList(candidates, { topN: "all" });
    expect(result).toHaveLength(2);
  });
});

describe("buildRankedList — tech stack filter", () => {
  it("keeps only candidates matching ALL requested languages/tooling", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", languages: ["Python", "Go"], tooling: { Docker: true } }),
      makeCandidate({ applicationId: "b", languages: ["Python"], tooling: {} }),
    ];
    const result = buildRankedList(candidates, { techStack: ["Python", "Docker"] });
    expect(result.map((r) => r.applicationId)).toEqual(["a"]);
  });

  it("is case-insensitive", () => {
    const candidates = [makeCandidate({ applicationId: "a", languages: ["python"] })];
    const result = buildRankedList(candidates, { techStack: ["Python"] });
    expect(result).toHaveLength(1);
  });

  it("matches against tooling keys as well as languages", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", languages: [], tooling: { Kubernetes: true } }),
    ];
    const result = buildRankedList(candidates, { techStack: ["Kubernetes"] });
    expect(result).toHaveLength(1);
  });

  it("excludes a candidate where tooling is present but false", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", languages: [], tooling: { Kubernetes: false } }),
    ];
    const result = buildRankedList(candidates, { techStack: ["Kubernetes"] });
    expect(result).toHaveLength(0);
  });
});

describe("buildRankedList — threshold filters", () => {
  it("filters by minimum consistency", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", scores: { codeQuality: 80, consistency: 90, collaboration: 80, reqMatch: 80 } }),
      makeCandidate({ applicationId: "b", scores: { codeQuality: 80, consistency: 40, collaboration: 80, reqMatch: 80 } }),
    ];
    const result = buildRankedList(candidates, { minConsistency: 60 });
    expect(result.map((r) => r.applicationId)).toEqual(["a"]);
  });

  it("filters by minimum collaboration", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", scores: { codeQuality: 80, consistency: 80, collaboration: 90, reqMatch: 80 } }),
      makeCandidate({ applicationId: "b", scores: { codeQuality: 80, consistency: 80, collaboration: 20, reqMatch: 80 } }),
    ];
    const result = buildRankedList(candidates, { minCollaboration: 50 });
    expect(result.map((r) => r.applicationId)).toEqual(["a"]);
  });

  it("filters to shipped-project-only candidates", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", hasShippedProject: true }),
      makeCandidate({ applicationId: "b", hasShippedProject: false }),
    ];
    const result = buildRankedList(candidates, { shippedOnly: true });
    expect(result.map((r) => r.applicationId)).toEqual(["a"]);
  });

  it("combines multiple filters with AND semantics", () => {
    const candidates = [
      makeCandidate({
        applicationId: "a",
        languages: ["Python"],
        scores: { codeQuality: 80, consistency: 90, collaboration: 90, reqMatch: 80 },
        hasShippedProject: true,
      }),
      makeCandidate({
        applicationId: "b", // fails consistency threshold only
        languages: ["Python"],
        scores: { codeQuality: 80, consistency: 30, collaboration: 90, reqMatch: 80 },
        hasShippedProject: true,
      }),
    ];
    const result = buildRankedList(candidates, {
      techStack: ["Python"],
      minConsistency: 60,
      minCollaboration: 50,
      shippedOnly: true,
    });
    expect(result.map((r) => r.applicationId)).toEqual(["a"]);
  });
});

describe("buildRankedList — percentiles reflect the full qualified pool, not the filtered slice", () => {
  it("keeps percentiles computed against all qualified candidates even when filters narrow the display", () => {
    const candidates = [
      makeCandidate({
        applicationId: "a",
        languages: ["Python"],
        scores: { codeQuality: 90, consistency: 90, collaboration: 90, reqMatch: 90 },
      }),
      makeCandidate({
        applicationId: "b",
        languages: ["Go"], // will be filtered out by techStack below
        scores: { codeQuality: 10, consistency: 10, collaboration: 10, reqMatch: 10 },
      }),
    ];

    const unfiltered = buildRankedList(candidates);
    const filtered = buildRankedList(candidates, { techStack: ["Python"] });

    // "a" is the best of 2 candidates either way — its percentile
    // shouldn't change just because "b" got filtered out of the
    // *displayed* list; percentile reflects standing in the real pool.
    const aUnfiltered = unfiltered.find((r) => r.applicationId === "a")!;
    const aFiltered = filtered.find((r) => r.applicationId === "a")!;
    expect(aFiltered.percentiles.overall).toBe(aUnfiltered.percentiles.overall);
  });
});

describe("buildRankedList — tech-stack filter", () => {
  it("matches skills that only appear on the resume, not just GitHub languages/tooling", () => {
    // The filter panel offers resume skills as options, so choosing one must be able to match.
    const candidates = [
      makeCandidate({ applicationId: "react-dev", languages: ["JavaScript"], tooling: {}, topSkills: ["React"], skills: ["React", "GraphQL"] }),
      makeCandidate({ applicationId: "other", languages: ["Go"], tooling: {}, topSkills: ["Go"], skills: ["Go"] }),
    ];
    const result = buildRankedList(candidates, { techStack: ["React"] });
    expect(result.map((r) => r.applicationId)).toEqual(["react-dev"]);
  });

  it("matches a skill beyond the few shown on the row (full skills list, not topSkills)", () => {
    const candidates = [
      makeCandidate({ applicationId: "a", languages: [], tooling: {}, topSkills: ["A", "B", "C"], skills: ["A", "B", "C", "Terraform"] }),
    ];
    expect(buildRankedList(candidates, { techStack: ["Terraform"] })).toHaveLength(1);
  });

  it("falls back to topSkills when a full skills list isn't provided", () => {
    const candidates = [makeCandidate({ applicationId: "a", languages: [], tooling: {}, topSkills: ["Rust"] })];
    expect(buildRankedList(candidates, { techStack: ["Rust"] })).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const candidates = [makeCandidate({ applicationId: "a", languages: [], tooling: {}, skills: ["TypeScript"] })];
    expect(buildRankedList(candidates, { techStack: ["typescript"] })).toHaveLength(1);
    expect(buildRankedList(candidates, { techStack: ["TYPESCRIPT"] })).toHaveLength(1);
  });

  it("requires ALL selected technologies, mixing languages, tooling and resume skills", () => {
    const candidates = [
      makeCandidate({ applicationId: "all", languages: ["Python"], tooling: { Docker: true }, skills: ["Airflow"] }),
      makeCandidate({ applicationId: "no-docker", languages: ["Python"], tooling: { Docker: false }, skills: ["Airflow"] }),
      makeCandidate({ applicationId: "no-airflow", languages: ["Python"], tooling: { Docker: true }, skills: [] }),
    ];
    const result = buildRankedList(candidates, { techStack: ["Python", "Docker", "Airflow"] });
    expect(result.map((r) => r.applicationId)).toEqual(["all"]);
  });

  it("ignores tooling that is detected as false", () => {
    const candidates = [makeCandidate({ applicationId: "a", languages: [], skills: [], topSkills: [], tooling: { Kubernetes: false } })];
    expect(buildRankedList(candidates, { techStack: ["Kubernetes"] })).toHaveLength(0);
  });
});

describe("buildRankedList — every filter together, and ordering", () => {
  const pool = [
    makeCandidate({ applicationId: "top", name: "Top", matchPct: 95, scores: { codeQuality: 90, consistency: 90, collaboration: 90, reqMatch: 90 }, skills: ["React"], hasShippedProject: true }),
    makeCandidate({ applicationId: "mid", name: "Mid", matchPct: 80, scores: { codeQuality: 80, consistency: 70, collaboration: 60, reqMatch: 80 }, skills: ["React"], hasShippedProject: true }),
    makeCandidate({ applicationId: "low-consistency", name: "LC", matchPct: 85, scores: { codeQuality: 80, consistency: 20, collaboration: 80, reqMatch: 80 }, skills: ["React"], hasShippedProject: true }),
    makeCandidate({ applicationId: "not-shipped", name: "NS", matchPct: 88, scores: { codeQuality: 80, consistency: 80, collaboration: 80, reqMatch: 80 }, skills: ["React"], hasShippedProject: false }),
    makeCandidate({ applicationId: "no-react", name: "NR", matchPct: 99, scores: { codeQuality: 99, consistency: 99, collaboration: 99, reqMatch: 99 }, languages: ["Go"], skills: ["Go"], tooling: {}, hasShippedProject: true }),
  ];

  it("applies tech + min consistency + min collaboration + shipped-only together", () => {
    const result = buildRankedList(pool, {
      techStack: ["React"],
      minConsistency: 60,
      minCollaboration: 60,
      shippedOnly: true,
    });
    expect(result.map((r) => r.applicationId)).toEqual(["top", "mid"]);
  });

  it("each filter on its own removes exactly the candidates that fail it", () => {
    const ids = (f: Parameters<typeof buildRankedList>[1]) => buildRankedList(pool, f).map((r) => r.applicationId).sort();
    expect(ids({ techStack: ["Go"] })).toEqual(["no-react"]);
    expect(ids({ minConsistency: 75 })).toEqual(["no-react", "not-shipped", "top"]);
    expect(ids({ minCollaboration: 70 })).toEqual(["low-consistency", "no-react", "not-shipped", "top"]);
    expect(ids({ shippedOnly: true })).toEqual(["low-consistency", "mid", "no-react", "top"]);
  });

  it("a filter at exactly the boundary value keeps the candidate (>=, not >)", () => {
    expect(buildRankedList(pool, { minConsistency: 70 }).map((r) => r.applicationId)).toContain("mid");
  });

  it("returns matching candidates best-match-first", () => {
    const result = buildRankedList(pool, { techStack: ["React"] });
    expect(result.map((r) => r.matchPct)).toEqual([95, 88, 85, 80]);
  });

  it("breaks match-% ties by name so the order is stable between requests", () => {
    const tied = [
      makeCandidate({ applicationId: "z", name: "Zed", matchPct: 80 }),
      makeCandidate({ applicationId: "a", name: "Amy", matchPct: 80 }),
      makeCandidate({ applicationId: "m", name: "Max", matchPct: 80 }),
    ];
    expect(buildRankedList(tied).map((r) => r.name)).toEqual(["Amy", "Max", "Zed"]);
    expect(buildRankedList([...tied].reverse()).map((r) => r.name)).toEqual(["Amy", "Max", "Zed"]);
  });

  it("topN 'all' returns every match; a number caps it", () => {
    expect(buildRankedList(pool, { topN: "all" })).toHaveLength(5);
    expect(buildRankedList(pool, { topN: 2 })).toHaveLength(2);
  });

  it("returns an empty list (not an error) when nothing matches", () => {
    expect(buildRankedList(pool, { techStack: ["Cobol"] })).toEqual([]);
  });
});

describe("collectTechOptions", () => {
  it("draws options from languages, enabled tooling and resume skills across the whole pool", () => {
    const pool = [
      makeCandidate({ applicationId: "a", languages: ["Python"], tooling: { Docker: true, Kubernetes: false }, skills: ["React"] }),
    ];
    const options = collectTechOptions(pool);
    expect(options).toContain("Python");
    expect(options).toContain("Docker");
    expect(options).toContain("React");
    expect(options).not.toContain("Kubernetes"); // detected as false
  });

  it("lists the most common first, ties alphabetical, de-duplicating case-insensitively", () => {
    const pool = [
      makeCandidate({ applicationId: "a", languages: ["Python"], tooling: {}, skills: ["react", "Zig"] }),
      makeCandidate({ applicationId: "b", languages: ["Python"], tooling: {}, skills: ["React"] }),
      makeCandidate({ applicationId: "c", languages: ["Go"], tooling: {}, skills: ["Alpha"] }),
    ];
    const options = collectTechOptions(pool);
    expect(options.slice(0, 2)).toEqual(["Python", "react"]); // Python x2, react/React x2 (first-seen casing) — tie -> alphabetical
    expect(options.filter((o) => o.toLowerCase() === "react")).toHaveLength(1);
    expect(options.indexOf("Alpha")).toBeLessThan(options.indexOf("Zig")); // both x1 -> alphabetical
  });

  it("ignores candidates who don't meet the requirements", () => {
    const pool = [
      makeCandidate({ applicationId: "q", languages: ["Python"], tooling: {}, skills: [] }),
      makeCandidate({ applicationId: "u", languages: ["Haskell"], tooling: {}, skills: [], meetsRequirements: false }),
    ];
    expect(collectTechOptions(pool)).not.toContain("Haskell");
  });

  it("respects the cap", () => {
    const skills = Array.from({ length: 30 }, (_, i) => `Skill${String(i).padStart(2, "0")}`);
    expect(collectTechOptions([makeCandidate({ languages: [], tooling: {}, skills })], 5)).toHaveLength(5);
  });

  it("is independent of the filters: options come from the pool, applied filters don't shrink them", () => {
    const pool = [
      makeCandidate({ applicationId: "a", languages: ["Python"], tooling: {}, skills: ["Django"] }),
      makeCandidate({ applicationId: "b", languages: ["Go"], tooling: {}, skills: ["Gin"] }),
    ];
    const afterFilter = buildRankedList(pool, { techStack: ["Python"] });
    expect(afterFilter).toHaveLength(1); // the LIST shrank...
    expect(collectTechOptions(pool)).toContain("Gin"); // ...the options (built from the full pool) did not
  });
});

describe("buildRankedListWithMatches — matches first, everyone else below", () => {
  const pool = [
    makeCandidate({ applicationId: "a", name: "Ann", matchPct: 90, skills: ["React"], hasShippedProject: true }),
    makeCandidate({ applicationId: "b", name: "Bob", matchPct: 95, skills: ["Vue"], hasShippedProject: true }),
    makeCandidate({ applicationId: "c", name: "Cy", matchPct: 70, skills: ["React"], hasShippedProject: false }),
    makeCandidate({ applicationId: "d", name: "Di", matchPct: 60, skills: ["React"], hasShippedProject: true }),
    makeCandidate({ applicationId: "x", name: "Xan", matchPct: 99, skills: ["React"], hasShippedProject: true, meetsRequirements: false }),
  ];

  it("with no filters every qualified candidate matches, best first; unqualified stay out", () => {
    const { entries, matchedCount } = buildRankedListWithMatches(pool);
    expect(entries.map((e) => e.applicationId)).toEqual(["b", "a", "c", "d"]);
    expect(entries.every((e) => e.matchesFilters)).toBe(true);
    expect(matchedCount).toBe(4);
  });

  it("lists the matches first (best first), then the rest (best first), flagging each", () => {
    const { entries, matchedCount } = buildRankedListWithMatches(pool, { techStack: ["React"], shippedOnly: true });
    // matches: a(90), d(60)   rest: b(95, no React), c(70, not shipped)
    expect(entries.map((e) => [e.applicationId, e.matchesFilters])).toEqual([["a", true], ["d", true], ["b", false], ["c", false]]);
    expect(matchedCount).toBe(2);
  });

  it("a lower-scoring match still beats a higher-scoring non-match", () => {
    const { entries } = buildRankedListWithMatches(pool, { techStack: ["React"] });
    expect(entries.map((e) => e.applicationId)).toEqual(["a", "c", "d", "b"]);
  });

  it("when nothing matches, everyone is returned below (all flagged false) and matchedCount is 0", () => {
    const { entries, matchedCount } = buildRankedListWithMatches(pool, { techStack: ["Cobol"] });
    expect(entries.map((e) => e.applicationId)).toEqual(["b", "a", "c", "d"]);
    expect(entries.some((e) => e.matchesFilters)).toBe(false);
    expect(matchedCount).toBe(0);
  });

  it("topN cuts the combined list, so the matches are what survive a small cut-off", () => {
    expect(buildRankedListWithMatches(pool, { techStack: ["React"], shippedOnly: true, topN: 1 }).entries.map((e) => e.applicationId)).toEqual(["a"]);
    expect(buildRankedListWithMatches(pool, { techStack: ["React"], shippedOnly: true, topN: 3 }).entries.map((e) => [e.applicationId, e.matchesFilters])).toEqual([["a", true], ["d", true], ["b", false]]);
    expect(buildRankedListWithMatches(pool, { topN: "all" }).entries).toHaveLength(4);
  });

  it("percentiles and standout describe the whole pool, so applying a filter never changes them", () => {
    const plain = buildRankedListWithMatches(pool).entries.find((e) => e.applicationId === "c")!;
    const filtered = buildRankedListWithMatches(pool, { techStack: ["Vue"] }).entries.find((e) => e.applicationId === "c")!;
    expect(filtered.percentiles).toEqual(plain.percentiles);
    expect(filtered.standout).toBe(plain.standout);
  });

  it("buildRankedList (used elsewhere) still returns ONLY the matches", () => {
    expect(buildRankedList(pool, { techStack: ["React"], shippedOnly: true }).map((e) => e.applicationId)).toEqual(["a", "d"]);
  });
});
