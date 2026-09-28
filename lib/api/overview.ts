import { prisma } from "../db";
import { buildApplyUrl } from "./urls";
import { buildRankedList, type RankableCandidate } from "./ranked-list";
import { deriveApplicationStatus } from "../domain-enums";
import type { GithubAnalysisData } from "../scoring/types";

type ApplicationRow = {
  id: string;
  positionId: string;
  fullName: string;
  email: string | null;
  createdAt: Date;
  status: "PROCESSING" | "READY" | "FAILED";
  score: {
    meetsRequirements: boolean;
    matchPct: number;
    reqMatch: number;
    consistency: number;
    collaboration: number;
    codeQuality: number;
  } | null;
  githubAnalysis: unknown | null;
  resumeExtract: { topSkills: unknown } | null;
};

function hasShippedProject(githubAnalysis: unknown | null): boolean {
  const shipped = (githubAnalysis as GithubAnalysisData | null)?.shippedProjects;
  return Array.isArray(shipped) && shipped.length > 0;
}

type PositionRow = { id: string; [key: string]: unknown };

function computePositionsWithStats(positionRows: PositionRow[], rows: ApplicationRow[], requestOrigin: string) {
  return positionRows.map((p) => {
    const rowsForPosition = rows.filter((r) => r.positionId === p.id);
    const qualifiedRows = rowsForPosition.filter((r) => r.score?.meetsRequirements);
    const qualifiedCount = qualifiedRows.length;
    const avgMatch =
      qualifiedCount === 0
        ? 0
        : Math.round(qualifiedRows.reduce((sum, r) => sum + (r.score?.matchPct ?? 0), 0) / qualifiedCount);
    const shippedCount = qualifiedRows.filter((r) => hasShippedProject(r.githubAnalysis)).length;

    return {
      ...p,
      applyUrl: buildApplyUrl(p.id, requestOrigin),
      stats: {
        applicantCount: rowsForPosition.length,
        avgMatch,
        qualifiedCount,
        shippedCount,
      },
      funnel: {
        applied: rowsForPosition.length,
        processing: rowsForPosition.filter((r) => r.status === "PROCESSING").length,
        ready: rowsForPosition.filter((r) => r.status === "READY").length,
        qualified: qualifiedCount,
      },
    };
  });
}


export async function buildPositionsSummary(organizationId: string, requestOrigin: string) {
  const positions = await prisma.position.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  const positionRows = positions as PositionRow[];
  const positionIds = positionRows.map((p) => p.id);

  const applications = await prisma.application.findMany({
    where: { positionId: { in: positionIds } },
    select: {
      id: true,
      positionId: true,
      status: true,
      score: { select: { meetsRequirements: true, matchPct: true } },
      githubAnalysis: { select: { shippedProjects: true } },
    },
  });
  const rows = applications as unknown as ApplicationRow[];

  return { positionRows, rows, positions: computePositionsWithStats(positionRows, rows, requestOrigin) };
}


export async function buildOverviewData(organizationId: string, requestOrigin: string) {
  const positions = await prisma.position.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });

  const positionRows = positions as PositionRow[];
  const positionIds = positionRows.map((p) => p.id);

  const applications = await prisma.application.findMany({
    where: { positionId: { in: positionIds } },
    include: { score: true, githubAnalysis: true, resumeExtract: true },
  });
  const rows = applications as ApplicationRow[];

  const applicationsByPosition: Record<string, unknown[]> = {};

  for (const positionId of positionIds) {
    const rowsForPosition = rows.filter((r) => r.positionId === positionId);

    const rankableCandidates: RankableCandidate[] = rowsForPosition
      .filter((r) => r.score?.meetsRequirements && r.githubAnalysis)
      .map((r) => {
        const github = r.githubAnalysis as unknown as GithubAnalysisData;
        const topSkills = (r.resumeExtract?.topSkills as string[] | undefined) ?? [];
        return {
          applicationId: r.id,
          name: r.fullName,
          meetsRequirements: true,
          matchPct: r.score!.matchPct,
          scores: {
            reqMatch: r.score!.reqMatch,
            consistency: r.score!.consistency,
            collaboration: r.score!.collaboration,
            codeQuality: r.score!.codeQuality,
          },
          languages: github.languages.map((l) => l.name),
          languageBreakdown: github.languages.slice(0, 3),
          topSkills: topSkills.slice(0, 3),
          tooling: github.tooling,
          hasShippedProject: github.shippedProjects.length > 0,
        };
      });

    const standoutByApplicationId = new Map(
      buildRankedList(rankableCandidates, { topN: "all" }).map((e) => [e.applicationId, e.standout])
    );

    applicationsByPosition[positionId] = rowsForPosition.map((r) => {
      const topSkills = (r.resumeExtract?.topSkills as string[] | undefined) ?? [];
      return {
        id: r.id,
        fullName: r.fullName,
        email: r.email ?? "",
        createdAt: r.createdAt,
        score: r.score
          ? {
              overall: r.score.matchPct,
              reqMatch: r.score.reqMatch,
              consistency: r.score.consistency,
              collaboration: r.score.collaboration,
              codeQuality: r.score.codeQuality,
            }
          : null,
        topSkills: topSkills.slice(0, 4),
        standoutLine: standoutByApplicationId.get(r.id) ?? "",
        hasShippedProject: hasShippedProject(r.githubAnalysis),
        status: deriveApplicationStatus(r.status, r.score?.meetsRequirements),
      };
    });
  }

  const positionsOut = computePositionsWithStats(positionRows, rows, requestOrigin);

  return { positions: positionsOut, applications: applicationsByPosition };
}
