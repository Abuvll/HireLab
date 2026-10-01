import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requirePositionAccess } from "../../../../../lib/api/position-access";
import { rankedListQuerySchema } from "../../../../../lib/api/validation";
import { buildRankedListWithMatches, collectTechOptions, type RankableCandidate } from "../../../../../lib/api/ranked-list";
import { badRequest, errorResponse } from "../../../../../lib/api/errors";
import { deriveApplicationStatus } from "../../../../../lib/domain-enums";
import type { GithubAnalysisData } from "../../../../../lib/scoring/types";


export async function GET(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  try {
    await requirePositionAccess(req, params.positionId);

    const queryParams = Object.fromEntries(req.nextUrl.searchParams);
    const parsedQuery = rankedListQuerySchema.safeParse(queryParams);
    if (!parsedQuery.success) {
      throw badRequest(parsedQuery.error.issues[0]?.message ?? "Invalid filter parameters");
    }

    const applications = await prisma.application.findMany({
      where: { positionId: params.positionId, status: "READY" },
      include: { score: true, githubAnalysis: true, resumeExtract: true },
    });

    type ApplicationRow = {
      id: string;
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

    const rows = applications as ApplicationRow[];
    const rowById = new Map(rows.map((r) => [r.id, r]));

    const candidates: RankableCandidate[] = rows
      .filter((a) => a.score && a.githubAnalysis)
      .map((a) => {
        const github = a.githubAnalysis as unknown as GithubAnalysisData;
        const topSkills = (a.resumeExtract?.topSkills as string[] | undefined) ?? [];
        return {
          applicationId: a.id,
          name: a.fullName,
          meetsRequirements: a.score!.meetsRequirements,
          matchPct: a.score!.matchPct,
          scores: {
            reqMatch: a.score!.reqMatch,
            consistency: a.score!.consistency,
            collaboration: a.score!.collaboration,
            codeQuality: a.score!.codeQuality,
          },
          languages: github.languages.map((l) => l.name),
          languageBreakdown: github.languages.slice(0, 3),
          topSkills: topSkills.slice(0, 3),
          skills: topSkills,
          tooling: github.tooling,
          hasShippedProject: github.shippedProjects.length > 0,
        };
      });

    const { limit, tech, minConsistency, minCollaboration, shippedOnly } = parsedQuery.data;
    const ranked = buildRankedListWithMatches(candidates, {
      topN: limit,
      techStack: tech,
      minConsistency,
      minCollaboration,
      shippedOnly,
    });

    const candidateById = new Map(candidates.map((c) => [c.applicationId, c]));

    const responseApplications = ranked.entries.map((entry) => {
      const row = rowById.get(entry.applicationId)!;
      return {
        id: entry.applicationId,
        fullName: entry.name,
        email: row.email ?? "",
        createdAt: row.createdAt,
        score: {
          overall: entry.matchPct,
          reqMatch: entry.scores.reqMatch,
          consistency: entry.scores.consistency,
          collaboration: entry.scores.collaboration,
          codeQuality: entry.scores.codeQuality,
        },
        topSkills: entry.topSkills,
        standoutLine: entry.standout,
        hasShippedProject: candidateById.get(entry.applicationId)?.hasShippedProject ?? false,
        matchesFilters: entry.matchesFilters,
        status: deriveApplicationStatus(row.status, row.score?.meetsRequirements),
      };
    });

    return NextResponse.json({
      total: applications.length,
      qualified: candidates.filter((c) => c.meetsRequirements).length,
      matched: ranked.matchedCount,
      techOptions: collectTechOptions(candidates),
      applications: responseApplications,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
