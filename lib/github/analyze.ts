import type { GithubProfileRaw, GithubRepoRaw } from "./types";
import type { GithubAnalysisData, LanguageUsage, RepoInfo } from "../scoring/types";

const NOTABLE_REPO_STAR_THRESHOLD = 1000;
const MAX_REPOS_IN_TABLE = 10;
const MAX_LANGUAGES_TRACKED = 6;

export function estimateComplexity(repo: GithubRepoRaw): number {
  if (repo.isFork) return repo.stargazerCount > 5 ? 2 : 1;

  const sizeScore = Math.min(2.5, Math.log10(Math.max(repo.diskUsage ?? 1, 1)) / 1.6);
  const starScore = Math.min(1.5, Math.log10(repo.stargazerCount + 1));
  const complexity = 1 + sizeScore + starScore;

  return Math.max(1, Math.min(5, Math.round(complexity)));
}

const TEST_TOPIC_HINTS = ["testing", "tdd", "jest", "pytest", "test-driven-development"];

function hasTestSignal(repo: GithubRepoRaw): boolean {
  return repo.repositoryTopics.nodes.some((t) => TEST_TOPIC_HINTS.includes(t.topic.name.toLowerCase()));
}

function computeActiveWeeks(raw: GithubProfileRaw): number {
  const weeks = raw.contributionsCollection.contributionCalendar.weeks;
  return weeks.filter((w) => w.contributionDays.some((d) => d.contributionCount > 0)).length;
}

function computeLanguages(repos: GithubRepoRaw[]): LanguageUsage[] {
  const totals = new Map<string, number>();

  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      totals.set(edge.node.name, (totals.get(edge.node.name) ?? 0) + edge.size);
    }
  }

  const totalSize = [...totals.values()].reduce((sum, v) => sum + v, 0);
  if (totalSize === 0) return [];

  return [...totals.entries()]
    .map(([name, size]) => ({ name, pct: Math.round((size / totalSize) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_LANGUAGES_TRACKED);
}

function computeTooling(repos: GithubRepoRaw[]): Record<string, boolean> {

  const topics = new Set(
    repos.flatMap((r) => r.repositoryTopics.nodes.map((n) => n.topic.name.toLowerCase()))
  );
  const has = (...keys: string[]) => keys.some((k) => topics.has(k));

  return {
    Docker: has("docker", "dockerfile"),
    Kubernetes: has("kubernetes", "k8s"),
    Terraform: has("terraform", "iac"),
    AWS: has("aws", "amazon-web-services"),
    GraphQL: has("graphql"),
    PostgreSQL: has("postgresql", "postgres"),
    "CI/CD": has("ci-cd", "github-actions", "continuous-integration"),
  };
}

function toRepoInfo(repo: GithubRepoRaw): RepoInfo {
  return {
    name: repo.name,
    url: repo.url,
    lang: repo.primaryLanguage?.name ?? "Unknown",
    original: !repo.isFork,
    complexity: estimateComplexity(repo),
    testCoverage: hasTestSignal(repo) ? 25 : 0, 
    stars: repo.stargazerCount,
    commits: repo.defaultBranchRef?.target.history.totalCount ?? 0,
    lastActiveAt: repo.pushedAt,
  };
}

function computeAccountAgeYears(createdAt: string): number {
  const ms = Date.now() - new Date(createdAt).getTime();
  return Math.round((ms / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10; // one decimal place
}

export function analyzeGithubProfile(raw: GithubProfileRaw): GithubAnalysisData {
  const allRepos = raw.repositories.nodes;
  const originalRepos = allRepos.filter((r) => !r.isFork);

  const reposForTable = [...allRepos]
    .sort((a, b) => estimateComplexity(b) - estimateComplexity(a))
    .slice(0, MAX_REPOS_IN_TABLE)
    .map(toRepoInfo);

  const shippedProjects = originalRepos
    .filter((r) => r.stargazerCount > 0 || (r.diskUsage ?? 0) > 500)
    .slice(0, 5)
    .map((r) => ({ name: r.name, url: r.url, description: r.description }));

  const externalContributions = raw.contributionsCollection.pullRequestContributionsByRepository
    .filter((c) => !c.repository.nameWithOwner.startsWith(`${raw.login}/`))
    .reduce((sum, c) => sum + c.contributions.totalCount, 0);

  const notableMerges = raw.contributionsCollection.pullRequestContributionsByRepository
    .filter(
      (c) =>
        !c.repository.nameWithOwner.startsWith(`${raw.login}/`) &&
        c.repository.stargazerCount >= NOTABLE_REPO_STAR_THRESHOLD
    )
    .map((c) => ({
      repo: c.repository.nameWithOwner,
      stars: formatStars(c.repository.stargazerCount),
      desc: `${c.contributions.totalCount} contribution${c.contributions.totalCount === 1 ? "" : "s"}`,
    }));

  const testSignalRepos = allRepos.filter(hasTestSignal).length;

  return {
    username: raw.login,
    followers: raw.followers.totalCount,
    totalStars: allRepos.reduce((sum, r) => sum + r.stargazerCount, 0),
    accountAgeYears: computeAccountAgeYears(raw.createdAt),
    repoCount: allRepos.length,
    commitsPastYear: raw.contributionsCollection.totalCommitContributions,
    activeWeeks: computeActiveWeeks(raw),
    testRatio: allRepos.length > 0 ? testSignalRepos / allRepos.length : null,
    languages: computeLanguages(allRepos),
    repos: reposForTable,
    tooling: computeTooling(allRepos),
    shippedProjects,
    externalContributions,
    notableMerges,
  };
}

function formatStars(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}
