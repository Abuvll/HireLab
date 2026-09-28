import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireApplicationAccess } from "../../../../lib/api/application-access";
import { buildCandidateDetail } from "../../../../lib/api/candidate-detail";
import { notFound, errorResponse } from "../../../../lib/api/errors";
import { assertOrgApiKeyUsable } from "../../../../lib/api/api-key-error";
import type { ResumeExtractData, GithubAnalysisData, ScoreResult } from "../../../../lib/scoring/types";
import type { RankableApplication } from "../../../../lib/scoring/rank";


export async function GET(
  req: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  try {
    const { session, positionId } = await requireApplicationAccess(req, params.applicationId);

    const application = await prisma.application.findUnique({
      where: { id: params.applicationId },
      include: { resumeExtract: true, githubAnalysis: true, score: true },
    });

    // Analysis that FAILED often failed because of the org's AI key (missing,
    // revoked, out of credit — see lib/jobs/analyze-application.ts). The
    // failure reason isn't otherwise shown anywhere, so check the key now:
    // if it's the culprit, say so (API_KEY_ERROR -> the dashboard's
    // "Update API Keys" pop-up) rather than a bare "hasn't finished
    // analysis". If the key is fine the generic message below still applies.
    if (application?.status === "FAILED") {
      await assertOrgApiKeyUsable(session.organizationId, {
        canManage: session.orgRole === "OWNER" || session.orgRole === "ADMIN",
      });
    }

    if (!application || !application.resumeExtract || !application.githubAnalysis || !application.score) {
      throw notFound("This application hasn't finished analysis yet");
    }

    const poolApplications = await prisma.application.findMany({
      where: { positionId, status: "READY", score: { meetsRequirements: true } },
      include: { score: true },
    });

    type PoolApplicationRow = {
      id: string;
      score: {
        meetsRequirements: boolean;
        matchPct: number;
        reqMatch: number;
        consistency: number;
        collaboration: number;
        codeQuality: number;
      } | null;
    };

    const poolScores: RankableApplication[] = (poolApplications as PoolApplicationRow[])
      .filter((a) => a.score)
      .map((a) => ({
        applicationId: a.id,
        meetsRequirements: a.score!.meetsRequirements,
        matchPct: a.score!.matchPct,
        scores: {
          reqMatch: a.score!.reqMatch,
          consistency: a.score!.consistency,
          collaboration: a.score!.collaboration,
          codeQuality: a.score!.codeQuality,
        },
      }));

    const detail = buildCandidateDetail(
      {
        id: application.id,
        fullName: application.fullName,
        contactMethod: application.contactMethod,
        email: application.email,
        phone: application.phone,
        createdAt: application.createdAt,
        status: application.status,
        resumeUrl: application.resumeUrl,
        portfolioUrl: application.personalSiteUrl,
      },
      application.resumeExtract as unknown as ResumeExtractData,
      application.githubAnalysis as unknown as GithubAnalysisData,
      application.score as unknown as ScoreResult,
      poolScores
    );

    return NextResponse.json(detail);
  } catch (err) {
    return errorResponse(err);
  }
}
