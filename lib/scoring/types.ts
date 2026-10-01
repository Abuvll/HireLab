
export type RequirementChip = {
  label: string; 
  type: "skill" | "experience" | "location";
};

export type ExperienceEntry = {
  title: string;
  company: string;
  startDate: string; // free-text as extracted (e.g. "Jan 2020"), not strict YYYY-MM
  endDate: string;
  stack: string[];
  achievements: string[];
};

export type EducationData = {
  school: string;
  field: string | null;
  gpa: number | null;
  gradYear: number | null;
};

export type ResumeExtractData = {
  education: EducationData | null;
  yearsExperience: number;
  topSkills: string[];
  experience: ExperienceEntry[];
};

export type LanguageUsage = {
  name: string;
  pct: number;
};

export type RepoInfo = {
  name: string;
  url: string;
  lang: string;
  original: boolean; 
  complexity: number; 
  testCoverage: number; 
  stars: number;
  commits: number;
  lastActiveAt: string; 
};

export type GithubAnalysisData = {
  username: string | null;
  followers: number;
  totalStars: number;
  accountAgeYears: number;
  repoCount: number;
  commitsPastYear: number;
  activeWeeks: number; 
  testRatio: number | null; 
  languages: LanguageUsage[];
  repos: RepoInfo[];
  tooling: Record<string, boolean>; 
  shippedProjects: { name: string; url: string; description: string | null }[];
  externalContributions: number; 
  notableMerges: { repo: string; stars: string; desc: string }[];
};

export type EvidenceRow = {
  requirement: string;
  met: boolean;
  evidence: string;
};

export type ScoreResult = {
  meetsRequirements: boolean; // still a hard gate, independent of the graded reqMatch score
  matchPct: number;
  reqMatch: number;
  consistency: number;
  collaboration: number;
  codeQuality: number;
  evidenceMatrix: EvidenceRow[];
};

export const DEFAULT_WEIGHTS = {
  reqMatch: 0.25,
  consistency: 0.25,
  collaboration: 0.25,
  codeQuality: 0.25,
} as const;
