
export type GithubRepoRaw = {
  name: string;
  url: string;
  description: string | null;
  isFork: boolean;
  stargazerCount: number;
  diskUsage: number | null;
  pushedAt: string; 
  primaryLanguage: { name: string } | null;
  languages: {
    edges: { size: number; node: { name: string } }[];
  };
  owner: { login: string };
  repositoryTopics: {
    nodes: { topic: { name: string } }[];
  };
  // commit count on the default branch — null when the repo is empty or has no default branch
  defaultBranchRef: {
    target: { history: { totalCount: number } };
  } | null;
};

export type ContributionWeekRaw = {
  contributionDays: { contributionCount: number }[];
};

export type PullRequestContributionsByRepoRaw = {
  repository: { nameWithOwner: string; owner: { login: string }; stargazerCount: number };
  contributions: { totalCount: number };
};

export type GithubProfileRaw = {
  login: string;
  createdAt: string;
  followers: { totalCount: number };
  repositories: { nodes: GithubRepoRaw[] };
  contributionsCollection: {
    totalCommitContributions: number;
    contributionCalendar: {
      weeks: ContributionWeekRaw[];
    };
    pullRequestContributionsByRepository: PullRequestContributionsByRepoRaw[];
  };
};
