
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

// Score dimensions, redesigned:
// - reqMatch: graded (0-100) version of the gate check below — % of
//   requirement chips satisfied (skills, experience-years, location), rather
//   than the gate's hard pass/fail. Replaces the old "experience" dimension
//   and absorbs the skill-relevance portion that used to live in "technical".
// - codeQuality: repo complexity + test coverage only — the part of the old
//   "technical" score that wasn't really about matching the JD.
// - consistency / collaboration: unchanged from before.
export type ScoreResult = {
  meetsRequirements: boolean; // still a hard gate, independent of the graded reqMatch score
  matchPct: number;
  reqMatch: number;
  consistency: number;
  collaboration: number;
  codeQuality: number;
  evidenceMatrix: EvidenceRow[];
};

// Equal-weighted: each dimension represents a distinct, comparably-important
// axis of evidence (what you claim to have, how consistently you work, how
// you work with others, how well you actually write code) rather than one
// dimension dominating the overall number.
export const DEFAULT_WEIGHTS = {
  reqMatch: 0.25,
  consistency: 0.25,
  collaboration: 0.25,
  codeQuality: 0.25,
} as const;
