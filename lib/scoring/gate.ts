import type {
  RequirementChip,
  ResumeExtractData,
  GithubAnalysisData,
} from "./types";


export function parseYearsRequirement(label: string): number | null {
  const match = label.toLowerCase().match(/(\d+)\+?\s*(yr|year)/);
  return match ? parseInt(match[1], 10) : null;
}

export function hasSkillEvidence(
  label: string,
  resume: ResumeExtractData,
  github: GithubAnalysisData
): boolean {
  const lower = label.toLowerCase();

  const inLanguages = github.languages.some((l) => l.name.toLowerCase() === lower);
  if (inLanguages) return true;

  const toolKey = Object.keys(github.tooling).find((k) => k.toLowerCase() === lower);
  if (toolKey && github.tooling[toolKey]) return true;

  const inTopSkills = resume.topSkills.some((s) => s.toLowerCase() === lower);
  if (inTopSkills) return true;

  return false;
}

export type GateResult = {
  pass: boolean;
  failedRequirements: string[];
};


export function checkGate(
  requirementChips: RequirementChip[],
  resume: ResumeExtractData,
  github: GithubAnalysisData
): GateResult {
  const failed: string[] = [];

  for (const chip of requirementChips) {
    if (chip.type === "location") continue;

    if (chip.type === "experience") {
      const requiredYears = parseYearsRequirement(chip.label);
      if (requiredYears !== null && resume.yearsExperience < requiredYears) {
        failed.push(chip.label);
      }
      continue;
    }

 
    if (!hasSkillEvidence(chip.label, resume, github)) {
      failed.push(chip.label);
    }
  }

  return { pass: failed.length === 0, failedRequirements: failed };
}
