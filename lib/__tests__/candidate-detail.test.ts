import { describe, it, expect } from "vitest";
import { buildCandidateDetail, deriveFlags } from "../api/candidate-detail";
import type { RankableApplication } from "../scoring/rank";

const resume = {
  education: { school: "State University", field: "Computer Science", gpa: null, gradYear: 2019 },
  yearsExperience: 6,
  topSkills: ["Python"],
  experience: [],
};
const github = {
  username: "mito",
  followers: 42,
  totalStars: 120,
  accountAgeYears: 5.5,
  repoCount: 10,
  commitsPastYear: 300,
  activeWeeks: 30,
  testRatio: 0.2,
  languages: [],
  repos: [],
  tooling: { Docker: true },
  shippedProjects: [],
  externalContributions: 5,
  notableMerges: [],
};
const score = {
  meetsRequirements: true,
  matchPct: 90,
  reqMatch: 90,
  consistency: 85,
  collaboration: 80,
  codeQuality: 88,
  evidenceMatrix: [],
};

function makePoolEntry(id: string, matchPct: number): RankableApplication {
  return {
    applicationId: id,
    meetsRequirements: true,
    matchPct,
    scores: { reqMatch: matchPct, consistency: matchPct, collaboration: matchPct, codeQuality: matchPct },
  };
}

function makeApplication(overrides: Partial<Parameters<typeof buildCandidateDetail>[0]> = {}) {
  return {
    id: "app1",
    fullName: "Maren Ito",
    contactMethod: "EMAIL",
    email: "m@x.com",
    phone: null,
    createdAt: new Date("2026-01-01"),
    status: "READY" as const,
    resumeUrl: "https://example.com/resume.pdf",
    portfolioUrl: "https://example.com",
    ...overrides,
  };
}

describe("buildCandidateDetail", () => {
  it("assembles all the pieces into one view model", () => {
    const application = makeApplication();
    const pool = [makePoolEntry("app1", 90), makePoolEntry("app2", 50)];

    const result = buildCandidateDetail(application, resume, github, score, pool);

    expect(result.application.fullName).toBe("Maren Ito");
    expect(result.application.email).toBe("m@x.com");
    expect(result.application.phone).toBeNull();
    expect(result.application.status).toBe("QUALIFIED");
    expect(result.application.score.overall).toBe(90);
    expect(result.application.score.reqMatch).toBe(90);
    expect(result.application.score.codeQuality).toBe(88);
    expect(result.resumeExtract).toEqual({ education: resume.education, experience: resume.experience });
    expect(result.resumeUrl).toBe("https://example.com/resume.pdf");
    expect(result.portfolioUrl).toBe("https://example.com");
    expect(result.githubAnalysis.username).toBe("mito");
    expect(result.githubAnalysis.totalCommitsLastYear).toBe(300); // renamed from commitsPastYear
    expect(result.githubAnalysis.toolingDetected).toEqual([{ name: "Docker", detected: true }]);
    expect(result.application.score.flags).toEqual([
      { severity: "good", message: "Meets every stated requirement for this position" },
    ]);
  });

  it("derives REVIEWED status when the gate didn't pass, QUALIFIED when it did", () => {
    const application = makeApplication();
    const pool = [makePoolEntry("app1", 90)];

    const qualified = buildCandidateDetail(application, resume, github, { ...score, meetsRequirements: true }, pool);
    expect(qualified.application.status).toBe("QUALIFIED");

    const reviewed = buildCandidateDetail(application, resume, github, { ...score, meetsRequirements: false }, pool);
    expect(reviewed.application.status).toBe("REVIEWED");
  });

  it("computes percentiles and rank against the given pool", () => {
    const application = makeApplication();
    const pool = [makePoolEntry("app1", 90), makePoolEntry("app2", 50), makePoolEntry("app3", 70)];

    const result = buildCandidateDetail(application, resume, github, score, pool);
    expect(result.percentile).toBe(100); // best of 3
    expect(result.application.score.percentiles.overall).toBe(100);
    expect(result.rank).toBe(1);
    expect(result.totalInPosition).toBe(3);
  });

  it("falls back to 0th percentile and null rank when the candidate isn't in the pool", () => {
    const application = makeApplication({ id: "not-in-pool", fullName: "Someone", email: "someone@x.com" });
    const pool = [makePoolEntry("app1", 90), makePoolEntry("app2", 50)];

    const result = buildCandidateDetail(application, resume, github, score, pool);
    expect(result.percentile).toBe(0);
    expect(result.application.score.percentiles).toEqual({
      overall: 0,
      reqMatch: 0,
      consistency: 0,
      collaboration: 0,
      codeQuality: 0,
    });
    expect(result.rank).toBeNull();
    expect(result.totalInPosition).toBe(2); // pool size, independent of whether this candidate is in it
  });
});

describe("deriveFlags", () => {
  it("returns a single positive flag when every requirement is met", () => {
    const cleanScore = { ...score, evidenceMatrix: [{ requirement: "Python", met: true, evidence: "60% of code" }] };
    expect(deriveFlags(cleanScore)).toEqual([
      { severity: "good", message: "Meets every stated requirement for this position" },
    ]);
  });

  it("returns one warning flag per unmet requirement", () => {
    const mixedScore = {
      ...score,
      evidenceMatrix: [
        { requirement: "Python", met: true, evidence: "60% of code" },
        { requirement: "5+ yrs", met: false, evidence: "Resume indicates 3 years — below the 5+ year requirement" },
        { requirement: "Kubernetes", met: false, evidence: "No supporting evidence found" },
      ],
    };
    const flags = deriveFlags(mixedScore);
    expect(flags).toHaveLength(2);
    expect(flags.every((f) => f.severity === "warn")).toBe(true);
    expect(flags[0].message).toContain("5+ yrs");
    expect(flags[1].message).toContain("Kubernetes");
  });

  it("returns an empty-evidence-matrix case as a clean sweep (vacuously true)", () => {
    expect(deriveFlags({ ...score, evidenceMatrix: [] })).toEqual([
      { severity: "good", message: "Meets every stated requirement for this position" },
    ]);
  });
});
