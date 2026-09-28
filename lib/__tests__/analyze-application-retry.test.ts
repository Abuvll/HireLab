import { describe, it, expect, vi } from "vitest";
import { analyzeApplication, NoLlmCredentialError } from "../jobs/analyze-application";
import type { AnalysisRepository, FileStorage, GithubProfileFetcher, OrgLlmCredential } from "../jobs/types";
import type { AnthropicLikeClient } from "../extraction/resume-extract";
import { LiteLLMApiError } from "../extraction/litellm-client";
import { UnrecoverableError } from "bullmq";

// Companion to analyze-application.test.ts, which covers the same isFinalAttempt/UnrecoverableError behavior
// but needs vi.mock (to fake out extractResumeData/analyzeGithubProfile/scoreApplication) to reach the happy
// path — this file avoids vi.mock entirely by making the FAKE LLM CLIENT throw directly from messages.create(),
// which the real (unmocked) extractResumeData propagates untouched, so it's fully executable in any sandbox
// that only lacks vi.mock's module-interception support.

const credentialFixture: OrgLlmCredential = { decryptedKey: "sk-ant-fake-key", model: "anthropic/claude-3-5-sonnet-20241022", provider: "ANTHROPIC" };

function makeRepository(overrides: Partial<AnalysisRepository> = {}): AnalysisRepository {
  return {
    getApplicationWithPosition: vi.fn(async () => ({
      application: { id: "app1", positionId: "pos1", resumeUrl: "https://files.example.com/resume.pdf", coverLetterText: null, githubUrl: "https://github.com/x" },
      position: { id: "pos1", organizationId: "org1", requirementChips: [] },
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
const fileStorage: FileStorage = { download: vi.fn(async () => Buffer.from("resume text")) };
const githubClient: GithubProfileFetcher = { fetchProfile: vi.fn(async () => ({} as never)) };

function llmThatThrows(err: unknown) {
  const client: AnthropicLikeClient = { messages: { create: vi.fn(async () => { throw err; }) } };
  return () => client;
}

describe("analyzeApplication — isFinalAttempt gating (executable, no vi.mock)", () => {
  it("a transient error with retries remaining does NOT mark the application failed", async () => {
    const repository = makeRepository();
    const err = new LiteLLMApiError("proxy timed out", undefined, "timeout");

    await expect(
      analyzeApplication("app1", { repository, fileStorage, githubClient, llmClientFactory: llmThatThrows(err) }, { isFinalAttempt: false })
    ).rejects.toThrow("proxy timed out");

    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("the same transient error on the final attempt DOES mark the application failed", async () => {
    const repository = makeRepository();
    const err = new LiteLLMApiError("proxy timed out", undefined, "timeout");

    await expect(
      analyzeApplication("app1", { repository, fileStorage, githubClient, llmClientFactory: llmThatThrows(err) }, { isFinalAttempt: true })
    ).rejects.toThrow("proxy timed out");

    expect(repository.markFailed).toHaveBeenCalledWith("app1", "proxy timed out");
  });

  it("omitting opts entirely defaults to isFinalAttempt=true (old behavior preserved for any caller that doesn't know about retries)", async () => {
    const repository = makeRepository();
    const err = new LiteLLMApiError("proxy timed out", undefined, "timeout");

    await expect(analyzeApplication("app1", { repository, fileStorage, githubClient, llmClientFactory: llmThatThrows(err) })).rejects.toThrow();

    expect(repository.markFailed).toHaveBeenCalledWith("app1", "proxy timed out");
  });

  it("a plain (non-LiteLLMApiError) Error is always treated as retryable, never unrecoverable", async () => {
    const repository = makeRepository();

    const result = analyzeApplication(
      "app1",
      { repository, fileStorage, githubClient, llmClientFactory: llmThatThrows(new Error("something unexpected")) },
      { isFinalAttempt: false }
    );

    await expect(result).rejects.not.toThrow(UnrecoverableError);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  for (const kind of ["auth", "model_unavailable"] as const) {
    it(`'${kind}' is unrecoverable: marks failed and throws UnrecoverableError even with retries remaining`, async () => {
      const repository = makeRepository();
      const err = new LiteLLMApiError(`${kind} problem`, 401, kind);

      await expect(
        analyzeApplication("app1", { repository, fileStorage, githubClient, llmClientFactory: llmThatThrows(err) }, { isFinalAttempt: false })
      ).rejects.toThrow(UnrecoverableError);

      expect(repository.markFailed).toHaveBeenCalledWith("app1", `${kind} problem`);
    });
  }

  for (const kind of ["rate_limit", "connectivity", "unknown"] as const) {
    it(`'${kind}' is retryable: no markFailed and no UnrecoverableError while retries remain`, async () => {
      const repository = makeRepository();
      const err = new LiteLLMApiError(`${kind} problem`, 500, kind);

      const result = analyzeApplication("app1", { repository, fileStorage, githubClient, llmClientFactory: llmThatThrows(err) }, { isFinalAttempt: false });

      await expect(result).rejects.toThrow(`${kind} problem`);
      await expect(result).rejects.not.toThrow(UnrecoverableError);
      expect(repository.markFailed).not.toHaveBeenCalled();
    });
  }

  it("NoLlmCredentialError (thrown before any LLM call) is retryable, not unrecoverable", async () => {
    const repository = makeRepository({ getOrgLlmCredential: vi.fn(async () => null) });

    const result = analyzeApplication(
      "app1",
      { repository, fileStorage, githubClient, llmClientFactory: llmThatThrows(new Error("should not be reached")) },
      { isFinalAttempt: false }
    );

    await expect(result).rejects.toThrow(NoLlmCredentialError);
    await expect(result).rejects.not.toThrow(UnrecoverableError);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("one application failing this way never touches a different application's repository calls", async () => {
    // Two independent invocations (mirroring two concurrent jobs), one failing unrecoverably.
    const repoA = makeRepository();
    const repoB = makeRepository();
    const errA = new LiteLLMApiError("org A's key is bad", 401, "auth");

    await analyzeApplication("appA", { repository: repoA, fileStorage, githubClient, llmClientFactory: llmThatThrows(errA) }, { isFinalAttempt: false }).catch(() => {});
    await analyzeApplication("appB", { repository: repoB, fileStorage, githubClient, llmClientFactory: () => ({ messages: { create: vi.fn(async () => { throw new Error("appB own failure"); }) } }) }, { isFinalAttempt: false }).catch(() => {});

    expect(repoA.markFailed).toHaveBeenCalledWith("appA", "org A's key is bad");
    expect(repoB.markFailed).not.toHaveBeenCalled(); // appB's error was retryable and had attempts left
  });
});
