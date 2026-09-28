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
  // The org's own key, not a single global credential — constructs a client per job from whatever key that
  // org has configured. The real wiring (lib/jobs/worker.ts) passes (apiKey) => new LiteLLMClient(apiKey);
  // tests inject a fake so no real network/encryption is needed to test the pipeline's control flow.
  llmClientFactory: (apiKey: string) => AnthropicLikeClient;
};

export class ApplicationNotFoundError extends Error {
  constructor(applicationId: string) {
    super(`Application not found: ${applicationId}`);
    this.name = "ApplicationNotFoundError";
  }
}

// Thrown (and caught into a normal markFailed(), not re-thrown as a crash)
// when the org hasn't configured an AI provider key yet. Distinct error
// type so callers/logs can tell "org hasn't set this up" apart from "the
// pipeline broke" — see the failureReason surfaced to the dashboard.
export class NoLlmCredentialError extends Error {
  constructor() {
    super("No AI provider key configured for this organization — add one in Settings → API Keys.");
    this.name = "NoLlmCredentialError";
  }
}

export async function analyzeApplication(
  applicationId: string,
  deps: AnalyzeApplicationDeps,
  // isFinalAttempt: whether BullMQ has no retries left after this one (see lib/jobs/worker.ts, which computes
  // this from job.attemptsMade/job.opts.attempts before calling in). Defaults to true — i.e. "always mark
  // failed on any error" — so a caller (or an existing test) that doesn't pass it gets the old, simpler
  // behavior rather than silently swallowing a failure it didn't know to expect might retry.
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

    // Some failures won't be fixed by retrying with the exact same inputs — the org's key was rejected, or the
    // model they picked doesn't exist. Retrying those 3x with unchanged inputs just delays a foregone
    // conclusion (and for a real provider call, spends tokens on attempts that were always going to fail the
    // same way). UnrecoverableError tells BullMQ to stop retrying after this attempt regardless of the
    // configured `attempts` count.
    const unrecoverable = err instanceof LiteLLMApiError && (err.kind === "auth" || err.kind === "model_unavailable");

    // A transient failure (timeout, connectivity, rate limit, or anything not specifically classified) is only
    // recorded as a user-visible FAILED once BullMQ has actually given up — not on attempt 1 of 3, when a
    // retry 5s later might succeed. Marking it failed immediately on every attempt showed the employer a false
    // failure during the retry window even when the job went on to succeed a moment later.
    if (unrecoverable || isFinalAttempt) {
      await deps.repository.markFailed(applicationId, reason);
    }
    throw unrecoverable ? new UnrecoverableError(reason) : err;
  }
}
