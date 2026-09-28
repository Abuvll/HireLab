import type { SubScores } from "./subscores";

export type RankableApplication = {
  applicationId: string;
  meetsRequirements: boolean;
  matchPct: number;
  scores: SubScores;
};

export function percentileRank(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 100;
  const countAtOrBelow = allValues.filter((v) => v <= value).length;
  return Math.round((100 * (countAtOrBelow - 1)) / (allValues.length - 1));
}

export type PercentileBreakdown = {
  applicationId: string;
  overall: number;
  reqMatch: number;
  consistency: number;
  collaboration: number;
  codeQuality: number;
};

export function computePercentiles(
  applications: RankableApplication[]
): PercentileBreakdown[] {
  const qualified = applications.filter((a) => a.meetsRequirements);

  const matchPcts = qualified.map((a) => a.matchPct);
  const reqMatches = qualified.map((a) => a.scores.reqMatch);
  const consistencies = qualified.map((a) => a.scores.consistency);
  const collaborations = qualified.map((a) => a.scores.collaboration);
  const codeQualities = qualified.map((a) => a.scores.codeQuality);

  return qualified.map((a) => ({
    applicationId: a.applicationId,
    overall: percentileRank(a.matchPct, matchPcts),
    reqMatch: percentileRank(a.scores.reqMatch, reqMatches),
    consistency: percentileRank(a.scores.consistency, consistencies),
    collaboration: percentileRank(a.scores.collaboration, collaborations),
    codeQuality: percentileRank(a.scores.codeQuality, codeQualities),
  }));
}

export function rankTopN(
  applications: RankableApplication[],
  topN: number | "all" = 10
): RankableApplication[] {
  const qualified = applications
    .filter((a) => a.meetsRequirements)
    .sort((a, b) => b.matchPct - a.matchPct);

  return topN === "all" ? qualified : qualified.slice(0, topN);
}
