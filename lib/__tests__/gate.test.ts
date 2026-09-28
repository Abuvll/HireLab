import { describe, it, expect } from "vitest";
import { checkGate, parseYearsRequirement } from "../scoring/gate";
import type { ResumeExtractData, GithubAnalysisData, RequirementChip } from "../scoring/types";

const baseResume: ResumeExtractData = {
  education: { school: "State University", field: "Computer Science", gpa: null, gradYear: 2018 },
  yearsExperience: 6,
  topSkills: ["Python", "Kubernetes"],
  experience: [],
};

const baseGithub: GithubAnalysisData = {
  username: "test-dev",
  followers: 10,
  totalStars: 30,
  accountAgeYears: 4,
  repoCount: 20,
  commitsPastYear: 500,
  activeWeeks: 40,
  testRatio: 0.2,
  languages: [
    { name: "Python", pct: 60 },
    { name: "Go", pct: 40 },
  ],
  repos: [],
  tooling: { Docker: true, Kubernetes: true, GraphQL: false },
  shippedProjects: [],
  externalContributions: 10,
  notableMerges: [],
};

describe("parseYearsRequirement", () => {
  it("parses '5+ yrs'", () => {
    expect(parseYearsRequirement("5+ yrs")).toBe(5);
  });
  it("parses '3 years'", () => {
    expect(parseYearsRequirement("3 years")).toBe(3);
  });
  it("returns null for non-years labels", () => {
    expect(parseYearsRequirement("Python")).toBeNull();
  });
});

describe("checkGate", () => {
  it("passes when all requirements are met via GitHub language + tooling", () => {
    const chips: RequirementChip[] = [
      { label: "Python", type: "skill" },
      { label: "Kubernetes", type: "skill" },
      { label: "5+ yrs", type: "experience" },
      { label: "Remote OK", type: "location" },
    ];
    const result = checkGate(chips, baseResume, baseGithub);
    expect(result.pass).toBe(true);
    expect(result.failedRequirements).toEqual([]);
  });

  it("fails when a skill has no GitHub or resume evidence", () => {
    const chips: RequirementChip[] = [{ label: "Rust", type: "skill" }];
    const result = checkGate(chips, baseResume, baseGithub);
    expect(result.pass).toBe(false);
    expect(result.failedRequirements).toEqual(["Rust"]);
  });

  it("falls back to resume topSkills when GitHub has no evidence", () => {
    const chips: RequirementChip[] = [{ label: "Kubernetes", type: "skill" }];
    const githubWithoutK8s: GithubAnalysisData = {
      ...baseGithub,
      tooling: { Docker: true, Kubernetes: false },
    };
    // Kubernetes is still in baseResume.topSkills, so this should pass
    const result = checkGate(chips, baseResume, githubWithoutK8s);
    expect(result.pass).toBe(true);
  });

  it("fails when years of experience is below the requirement", () => {
    const chips: RequirementChip[] = [{ label: "10+ yrs", type: "experience" }];
    const result = checkGate(chips, baseResume, baseGithub);
    expect(result.pass).toBe(false);
    expect(result.failedRequirements).toEqual(["10+ yrs"]);
  });

  it("always passes location requirements", () => {
    const chips: RequirementChip[] = [{ label: "On-site only", type: "location" }];
    const result = checkGate(chips, baseResume, baseGithub);
    expect(result.pass).toBe(true);
  });
});
