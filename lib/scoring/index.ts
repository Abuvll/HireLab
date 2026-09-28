import type { RequirementChip, ResumeExtractData, GithubAnalysisData, ScoreResult } from "./types";
import { checkGate } from "./gate";
import { buildEvidenceMatrix } from "./evidence";
import { computeSubScores, computeMatchPct } from "./subscores";


export function scoreApplication(
  requirementChips: RequirementChip[],
  resume: ResumeExtractData,
  github: GithubAnalysisData
): ScoreResult {
  const gate = checkGate(requirementChips, resume, github);
  const scores = computeSubScores(resume, github, requirementChips);
  const matchPct = computeMatchPct(scores);
  const evidenceMatrix = buildEvidenceMatrix(requirementChips, resume, github);

  return {
    meetsRequirements: gate.pass,
    matchPct,
    reqMatch: scores.reqMatch,
    consistency: scores.consistency,
    collaboration: scores.collaboration,
    codeQuality: scores.codeQuality,
    evidenceMatrix,
  };
}

export * from "./types";
export * from "./gate";
export * from "./evidence";
export * from "./subscores";
export * from "./rank";
