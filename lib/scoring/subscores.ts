import type { RequirementChip, ResumeExtractData, GithubAnalysisData } from "./types";
import { DEFAULT_WEIGHTS } from "./types";
import { parseYearsRequirement, hasSkillEvidence } from "./gate";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

// Graded (0-100) version of the gate check in gate.ts: instead of a hard
// pass/fail, each requirement chip contributes a 0-1 satisfaction score,
// averaged across all chips. Uses the exact same evidence rules as the gate
// (hasSkillEvidence, parseYearsRequirement) so a candidate who narrowly
// fails the gate still gets a reqMatch score that reflects how close they
// were, rather than falling off a cliff to 0.
export function computeReqMatchScore(
  resume: ResumeExtractData,
  github: GithubAnalysisData,
  requirementChips: RequirementChip[]
): number {
  if (requirementChips.length === 0) return 100;

  const chipScores = requirementChips.map((chip) => {
    if (chip.type === "location") return 1; // no evaluation criteria — see evidence.ts

    if (chip.type === "experience") {
      const requiredYears = parseYearsRequirement(chip.label);
      if (requiredYears === null || requiredYears === 0) return 1;
      return clamp(resume.yearsExperience / requiredYears, 0, 1);
    }

    return hasSkillEvidence(chip.label, resume, github) ? 1 : 0;
  });

  const avg = chipScores.reduce((sum, s) => sum + s, 0) / chipScores.length;
  return Math.round(clamp(avg * 100));
}

// Code quality only — repo complexity + test coverage. Relevance-to-the-JD
// (what "technical" used to blend in via %-of-code-in-required-languages)
// now lives entirely in reqMatch above, so this stays a clean signal of
// "how well-built is this person's code", independent of what the role asks for.
export function computeCodeQualityScore(github: GithubAnalysisData): number {
  const originalRepos = github.repos.filter((r) => r.original);
  const avgComplexity =
    originalRepos.length > 0
      ? originalRepos.reduce((sum, r) => sum + r.complexity, 0) / originalRepos.length / 5
      : 0.3;

  const testSignal = github.testRatio ?? 0;

  const score = 100 * (0.6 * avgComplexity + 0.4 * testSignal);
  return Math.round(clamp(score));
}


export function computeConsistencyScore(github: GithubAnalysisData): number {
  const weeksRatio = clamp((github.activeWeeks / 52) * 100) / 100;
  const commitsNorm = clamp((github.commitsPastYear / 600) * 100) / 100; 

  const score = 100 * (0.6 * weeksRatio + 0.4 * commitsNorm);
  return Math.round(clamp(score));
}


export function computeCollaborationScore(github: GithubAnalysisData): number {
  const externalNorm = clamp((github.externalContributions / 20) * 100) / 100; 
  const mergeBonus = github.notableMerges.length > 0 ? 15 : 0;

  const score = 100 * externalNorm * 0.85 + mergeBonus;
  return Math.round(clamp(score));
}


export type SubScores = {
  reqMatch: number;
  consistency: number;
  collaboration: number;
  codeQuality: number;
};

export function computeSubScores(
  resume: ResumeExtractData,
  github: GithubAnalysisData,
  requirementChips: RequirementChip[]
): SubScores {
  return {
    reqMatch: computeReqMatchScore(resume, github, requirementChips),
    consistency: computeConsistencyScore(github),
    collaboration: computeCollaborationScore(github),
    codeQuality: computeCodeQualityScore(github),
  };
}

export function computeMatchPct(
  scores: SubScores,
  weights: typeof DEFAULT_WEIGHTS = DEFAULT_WEIGHTS
): number {
  const weighted =
    scores.reqMatch * weights.reqMatch +
    scores.consistency * weights.consistency +
    scores.collaboration * weights.collaboration +
    scores.codeQuality * weights.codeQuality;
  return Math.round(clamp(weighted));
}
