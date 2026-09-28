import { describe, it, expect } from "vitest";
import { buildEvidenceMatrix } from "../scoring/evidence";
import type { ResumeExtractData, GithubAnalysisData, RequirementChip } from "../scoring/types";

const resume: ResumeExtractData = {
  education: { school: "State University", field: "Computer Science", gpa: null, gradYear: 2020 },
  yearsExperience: 4,
  topSkills: ["TypeScript", "PostgreSQL", "GraphQL"],
  experience: [],
};

const github: GithubAnalysisData = {
  username: "test-dev",
  followers: 15,
  totalStars: 12,
  accountAgeYears: 5,
  repoCount: 27,
  commitsPastYear: 510,
  activeWeeks: 29,
  testRatio: 0.18,
  languages: [
    { name: "TypeScript", pct: 64 },
    { name: "Python", pct: 22 },
    { name: "SQL", pct: 14 },
  ],
  repos: [
    { name: "gql-gateway", url: "github.com/x/gql-gateway", lang: "TypeScript", original: true, complexity: 4, testCoverage: 20, stars: 12, commits: 150, lastActiveAt: "2026-06-01" },
  ],
  tooling: { Docker: true, Kubernetes: false, GraphQL: true, PostgreSQL: true, "CI/CD": true },
  shippedProjects: [{ name: "gql-gateway", url: "github.com/x/gql-gateway", description: "A federated GraphQL gateway" }],
  externalContributions: 3,
  notableMerges: [],
};

describe("buildEvidenceMatrix", () => {
  it("marks a years requirement as met with the correct evidence text", () => {
    const chips: RequirementChip[] = [{ label: "4+ yrs", type: "experience" }];
    const rows = buildEvidenceMatrix(chips, resume, github);
    expect(rows[0].met).toBe(true);
    expect(rows[0].evidence).toContain("4 years");
  });

  it("marks a years requirement as unmet when below the bar", () => {
    const chips: RequirementChip[] = [{ label: "6+ yrs", type: "experience" }];
    const rows = buildEvidenceMatrix(chips, resume, github);
    expect(rows[0].met).toBe(false);
    expect(rows[0].evidence).toContain("below");
  });

  it("finds GitHub language evidence over resume-only claims", () => {
    const chips: RequirementChip[] = [{ label: "TypeScript", type: "skill" }];
    const rows = buildEvidenceMatrix(chips, resume, github);
    expect(rows[0].met).toBe(true);
    expect(rows[0].evidence).toContain("64%");
    expect(rows[0].evidence).toContain("gql-gateway");
  });

  it("finds tooling evidence when the skill isn't a language", () => {
    const chips: RequirementChip[] = [{ label: "GraphQL", type: "skill" }];
    const rows = buildEvidenceMatrix(chips, resume, github);
    expect(rows[0].met).toBe(true);
    expect(rows[0].evidence).toContain("config");
  });

  it("falls back to resume-only evidence when nothing on GitHub matches", () => {
    const resumeOnlySkill: ResumeExtractData = { ...resume, topSkills: [...resume.topSkills, "AWS"] };
    const chips: RequirementChip[] = [{ label: "AWS", type: "skill" }];
    const rows = buildEvidenceMatrix(chips, resumeOnlySkill, github);
    expect(rows[0].met).toBe(true);
    expect(rows[0].evidence).toContain("not independently verified");
  });

  it("marks no evidence found when nothing supports the requirement", () => {
    const chips: RequirementChip[] = [{ label: "Rust", type: "skill" }];
    const rows = buildEvidenceMatrix(chips, resume, github);
    expect(rows[0].met).toBe(false);
    expect(rows[0].evidence).toContain("No supporting evidence");
  });

  it("always passes location requirements", () => {
    const chips: RequirementChip[] = [{ label: "Remote OK", type: "location" }];
    const rows = buildEvidenceMatrix(chips, resume, github);
    expect(rows[0].met).toBe(true);
  });
});
