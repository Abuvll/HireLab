import { describe, it, expect } from "vitest";
import { analyzeGithubProfile, estimateComplexity } from "../github/analyze";
import type { GithubProfileRaw, GithubRepoRaw } from "../github/types";

function makeRepo(overrides: Partial<GithubRepoRaw> = {}): GithubRepoRaw {
  return {
    name: "repo",
    url: "https://github.com/mareni/repo",
    description: "A sample repository",
    isFork: false,
    stargazerCount: 0,
    diskUsage: 500,
    pushedAt: "2026-06-01T00:00:00Z",
    primaryLanguage: { name: "Python" },
    languages: { edges: [{ size: 8000, node: { name: "Python" } }] },
    owner: { login: "mareni" },
    repositoryTopics: { nodes: [] },
    defaultBranchRef: { target: { history: { totalCount: 50 } } },
    ...overrides,
  };
}

function makeWeeks(activeCount: number, total = 52) {
  return Array.from({ length: total }, (_, i) => ({
    contributionDays: [{ contributionCount: i < activeCount ? 3 : 0 }],
  }));
}

function makeProfile(overrides: Partial<GithubProfileRaw> = {}): GithubProfileRaw {
  return {
    login: "mareni",
    createdAt: "2020-01-01T00:00:00Z",
    followers: { totalCount: 8 },
    repositories: { nodes: [makeRepo()] },
    contributionsCollection: {
      totalCommitContributions: 300,
      contributionCalendar: { weeks: makeWeeks(20) },
      pullRequestContributionsByRepository: [],
    },
    ...overrides,
  };
}

describe("estimateComplexity", () => {
  it("caps forks at low complexity regardless of size", () => {
    const fork = makeRepo({ isFork: true, diskUsage: 500000, stargazerCount: 2 });
    expect(estimateComplexity(fork)).toBeLessThanOrEqual(2);
  });

  it("scores a large, popular original repo highly", () => {
    const bigRepo = makeRepo({ diskUsage: 500000, stargazerCount: 500 });
    expect(estimateComplexity(bigRepo)).toBeGreaterThanOrEqual(4);
  });

  it("scores a tiny original repo low", () => {
    const tinyRepo = makeRepo({ diskUsage: 5, stargazerCount: 0 });
    expect(estimateComplexity(tinyRepo)).toBeLessThanOrEqual(2);
  });

  it("stays within the 1-5 bounds", () => {
    const extreme = makeRepo({ diskUsage: 999999999, stargazerCount: 999999 });
    expect(estimateComplexity(extreme)).toBeLessThanOrEqual(5);
  });
});

describe("analyzeGithubProfile", () => {
  it("computes language percentages from language byte sizes across repos", () => {
    const profile = makeProfile({
      repositories: {
        nodes: [
          makeRepo({ name: "a", languages: { edges: [{ size: 6000, node: { name: "Python" } }] } }),
          makeRepo({ name: "b", languages: { edges: [{ size: 4000, node: { name: "Go" } }] } }),
        ],
      },
    });
    const result = analyzeGithubProfile(profile);
    const python = result.languages.find((l) => l.name === "Python");
    const go = result.languages.find((l) => l.name === "Go");
    expect(python?.pct).toBe(60);
    expect(go?.pct).toBe(40);
  });

  it("counts active weeks from the contribution calendar", () => {
    const profile = makeProfile({
      contributionsCollection: {
        totalCommitContributions: 100,
        contributionCalendar: { weeks: makeWeeks(30) },
        pullRequestContributionsByRepository: [],
      },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.activeWeeks).toBe(30);
  });

  it("excludes the candidate's own repos from external contributions", () => {
    const profile = makeProfile({
      contributionsCollection: {
        totalCommitContributions: 100,
        contributionCalendar: { weeks: makeWeeks(10) },
        pullRequestContributionsByRepository: [
          {
            repository: { nameWithOwner: "mareni/own-repo", owner: { login: "mareni" }, stargazerCount: 5 },
            contributions: { totalCount: 10 },
          },
          {
            repository: { nameWithOwner: "kubernetes/client-go", owner: { login: "kubernetes" }, stargazerCount: 12000 },
            contributions: { totalCount: 3 },
          },
        ],
      },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.externalContributions).toBe(3);
  });

  it("flags merges into notable (high-star) external repos", () => {
    const profile = makeProfile({
      contributionsCollection: {
        totalCommitContributions: 100,
        contributionCalendar: { weeks: makeWeeks(10) },
        pullRequestContributionsByRepository: [
          {
            repository: { nameWithOwner: "kubernetes/client-go", owner: { login: "kubernetes" }, stargazerCount: 12000 },
            contributions: { totalCount: 2 },
          },
          {
            repository: { nameWithOwner: "someuser/small-repo", owner: { login: "someuser" }, stargazerCount: 5 },
            contributions: { totalCount: 1 },
          },
        ],
      },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.notableMerges).toHaveLength(1);
    expect(result.notableMerges[0].repo).toBe("kubernetes/client-go");
    expect(result.notableMerges[0].stars).toBe("12.0k");
  });

  it("marks forked repos as not-original in the repo table", () => {
    const profile = makeProfile({
      repositories: { nodes: [makeRepo({ name: "forked", isFork: true })] },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.repos[0].original).toBe(false);
  });

  it("only includes repos with stars or meaningful size as shipped projects", () => {
    const profile = makeProfile({
      repositories: {
        nodes: [
          makeRepo({ name: "shipped", stargazerCount: 10, diskUsage: 1000 }),
          makeRepo({ name: "toy", stargazerCount: 0, diskUsage: 10 }),
        ],
      },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.shippedProjects.map((p) => p.name)).toEqual(["shipped"]);
  });

  it("returns an empty language list without dividing by zero when there are no repos", () => {
    const profile = makeProfile({ repositories: { nodes: [] } });
    const result = analyzeGithubProfile(profile);
    expect(result.languages).toEqual([]);
    expect(result.testRatio).toBeNull();
  });

  it("passes through username and follower count", () => {
    const profile = makeProfile({ login: "octocat", followers: { totalCount: 42 } });
    const result = analyzeGithubProfile(profile);
    expect(result.username).toBe("octocat");
    expect(result.followers).toBe(42);
  });

  it("sums stars across every repo for totalStars", () => {
    const profile = makeProfile({
      repositories: {
        nodes: [
          makeRepo({ name: "a", stargazerCount: 10 }),
          makeRepo({ name: "b", stargazerCount: 25 }),
        ],
      },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.totalStars).toBe(35);
  });

  it("computes account age in years from createdAt", () => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const profile = makeProfile({ createdAt: oneYearAgo.toISOString() });
    const result = analyzeGithubProfile(profile);
    expect(result.accountAgeYears).toBeGreaterThanOrEqual(0.9);
    expect(result.accountAgeYears).toBeLessThanOrEqual(1.1);
  });

  it("reads per-repo commit count from defaultBranchRef", () => {
    const profile = makeProfile({
      repositories: {
        nodes: [makeRepo({ defaultBranchRef: { target: { history: { totalCount: 275 } } } })],
      },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.repos[0].commits).toBe(275);
  });

  it("defaults commits to 0 for a repo with no default branch (e.g. an empty repo)", () => {
    const profile = makeProfile({
      repositories: { nodes: [makeRepo({ defaultBranchRef: null })] },
    });
    const result = analyzeGithubProfile(profile);
    expect(result.repos[0].commits).toBe(0);
  });
});
