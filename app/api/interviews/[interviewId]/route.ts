import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { updateInterviewSchema } from "../../../../lib/api/validation";
import { INTERVIEW_INCLUDE, interviewChangeProblem, serializeInterview } from "../../../../lib/api/interviews";
import { logAuditEvent } from "../../../../lib/api/audit";
import { badRequest, forbidden, notFound, errorResponse } from "../../../../lib/api/errors";

/**
 * PATCH /api/interviews/:id -> the updated interview. Reschedule ({ startTime, endTime, interviewerName? }), complete or
 * cancel ({ status }), or re-type ({ type }). Only a SCHEDULED interview can change; completed / canceled ones are history.
 */
export async function PATCH(req: NextRequest, { params }: { params: { interviewId: string } }) {
  try {
    const session = await requireAuth(req);
    if (session.orgRole === "VIEWER") throw forbidden("Viewers can't change interviews");

    const body = await req.json().catch(() => null);
    const parsed = updateInterviewSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid interview update");
    const d = parsed.data;

    const existing = await prisma.interview.findUnique({
      where: { id: params.interviewId },
      include: { application: { select: { position: { select: { organizationId: true } } } } },
    });
    if (!existing || existing.application.position.organizationId !== session.organizationId) {
      throw notFound("Interview not found");
    }

    const problem = interviewChangeProblem(existing.status);
    if (problem) throw badRequest(problem);

    const updated = await prisma.interview.update({
      where: { id: params.interviewId },
      data: {
        ...(d.type !== undefined && { type: d.type }),
        ...(d.status !== undefined && { status: d.status }),
        ...(d.startTime !== undefined && { startTime: new Date(d.startTime) }),
        ...(d.endTime !== undefined && { endTime: new Date(d.endTime) }),
        ...(d.interviewerName !== undefined && { interviewerName: d.interviewerName }),
      },
      include: INTERVIEW_INCLUDE,
    });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: d.status ? `interview.${d.status.toLowerCase()}` : "interview.updated",
      targetType: "Interview",
      targetId: updated.id,
    });

    return NextResponse.json(serializeInterview(updated as never));
  } catch (err) {
    return errorResponse(err);
  }
}
