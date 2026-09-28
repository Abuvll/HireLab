import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeApplication, ApplicationNotFoundError, NoLlmCredentialError } from "../jobs/analyze-application";
import { LiteLLMApiError } from "../extraction/litellm-client";
import { UnrecoverableError } from "bullmq";
import type { AnalysisRepository, FileStorage, GithubProfileFetcher, OrgLlmCredential } from "../jobs/types";
import type { AnthropicLikeClient } from "../extraction/resume-extract";

vi.mock("../parsing/resume", () => ({
  extractResumeText: vi.fn(async (buf: Buffer) => buf.toString()),
}));
vi.mock("../extraction/resume-extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extraction/resume-extract")>();
  return { ...actual, extractResumeData: vi.fn() };
});
vi.mock("../github/analyze", () => ({
  analyzeGithubProfile: vi.fn(),
}));
vi.mock("../scoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scoring")>();
  return { ...actual, scoreApplication: vi.fn() };
});

import { extractResumeText } from "../parsing/resume";
import { extractResumeData } from "../extraction/resume-extract";
import { analyzeGithubProfile } from "../github/analyze";
import { scoreApplication } from "../scoring";

const resumeExtractFixture = {
  education: { school: "State University", field: "Computer Science", gpa: null, gradYear: 2019 },
  yearsExperience: 5,
  topSkills: ["Python"],
  experience: [],
};
const usageFixture = { inputTokens: 1200, outputTokens: 340 };
const githubDataFixture = {
  username: "mareni",
  followers: 12,
  totalStars: 40,
  accountAgeYears: 6.2,
  repoCount: 10,
  commitsPastYear: 200,
  activeWeeks: 20,
  testRatio: 0.1,
  languages: [],
  repos: [],
  tooling: {},
  shippedProjects: [],
  externalContributions: 0,
  notableMerges: [],
};
const scoreFixture = {
  meetsRequirements: true,
  matchPct: 88,
  reqMatch: 85,
  consistency: 80,
  collaboration: 70,
  codeQuality: 90,
  evidenceMatrix: [],
};
const credentialFixture: OrgLlmCredential = { decryptedKey: "sk-ant-fake-key", model: "anthropic/claude-3-5-sonnet-20241022", provider: "ANTHROPIC" };

