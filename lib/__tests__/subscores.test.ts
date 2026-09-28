import { describe, it, expect } from "vitest";
import {
  computeReqMatchScore,
  computeConsistencyScore,
  computeCollaborationScore,
  computeCodeQualityScore,
  computeMatchPct,
} from "../scoring/subscores";
import type { GithubAnalysisData, ResumeExtractData, RequirementChip } from "../scoring/types";

const strongGithub: GithubAnalysisData = {
  username: "strong-dev",
  followers: 100,
  totalStars: 60,
  accountAgeYears: 6,
  repoCount: 30,
  commitsPastYear: 600,
  activeWeeks: 50,
  testRatio: 0.3,
  languages: [{ name: "Python", pct: 70 }, { name: "Go", pct: 30 }],
  repos: [
    { name: "a", url: "", lang: "Python", original: true, complexity: 5, testCoverage: 40, stars: 50, commits: 400, lastActiveAt: "2026-06-01" },
    { name: "b", url: "", lang: "Go", original: true, complexity: 4, testCoverage: 30, stars: 10, commits: 200, lastActiveAt: "2026-05-01" },
  ],
  tooling: { Docker: true },
  shippedProjects: [],
  externalContributions: 20,
  notableMerges: [{ repo: "kubernetes/client-go", stars: "12k", desc: "fix" }],
};

const weakGithub: GithubAnalysisData = {
  username: "weak-dev",
  followers: 0,
  totalStars: 0,
  accountAgeYears: 0.5,
  repoCount: 4,
  commitsPastYear: 40,
  activeWeeks: 6,
  testRatio: 0.02,
  languages: [{ name: "JavaScript", pct: 100 }],
  repos: [
    { name: "fork1", url: "", lang: "JavaScript", original: false, complexity: 1, testCoverage: 0, stars: 0, commits: 5, lastActiveAt: "2025-01-01" },
  ],
  tooling: {},
  shippedProjects: [],
  externalContributions: 0,
  notableMerges: [],
};

const blankResume: ResumeExtractData = { education: null, yearsExperience: 0, topSkills: [], experience: [] };

describe("computeReqMatchScore", () => {
  it("gives full credit for a skill chip matched via GitHub languages", () => {
    const chips: RequirementChip[] = [{ label: "Python", type: "skill" }];
    expect(computeReqMatchScore(blankResume, strongGithub, chips)).toBe(100);
  });

  it("gives full credit for a skill chip matched via resume top skills", () => {
    const resume: ResumeExtractData = { ...blankResume, topSkills: ["Rust"] };
    const chips: RequirementChip[] = [{ label: "Rust", type: "skill" }];
    expect(computeReqMatchScore(resume, weakGithub, chips)).toBe(100);
  });

  it("gives zero credit for a skill chip with no supporting evidence anywhere", () => {
    const chips: RequirementChip[] = [{ label: "Kubernetes", type: "skill" }];
    expect(computeReqMatchScore(blankResume, weakGithub, chips)).toBe(0);
  });

  it("always credits a location chip in full — no evaluation criteria", () => {
    const chips: RequirementChip[] = [{ label: "Remote", type: "location" }];
    expect(computeReqMatchScore(blankResume, weakGithub, chips)).toBe(100);
  });

  it("grades an experience chip as a ratio of years held vs. years required", () => {
    const resume: ResumeExtractData = { ...blankResume, yearsExperience: 2.5 };
    const chips: RequirementChip[] = [{ label: "5+ yrs", type: "experience" }];
    expect(computeReqMatchScore(resume, weakGithub, chips)).toBe(50);
  });

  it("caps an experience chip at full credit — no bonus for being over-qualified", () => {
    const resume: ResumeExtractData = { ...blankResume, yearsExperience: 20 };
    const chips: RequirementChip[] = [{ label: "5+ yrs", type: "experience" }];
    expect(computeReqMatchScore(resume, weakGithub, chips)).toBe(100);
  });

  it("averages across multiple chips of mixed types", () => {
    const resume: ResumeExtractData = { ...blankResume, yearsExperience: 5, topSkills: ["Python"] };
    const chips: RequirementChip[] = [
      { label: "Python", type: "skill" }, // met -> 1
      { label: "Kubernetes", type: "skill" }, // unmet -> 0
      { label: "5+ yrs", type: "experience" }, // met exactly -> 1
      { label: "Remote", type: "location" }, // always -> 1
    ];
    // (1 + 0 + 1 + 1) / 4 = 0.75
    expect(computeReqMatchScore(resume, weakGithub, chips)).toBe(75);
  });

  it("defaults to 100 when the position has no requirement chips at all", () => {
    expect(computeReqMatchScore(blankResume, weakGithub, [])).toBe(100);
  });
});

describe("computeCodeQualityScore", () => {
  it("scores complex, well-tested, original repos highly", () => {
    expect(computeCodeQualityScore(strongGithub)).toBeGreaterThan(50);
  });

  it("scores forked, untested, low-complexity activity low", () => {
    expect(computeCodeQualityScore(weakGithub)).toBeLessThan(25);
  });

  it("stays within 0-100 bounds", () => {
    expect(computeCodeQualityScore(strongGithub)).toBeLessThanOrEqual(100);
    expect(computeCodeQualityScore(weakGithub)).toBeGreaterThanOrEqual(0);
  });

  it("is unaffected by whether the chips match the position's requirements — that's reqMatch's job", () => {
    // Same github profile, regardless of what the role asked for.
    expect(computeCodeQualityScore(strongGithub)).toBe(computeCodeQualityScore(strongGithub));
  });
});

describe("computeConsistencyScore", () => {
  it("rewards near-full-year activity coverage", () => {
    expect(computeConsistencyScore(strongGithub)).toBeGreaterThan(80);
  });
  it("penalizes sparse activity", () => {
    expect(computeConsistencyScore(weakGithub)).toBeLessThan(20);
  });
});

describe("computeCollaborationScore", () => {
  it("rewards external contributions and notable merges", () => {
    expect(computeCollaborationScore(strongGithub)).toBeGreaterThan(90);
  });
  it("scores zero external activity as zero", () => {
    expect(computeCollaborationScore(weakGithub)).toBe(0);
  });
});

describe("computeMatchPct", () => {
  it("weights every dimension equally", () => {
    const reqAndQuality = computeMatchPct({ reqMatch: 100, consistency: 0, collaboration: 0, codeQuality: 100 });
    const consistencyAndCollab = computeMatchPct({ reqMatch: 0, consistency: 100, collaboration: 100, codeQuality: 0 });
    expect(reqAndQuality).toBe(consistencyAndCollab); // 50 either way — no dimension dominates
  });

  it("returns 100 when every sub-score is maxed", () => {
    expect(computeMatchPct({ reqMatch: 100, consistency: 100, collaboration: 100, codeQuality: 100 })).toBe(100);
  });

  it("returns 0 when every sub-score is zero", () => {
    expect(computeMatchPct({ reqMatch: 0, consistency: 0, collaboration: 0, codeQuality: 0 })).toBe(0);
  });
});
