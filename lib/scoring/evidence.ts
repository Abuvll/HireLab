import type {
  RequirementChip,
  ResumeExtractData,
  GithubAnalysisData,
  EvidenceRow,
} from "./types";
import { parseYearsRequirement } from "./gate";

export function buildEvidenceMatrix(
  requirementChips: RequirementChip[],
  resume: ResumeExtractData,
  github: GithubAnalysisData
): EvidenceRow[] {
  return requirementChips.map((chip) => evaluateRequirement(chip, resume, github));
}

function evaluateRequirement(
  chip: RequirementChip,
  resume: ResumeExtractData,
  github: GithubAnalysisData
): EvidenceRow {
  const label = chip.label;
  const lower = label.toLowerCase();

  if (chip.type === "location") {
    return {
      requirement: label,
      met: true,
      evidence: "No location constraint indicated in the application",
    };
  }

  if (chip.type === "experience") {
    const requiredYears = parseYearsRequirement(label);
    if (requiredYears === null) {
      return { requirement: label, met: true, evidence: "Not a parseable years requirement" };
    }
    const met = resume.yearsExperience >= requiredYears;
    return {
      requirement: label,
      met,
      evidence: met
        ? `Resume indicates ${resume.yearsExperience} years — meets the ${requiredYears}+ year requirement`
        : `Resume indicates ${resume.yearsExperience} years — below the ${requiredYears}+ year requirement`,
    };
  }

 
  const langMatch = github.languages.find((l) => l.name.toLowerCase() === lower);
  if (langMatch) {
    const topRepo = github.repos
      .filter((r) => r.lang.toLowerCase() === lower && r.original)
      .sort((a, b) => b.complexity - a.complexity)[0];
    const repoNote = topRepo ? ` — prominent in ${topRepo.name}` : "";
    return {
      requirement: label,
      met: true,
      evidence: `${langMatch.pct}% of GitHub code${repoNote}`,
    };
  }

  const toolKey = Object.keys(github.tooling).find((k) => k.toLowerCase() === lower);
  if (toolKey && github.tooling[toolKey]) {
    const configRepo = github.repos.find((r) => r.original);
    const repoNote = configRepo ? ` — ${configRepo.name}` : "";
    return {
      requirement: label,
      met: true,
      evidence: `Detected in deployment/config files${repoNote}`,
    };
  }

  const skillMatch = resume.topSkills.find((s) => s.toLowerCase() === lower);
  if (skillMatch) {
    return {
      requirement: label,
      met: true,
      evidence: "Listed on resume; not independently verified on GitHub",
    };
  }

  return {
    requirement: label,
    met: false,
    evidence: "No supporting evidence found in GitHub or resume",
  };
}
