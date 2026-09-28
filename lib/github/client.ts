import { GITHUB_PROFILE_QUERY } from "./query";
import type { GithubProfileRaw } from "./types";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

export class GithubFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GithubFetchError";
  }
}

export function extractGithubUsername(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  const match = trimmed.match(/github\.com\/([A-Za-z0-9-]+)/i);
  if (match) return match[1];
  // assume they passed a bare username
  return trimmed.replace(/^@/, "");
}


export async function fetchGithubProfile(
  githubUrlOrUsername: string,
  token: string
): Promise<GithubProfileRaw> {
  const login = extractGithubUsername(githubUrlOrUsername);

  const res = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: GITHUB_PROFILE_QUERY, variables: { login } }),
  });

  if (!res.ok) {
    throw new GithubFetchError(`GitHub API request failed: ${res.statusText}`, res.status);
  }

  const json = await res.json();

  if (json.errors?.length) {
    const notFound = json.errors.some((e: { type?: string }) => e.type === "NOT_FOUND");
    throw new GithubFetchError(
      notFound ? `GitHub user not found: ${login}` : `GitHub API error: ${json.errors[0].message}`
    );
  }

  if (!json.data?.user) {
    throw new GithubFetchError(`GitHub user not found: ${login}`);
  }

  return json.data.user as GithubProfileRaw;
}
