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

  getOrgLlmCredential(organizationId: string): Promise<OrgLlmCredential | null>;
  saveApiUsageEvent(event: {
    organizationId: string;
    applicationId: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
  
    costUsd?: number;
  }): Promise<void>;
}

export interface FileStorage {
  download(url: string): Promise<Buffer>;
}

export interface GithubProfileFetcher {
  fetchProfile(githubUrlOrUsername: string): Promise<GithubProfileRaw>;
}