function makeRepository(overrides: Partial<AnalysisRepository> = {}): AnalysisRepository {
  return {
    getApplicationWithPosition: vi.fn(async () => ({
      application: {
        id: "app1",
        positionId: "pos1",
        resumeUrl: "https://files.example.com/resume.pdf",
        coverLetterText: null,
        githubUrl: "https://github.com/mareni",
      },
      position: { id: "pos1", organizationId: "org1", requirementChips: [{ label: "Python", type: "skill" as const }] },
    })),
    saveResumeExtract: vi.fn(async () => {}),
    saveGithubAnalysis: vi.fn(async () => {}),
    saveScore: vi.fn(async () => {}),
    markReady: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    getOrgLlmCredential: vi.fn(async () => credentialFixture),
    saveApiUsageEvent: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeFileStorage(): FileStorage {
  return { download: vi.fn(async () => Buffer.from("file contents")) };
}

function makeGithubClient(): GithubProfileFetcher {
  return { fetchProfile: vi.fn(async () => ({} as any)) };
}

function makeLlmClientFactory() {
  const client: AnthropicLikeClient = { messages: { create: vi.fn() } };
  return vi.fn(() => client);
}

beforeEach(() => {
  vi.mocked(extractResumeData).mockResolvedValue({ data: resumeExtractFixture, usage: usageFixture });
  vi.mocked(analyzeGithubProfile).mockReturnValue(githubDataFixture);
  vi.mocked(scoreApplication).mockReturnValue(scoreFixture);
  vi.mocked(extractResumeText).mockClear();
});

describe("analyzeApplication — happy path", () => {
  it("runs every step and marks the application ready", async () => {
    const repository = makeRepository();
    const fileStorage = makeFileStorage();
    const githubClient = makeGithubClient();
    const llmClientFactory = makeLlmClientFactory();

    await analyzeApplication("app1", { repository, fileStorage, githubClient, llmClientFactory });

    expect(repository.saveResumeExtract).toHaveBeenCalledWith("app1", resumeExtractFixture);
    expect(repository.saveGithubAnalysis).toHaveBeenCalledWith("app1", githubDataFixture);
    expect(repository.saveScore).toHaveBeenCalledWith("app1", scoreFixture);
    expect(repository.markReady).toHaveBeenCalledWith("app1");
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("builds the LLM client from the org's own decrypted key and model, not a global credential", async () => {
    const repository = makeRepository();
    const llmClientFactory = makeLlmClientFactory();

    await analyzeApplication("app1", {
      repository,
      fileStorage: makeFileStorage(),
      githubClient: makeGithubClient(),
      llmClientFactory,
    });

    expect(llmClientFactory).toHaveBeenCalledWith("sk-ant-fake-key");
    expect(extractResumeData).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-3-5-sonnet-20241022" })
    );
  });

  it("records a usage event with the org, application, model, and token counts", async () => {
    const repository = makeRepository();
    await analyzeApplication("app1", {
      repository,
      fileStorage: makeFileStorage(),
      githubClient: makeGithubClient(),
      llmClientFactory: makeLlmClientFactory(),
    });

    expect(repository.saveApiUsageEvent).toHaveBeenCalledWith({
      organizationId: "org1",
      applicationId: "app1",
      model: "anthropic/claude-3-5-sonnet-20241022",
      tokensIn: 1200,
      tokensOut: 340,
      costUsd: undefined,
    });
  });

  it("threads cost through to the usage event when the LLM client reports one", async () => {
    const repository = makeRepository();
    vi.mocked(extractResumeData).mockResolvedValueOnce({ data: resumeExtractFixture, usage: usageFixture, costUsd: 0.0037 });
    await analyzeApplication("app1", {
      repository,
      fileStorage: makeFileStorage(),
      githubClient: makeGithubClient(),
      llmClientFactory: makeLlmClientFactory(),
    });
    expect(repository.saveApiUsageEvent).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0.0037 }));
  });

  it("only ever downloads the resume — cover letter is submitted as text, never a file", async () => {
    const repository = makeRepository();
    const fileStorage = makeFileStorage();
    await analyzeApplication("app1", {
      repository,
      fileStorage,
      githubClient: makeGithubClient(),
      llmClientFactory: makeLlmClientFactory(),
    });
    expect(fileStorage.download).toHaveBeenCalledTimes(1);
  });

  it("passes coverLetterText straight through to extraction when present, with no file download involved", async () => {
    const repository = makeRepository({
      getApplicationWithPosition: vi.fn(async () => ({
        application: {
          id: "app1",
          positionId: "pos1",
          resumeUrl: "https://files.example.com/resume.pdf",
          coverLetterText: "I'm excited to apply because...",
          githubUrl: "https://github.com/mareni",
        },
        position: { id: "pos1", organizationId: "org1", requirementChips: [] },
      })),
    });
    const fileStorage = makeFileStorage();
    await analyzeApplication("app1", {
      repository,
      fileStorage,
      githubClient: makeGithubClient(),
      llmClientFactory: makeLlmClientFactory(),
    });
    expect(fileStorage.download).toHaveBeenCalledTimes(1); // resume only
    expect(extractResumeData).toHaveBeenCalledWith(
      expect.objectContaining({ coverLetterText: "I'm excited to apply because..." })
    );
  });

  it("passes the position's requirement chips into scoring", async () => {
    const chips = [{ label: "Kubernetes", type: "skill" as const }];
    const repository = makeRepository({
      getApplicationWithPosition: vi.fn(async () => ({
        application: {
          id: "app1",
          positionId: "pos1",
          resumeUrl: "https://files.example.com/resume.pdf",
          coverLetterText: null,
          githubUrl: "https://github.com/mareni",
        },
        position: { id: "pos1", organizationId: "org1", requirementChips: chips },
      })),
    });
    await analyzeApplication("app1", {
      repository,
      fileStorage: makeFileStorage(),
      githubClient: makeGithubClient(),
      llmClientFactory: makeLlmClientFactory(),
    });
    expect(scoreApplication).toHaveBeenCalledWith(chips, resumeExtractFixture, githubDataFixture);
  });
});

