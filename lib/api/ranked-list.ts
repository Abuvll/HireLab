import type { SubScores } from "../scoring/subscores";
import { computePercentiles, type RankableApplication, type PercentileBreakdown } from "../scoring/rank";

export type FilterCriteria = {
 
  techStack?: string[];
  minConsistency?: number; 
  minCollaboration?: number; 
  shippedOnly?: boolean;
  topN?: number | "all";
};

export type LanguageBreakdownEntry = { name: string; pct: number };

export type RankableCandidate = {
  applicationId: string;
  name: string;
  meetsRequirements: boolean;
  matchPct: number;
  scores: SubScores;
  languages: string[]; 
  languageBreakdown: LanguageBreakdownEntry[]; 
  topSkills: string[]; 

  // few shown on a row). Used for the tech-stack filter and its options so
  // filtering sees the same skills the gate does (see hasSkillEvidence in
  // scoring/gate.ts). Falls back to topSkills when omitted.
  skills?: string[];
  tooling: Record<string, boolean>;
  hasShippedProject: boolean;
};

export type RankedListEntry = {
  applicationId: string;
  name: string;
  initials: string;
  matchPct: number;
  scores: SubScores;
  percentiles: Omit<PercentileBreakdown, "applicationId">;
  languageBreakdown: LanguageBreakdownEntry[];
  topSkills: string[];
  standout: string;
};


export function computeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const STANDOUT_PHRASES: Record<keyof SubScores, string> = {
  codeQuality: "Strongest code quality signal in this pool",
  consistency: "Most consistent contributor in this pool",
  collaboration: "Highest collaboration score in this pool",
  reqMatch: "Deepest requirement match in this pool",
};

export function computeStandout(percentiles: Omit<PercentileBreakdown, "applicationId">): string {
  if (percentiles.overall === 100) return "Top overall match in this pool";

  const dimensions: (keyof SubScores)[] = ["reqMatch", "consistency", "collaboration", "codeQuality"];
  const best = dimensions.reduce((a, b) => (percentiles[b] > percentiles[a] ? b : a));
  return STANDOUT_PHRASES[best];
}

// languages, tooling detected in their repos, and skills from their resume.
// The tech-stack filter matches against this whole set — the options offered
// in the UI (collectTechOptions) are drawn from the same three sources, so a
// pill is never a choice that can't match.
function techSet(candidate: RankableCandidate): Set<string> {
  const set = new Set<string>();
  for (const l of candidate.languages) set.add(l.toLowerCase());
  for (const [key, enabled] of Object.entries(candidate.tooling)) if (enabled) set.add(key.toLowerCase());
  for (const s of candidate.skills ?? candidate.topSkills) set.add(s.toLowerCase());
  return set;
}

function passesFilters(candidate: RankableCandidate, filters: FilterCriteria): boolean {
  if (filters.techStack && filters.techStack.length > 0) {
    const known = techSet(candidate);
    if (!filters.techStack.every((tech) => known.has(tech.toLowerCase()))) return false;
  }

  if (filters.minConsistency !== undefined && candidate.scores.consistency < filters.minConsistency) {
    return false;
  }

  if (filters.minCollaboration !== undefined && candidate.scores.collaboration < filters.minCollaboration) {
    return false;
  }

  if (filters.shippedOnly && !candidate.hasShippedProject) {
    return false;
  }

  return true;
}

function byBestMatch(a: RankableCandidate, b: RankableCandidate): number {
  return b.matchPct - a.matchPct || a.name.localeCompare(b.name) || a.applicationId.localeCompare(b.applicationId);
}

function applyTopN<T>(list: T[], topN: FilterCriteria["topN"]): T[] {
  return topN === undefined || topN === "all" ? list : list.slice(0, topN);
}

function toEntries(
  candidates: RankableCandidate[],
  percentileByApplicationId: Map<string, PercentileBreakdown>
): RankedListEntry[] {
  return candidates.map((c) => {
    const p = percentileByApplicationId.get(c.applicationId)!;
    const percentiles = {
      overall: p.overall,
      reqMatch: p.reqMatch,
      consistency: p.consistency,
      collaboration: p.collaboration,
      codeQuality: p.codeQuality,
    };
    return {
      applicationId: c.applicationId,
      name: c.name,
      initials: computeInitials(c.name),
      matchPct: c.matchPct,
      scores: c.scores,
      percentiles,
      languageBreakdown: c.languageBreakdown,
      topSkills: c.topSkills,
      standout: computeStandout(percentiles),
    };
  });
}

function rankQualified(candidates: RankableCandidate[], filters: FilterCriteria) {
  const qualified = candidates.filter((c) => c.meetsRequirements);
  const rankable: RankableApplication[] = qualified.map((c) => ({
    applicationId: c.applicationId,
    meetsRequirements: true,
    matchPct: c.matchPct,
    scores: c.scores,
  }));
  const percentileByApplicationId = new Map(computePercentiles(rankable).map((p) => [p.applicationId, p]));
  const matches = qualified.filter((c) => passesFilters(c, filters)).sort(byBestMatch);
  const rest = qualified.filter((c) => !passesFilters(c, filters)).sort(byBestMatch);
  return { matches, rest, percentileByApplicationId };
}

// Only the candidates that satisfy every filter, best match first.
export function buildRankedList(
  candidates: RankableCandidate[],
  filters: FilterCriteria = {}
): RankedListEntry[] {
  const { matches, percentileByApplicationId } = rankQualified(candidates, filters);
  return toEntries(applyTopN(matches, filters.topN), percentileByApplicationId);
}

export type RankedListEntryWithMatch = RankedListEntry & { matchesFilters: boolean };

export function buildRankedListWithMatches(
  candidates: RankableCandidate[],
  filters: FilterCriteria = {}
): { entries: RankedListEntryWithMatch[]; matchedCount: number } {
  const { matches, rest, percentileByApplicationId } = rankQualified(candidates, filters);
  const matchIds = new Set(matches.map((c) => c.applicationId));
  const entries = toEntries(applyTopN([...matches, ...rest], filters.topN), percentileByApplicationId).map((e) => ({
    ...e,
    matchesFilters: matchIds.has(e.applicationId),
  }));
  return { entries, matchedCount: matches.length };
}

export function collectTechOptions(candidates: RankableCandidate[], max = 16): string[] {
  const tally = new Map<string, { label: string; count: number }>();
  for (const c of candidates) {
    if (!c.meetsRequirements) continue;
    const labels = new Map<string, string>();
    for (const l of c.languages) labels.set(l.toLowerCase(), l);
    for (const [key, enabled] of Object.entries(c.tooling)) if (enabled) labels.set(key.toLowerCase(), key);
    for (const s of c.skills ?? c.topSkills) labels.set(s.toLowerCase(), s);
    for (const [lower, label] of labels) {
      const existing = tally.get(lower);
      if (existing) existing.count += 1;
      else tally.set(lower, { label, count: 1 });
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max)
    .map((t) => t.label);
}
