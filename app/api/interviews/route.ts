import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { requireAuth } from "../../../lib/api/auth";
import { createInterviewSchema } from "../../../lib/api/validation";
import { INTERVIEW_INCLUDE, serializeInterview } from "../../../lib/api/interviews";
import { logAuditEvent } from "../../../lib/api/audit";
import { badRequest, forbidden, notFound, errorResponse } from "../../../lib/api/errors";

/** GET /api/interviews -> { interviews } : every interview in the organization, soonest first. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const rows = await prisma.interview.findMany({
      where: { application: { position: { organizationId: session.organizationId } } },
      include: INTERVIEW_INCLUDE,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ interviews: rows.map((r) => serializeInterview(r as never)) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/interviews  { candidateId, type, startTime, endTime, interviewerName? } -> 201, the interview itself.
 * `candidateId` is an application id. Viewers can't schedule. The candidate must belong to the caller's organization and
 * have finished analysis.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    if (session.orgRole === "VIEWER") throw forbidden("Viewers can't schedule interviews");

    const body = await req.json().catch(() => null);
    const parsed = createInterviewSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid interview");
    const d = parsed.data;

    const application = await prisma.application.findUnique({
      where: { id: d.candidateId },
      select: { id: true, status: true, position: { select: { organizationId: true } } },
    });
    if (!application || application.position.organizationId !== session.organizationId) {
      throw notFound("Candidate not found");
    }
    if (application.status !== "READY") {
      throw badRequest("This candidate's application hasn't finished analysis yet.");
    }

    const created = await prisma.interview.create({
      data: {
        applicationId: application.id,
        type: d.type,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
        interviewerName: d.interviewerName,
        createdByUserId: session.userId,
      },
      include: INTERVIEW_INCLUDE,
    });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "interview.scheduled",
      targetType: "Interview",
      targetId: created.id,
      metadata: { applicationId: application.id, type: d.type },
    });

    return NextResponse.json(serializeInterview(created as never), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
