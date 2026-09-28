import type { RequirementChip, ResumeExtractData, GithubAnalysisData, ScoreResult } from "../scoring/types";
import type { GithubProfileRaw } from "../github/types";
import type { LlmProvider } from "../domain-enums";

export type ApplicationRecord = {
  id: string;
  positionId: string;
  resumeUrl: string;
  coverLetterText: string | null;
  githubUrl: string;
};

export type PositionRecord = {
  id: string;
  organizationId: string;
  requirementChips: RequirementChip[];
};

export type ApplicationWithPosition = {
  application: ApplicationRecord;
  position: PositionRecord;
};

export type OrgLlmCredential = {
  decryptedKey: string;
  model: string;
  // Which upstream provider this key belongs to (see LLM_PROVIDERS in ../domain-enums). analyzeApplication()
  // itself doesn't need this — the model string's own provider prefix (e.g. "anthropic/...") is what actually
  // routes the request — but it's part of the org's stored credential, so it's part of what resolving that
  // credential returns.
  provider: LlmProvider;
};

export type ApplicationFailureStatus = "FAILED";
export type ApplicationSuccessStatus = "READY";

export interface AnalysisRepository {
  getApplicationWithPosition(applicationId: string): Promise<ApplicationWithPosition | null>;
  saveResumeExtract(applicationId: string, data: ResumeExtractData): Promise<void>;
  saveGithubAnalysis(applicationId: string, data: GithubAnalysisData): Promise<void>;
  saveScore(applicationId: string, score: ScoreResult): Promise<void>;
  markReady(applicationId: string): Promise<void>;
  markFailed(applicationId: string, reason: string): Promise<void>;
  // Resolves and decrypts the org's stored BYOK provider key. Null means no key has been saved yet —
  // analyzeApplication() treats that as a clean, expected failure reason, not an exceptional error.
  getOrgLlmCredential(organizationId: string): Promise<OrgLlmCredential | null>;
  saveApiUsageEvent(event: {
    organizationId: string;
    applicationId: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    // Undefined when the provider/proxy didn't report a cost for this call — left unset rather than coerced to
    // 0, since "free" and "unknown" are different things. See lib/extraction/litellm-client.ts.
    costUsd?: number;
  }): Promise<void>;
}

export interface FileStorage {
  download(url: string): Promise<Buffer>;
}

export interface GithubProfileFetcher {
  fetchProfile(githubUrlOrUsername: string): Promise<GithubProfileRaw>;
}
