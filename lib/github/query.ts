
export const GITHUB_PROFILE_QUERY = /* GraphQL */ `
  query CandidateProfile($login: String!) {
    user(login: $login) {
      login
      createdAt
      followers {
        totalCount
      }
      repositories(
        first: 50
        ownerAffiliations: [OWNER]
        orderBy: { field: PUSHED_AT, direction: DESC }
        isArchived: false
      ) {
        nodes {
          name
          url
          description
          isFork
          stargazerCount
          diskUsage
          pushedAt
          primaryLanguage {
            name
          }
          languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
              }
            }
          }
          owner {
            login
          }
          repositoryTopics(first: 10) {
            nodes {
              topic {
                name
              }
            }
          }
          defaultBranchRef {
            target {
              ... on Commit {
                history {
                  totalCount
                }
              }
            }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        contributionCalendar {
          weeks {
            contributionDays {
              contributionCount
            }
          }
        }
        pullRequestContributionsByRepository(maxRepositories: 25) {
          repository {
            nameWithOwner
            owner {
              login
            }
            stargazerCount
          }
          contributions {
            totalCount
          }
        }
      }
    }
  }
`;
