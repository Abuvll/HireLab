import type { AnalysisRepository, FileStorage, GithubProfileFetcher } from "./types";
import type { AnthropicLikeClient } from "../extraction/resume-extract";
import { extractResumeText } from "../parsing/resume";
import { extractResumeData } from "../extraction/resume-extract";
import { analyzeGithubProfile } from "../github/analyze";
import { scoreApplication } from "../scoring";
import { inferMimeTypeFromUrl } from "./mime";
import { LiteLLMApiError } from "../extraction/litellm-client";
import { UnrecoverableError } from "bullmq";

export type AnalyzeApplicationDeps = {
  repository: AnalysisRepository;
  fileStorage: FileStorage;
  githubClient: GithubProfileFetcher;

  llmClientFactory: (apiKey: string) => AnthropicLikeClient;
};

export class ApplicationNotFoundError extends Error {
  constructor(applicationId: string) {
    super(`Application not found: ${applicationId}`);
    this.name = "ApplicationNotFoundError";
  }
}

export class NoLlmCredentialError extends Error {
  constructor() {
    super("No AI provider key configured for this organization — add one in Settings → API Keys.");
    this.name = "NoLlmCredentialError";
  }
}

export async function analyzeApplication(
  applicationId: string,
  deps: AnalyzeApplicationDeps,

  opts: { isFinalAttempt?: boolean } = {}
): Promise<void> {
  const isFinalAttempt = opts.isFinalAttempt ?? true;
  const record = await deps.repository.getApplicationWithPosition(applicationId);
  if (!record) throw new ApplicationNotFoundError(applicationId);
  const { application, position } = record;

  try {
    const credential = await deps.repository.getOrgLlmCredential(position.organizationId);
    if (!credential) throw new NoLlmCredentialError();

    const resumeBuffer = await deps.fileStorage.download(application.resumeUrl);
    const resumeText = await extractResumeText(resumeBuffer, inferMimeTypeFromUrl(application.resumeUrl));

    const coverLetterText = application.coverLetterText ?? undefined;

    const llmClient = deps.llmClientFactory(credential.decryptedKey);
    const { data: resumeData, usage, costUsd } = await extractResumeData({
      resumeText,
      coverLetterText,
      client: llmClient,
      model: credential.model,
    });
    await deps.repository.saveResumeExtract(applicationId, resumeData);
    await deps.repository.saveApiUsageEvent({
      organizationId: position.organizationId,
      applicationId,
      model: credential.model,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      costUsd,
    });

    const rawProfile = await deps.githubClient.fetchProfile(application.githubUrl);
    const githubData = analyzeGithubProfile(rawProfile);
    await deps.repository.saveGithubAnalysis(applicationId, githubData);

    const score = scoreApplication(position.requirementChips, resumeData, githubData);
    await deps.repository.saveScore(applicationId, score);

    await deps.repository.markReady(applicationId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    const unrecoverable = err instanceof LiteLLMApiError && (err.kind === "auth" || err.kind === "model_unavailable");

    if (unrecoverable || isFinalAttempt) {
      await deps.repository.markFailed(applicationId, reason);
    }
    throw unrecoverable ? new UnrecoverableError(reason) : err;
  }
}