describe("analyzeApplication — failure handling", () => {
  it("throws ApplicationNotFoundError when the application doesn't exist, without touching other deps", async () => {
    const repository = makeRepository({ getApplicationWithPosition: vi.fn(async () => null) });
    const fileStorage = makeFileStorage();

    await expect(
      analyzeApplication("missing", {
        repository,
        fileStorage,
        githubClient: makeGithubClient(),
        llmClientFactory: makeLlmClientFactory(),
      })
    ).rejects.toThrow(ApplicationNotFoundError);

    expect(fileStorage.download).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("marks the application failed with a clear reason when the org has no AI provider key configured, without downloading anything", async () => {
    const repository = makeRepository({ getOrgLlmCredential: vi.fn(async () => null) });
    const fileStorage = makeFileStorage();

    await expect(
      analyzeApplication("app1", {
        repository,
        fileStorage,
        githubClient: makeGithubClient(),
        llmClientFactory: makeLlmClientFactory(),
      })
    ).rejects.toThrow(NoLlmCredentialError);

    expect(fileStorage.download).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith(
      "app1",
      expect.stringContaining("No AI provider key configured")
    );
  });

  it("marks the application failed with a reason when file download fails", async () => {
    const repository = makeRepository();
    const fileStorage: FileStorage = { download: vi.fn(async () => { throw new Error("storage unreachable"); }) };

    await expect(
      analyzeApplication("app1", {
        repository,
        fileStorage,
        githubClient: makeGithubClient(),
        llmClientFactory: makeLlmClientFactory(),
      })
    ).rejects.toThrow("storage unreachable");

    expect(repository.markFailed).toHaveBeenCalledWith("app1", "storage unreachable");
    expect(repository.saveResumeExtract).not.toHaveBeenCalled();
  });

  it("marks the application failed when GitHub analysis fails, but keeps the already-saved resume extract", async () => {
    const repository = makeRepository();
    const githubClient: GithubProfileFetcher = {
      fetchProfile: vi.fn(async () => { throw new Error("GitHub user not found"); }),
    };

    await expect(
      analyzeApplication("app1", {
        repository,
        fileStorage: makeFileStorage(),
        githubClient,
        llmClientFactory: makeLlmClientFactory(),
      })
    ).rejects.toThrow("GitHub user not found");

    expect(repository.saveResumeExtract).toHaveBeenCalled(); // already-completed step stays saved
    expect(repository.saveGithubAnalysis).not.toHaveBeenCalled();
    expect(repository.saveScore).not.toHaveBeenCalled();
    expect(repository.markReady).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledWith("app1", "GitHub user not found");
  });

  it("marks the application failed when LLM extraction fails after both retries", async () => {
    const repository = makeRepository();
    vi.mocked(extractResumeData).mockRejectedValueOnce(new Error("model did not return valid JSON"));

    await expect(
      analyzeApplication("app1", {
        repository,
        fileStorage: makeFileStorage(),
        githubClient: makeGithubClient(),
        llmClientFactory: makeLlmClientFactory(),
      })
    ).rejects.toThrow("model did not return valid JSON");

    expect(repository.markFailed).toHaveBeenCalledWith("app1", "model did not return valid JSON");
  });
});

describe("analyzeApplication — retry-aware failure handling (isFinalAttempt)", () => {
  it("does NOT mark the application failed on a transient error when a retry is still pending", async () => {
    const repository = makeRepository();
    vi.mocked(extractResumeData).mockRejectedValueOnce(new LiteLLMApiError("proxy timed out", undefined, "timeout"));

    await expect(
      analyzeApplication(
        "app1",
        { repository, fileStorage: makeFileStorage(), githubClient: makeGithubClient(), llmClientFactory: makeLlmClientFactory() },
        { isFinalAttempt: false }
      )
    ).rejects.toThrow("proxy timed out");

    // BullMQ still has retries left — showing FAILED now, only to flip back a moment later if the retry
    // succeeds, is a false failure the employer could see and act on prematurely.
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("DOES mark the application failed once isFinalAttempt is true, even for the same transient error", async () => {
    const repository = makeRepository();
    vi.mocked(extractResumeData).mockRejectedValueOnce(new LiteLLMApiError("proxy timed out", undefined, "timeout"));

    await expect(
      analyzeApplication(
        "app1",
        { repository, fileStorage: makeFileStorage(), githubClient: makeGithubClient(), llmClientFactory: makeLlmClientFactory() },
        { isFinalAttempt: true }
      )
    ).rejects.toThrow("proxy timed out");

    expect(repository.markFailed).toHaveBeenCalledWith("app1", "proxy timed out");
  });

  it("defaults isFinalAttempt to true when not specified, matching the old always-mark-failed behavior", async () => {
    const repository = makeRepository();
    const fileStorage: FileStorage = { download: vi.fn(async () => { throw new Error("storage unreachable"); }) };

    await expect(
      analyzeApplication("app1", { repository, fileStorage, githubClient: makeGithubClient(), llmClientFactory: makeLlmClientFactory() })
    ).rejects.toThrow("storage unreachable");

    expect(repository.markFailed).toHaveBeenCalledWith("app1", "storage unreachable");
  });

  for (const kind of ["auth", "model_unavailable"] as const) {
    it(`marks failed immediately for a '${kind}' error even when isFinalAttempt is false, and throws UnrecoverableError to stop further retries`, async () => {
      const repository = makeRepository();
      vi.mocked(extractResumeData).mockRejectedValueOnce(new LiteLLMApiError(`${kind} failure`, 401, kind));

      await expect(
        analyzeApplication(
          "app1",
          { repository, fileStorage: makeFileStorage(), githubClient: makeGithubClient(), llmClientFactory: makeLlmClientFactory() },
          { isFinalAttempt: false }
        )
      ).rejects.toThrow(UnrecoverableError);

      expect(repository.markFailed).toHaveBeenCalledWith("app1", `${kind} failure`);
    });
  }

  for (const kind of ["rate_limit", "connectivity", "unknown"] as const) {
    it(`does NOT mark failed or throw UnrecoverableError for a '${kind}' error when a retry is still pending — it may still succeed`, async () => {
      const repository = makeRepository();
      vi.mocked(extractResumeData).mockRejectedValueOnce(new LiteLLMApiError(`${kind} failure`, 500, kind));

      const result = analyzeApplication(
        "app1",
        { repository, fileStorage: makeFileStorage(), githubClient: makeGithubClient(), llmClientFactory: makeLlmClientFactory() },
        { isFinalAttempt: false }
      );

      await expect(result).rejects.toThrow(`${kind} failure`);
      await expect(result).rejects.not.toThrow(UnrecoverableError);
      expect(repository.markFailed).not.toHaveBeenCalled();
    });
  }

  it("a missing AI provider key is treated as retryable, not unrecoverable (the org might add one within the retry window)", async () => {
    const repository = makeRepository({ getOrgLlmCredential: vi.fn(async () => null) });

    const result = analyzeApplication(
      "app1",
      { repository, fileStorage: makeFileStorage(), githubClient: makeGithubClient(), llmClientFactory: makeLlmClientFactory() },
      { isFinalAttempt: false }
    );

    await expect(result).rejects.toThrow(NoLlmCredentialError);
    await expect(result).rejects.not.toThrow(UnrecoverableError);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });
});
