import { fetchGithubProfile } from "../github/client";
import type { GithubProfileFetcher } from "../jobs/types";
import type { GithubProfileRaw } from "../github/types";


export class GithubApiFetcher implements GithubProfileFetcher {
  constructor(private readonly token: string) {}

  fetchProfile(githubUrlOrUsername: string): Promise<GithubProfileRaw> {
    return fetchGithubProfile(githubUrlOrUsername, this.token);
  }
}
