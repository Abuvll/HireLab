import type { ResumeExtractData, GithubAnalysisData, ScoreResult } from "../scoring/types";
import { computePercentiles, type RankableApplication } from "../scoring/rank";
import { deriveApplicationStatus, type ApplicationStatus } from "../domain-enums";

export type CandidateFlag = { severity: "good" | "warn"; message: string };

export type ApplicationContact = {
  fullName: string;
  contactMethod: string;
  email: string | null;
  phone: string | null;
  createdAt: Date | string;
  status: ApplicationStatus;
  resumeUrl: string | null;
  portfolioUrl: string | null;
};

export function deriveFlags(score: ScoreResult): CandidateFlag[] {
  const unmet = score.evidenceMatrix.filter((e) => !e.met);
  if (unmet.length === 0) {
    return [{ severity: "good", message: "Meets every stated requirement for this position" }];
  }
  return unmet.map((e) => ({ severity: "warn", message: `${e.requirement}: ${e.evidence}` }));
}

function toolingToDetectedList(tooling: Record<string, boolean>): { name: string; detected: boolean }[] {
  return Object.entries(tooling).map(([name, detected]) => ({ name, detected }));
}

export function buildCandidateDetail(
  application: ApplicationContact & { id: string },
  resume: ResumeExtractData,
  github: GithubAnalysisData,
  score: ScoreResult,
  poolScores: RankableApplication[]
) {
  const percentileEntries = computePercentiles(poolScores);
  const mine = percentileEntries.find((p) => p.applicationId === application.id);

  const percentiles = mine ?? {
    overall: 0,
    reqMatch: 0,
    consistency: 0,
    collaboration: 0,
    codeQuality: 0,
  };

  const ranked = [...poolScores].sort((a, b) => b.matchPct - a.matchPct);
  const rank = ranked.findIndex((a) => a.applicationId === application.id) + 1; // 0 if not in the pool (e.g. gate-failed)

  return {
    application: {
      id: application.id,
      fullName: application.fullName,
      email: application.email,
      phone: application.phone,
      createdAt: application.createdAt,
      status: deriveApplicationStatus(application.status, score.meetsRequirements),
      score: {
        overall: score.matchPct,
        reqMatch: score.reqMatch,
        consistency: score.consistency,
        collaboration: score.collaboration,
        codeQuality: score.codeQuality,
        evidenceMatrix: score.evidenceMatrix,
        percentiles,
        flags: deriveFlags(score),
      },
    },
    rank: rank || null,
    totalInPosition: poolScores.length,
    percentile: percentiles.overall,
    resumeExtract: {
      education: resume.education,
      experience: resume.experience,
    },
    resumeUrl: application.resumeUrl,
    portfolioUrl: application.portfolioUrl,
    githubAnalysis: {
      username: github.username,
      followers: github.followers,
      totalStars: github.totalStars,
      totalCommitsLastYear: github.commitsPastYear,
      accountAgeYears: github.accountAgeYears,
      languages: github.languages,
      shippedProjects: github.shippedProjects,
      repos: github.repos.map((r) => ({ ...r, isFork: !r.original })),
      toolingDetected: toolingToDetectedList(github.tooling),
    },
  };
}
