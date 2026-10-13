import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requireApplicationAccess } from "../../../../../lib/api/application-access";
import { setStageSchema } from "../../../../../lib/api/validation";
import { computeStageUpdate } from "../../../../../lib/api/stage";
import { logAuditEvent } from "../../../../../lib/api/audit";
import { badRequest, forbidden, notFound, errorResponse } from "../../../../../lib/api/errors";

/**
 * PATCH /api/applications/:id/stage  { stage: "SHORTLISTED" | "INTERVIEW" | "HIRED" | null, hiredAt? }
 *   -> { id, stage, hiredAt }
 *
 * `null` takes the candidate out of the pipeline. Viewers can't change stages. Only an analysed (READY) application can be
 * staged, since the pipeline lists candidates with a match score. The response carries the server's own `hiredAt`
 * (stamped here, see lib/api/stage.ts); the dashboard shows that value, not the one it sent.
 */
export async function PATCH(req: NextRequest, { params }: { params: { applicationId: string } }) {
  try {
    const { session } = await requireApplicationAccess(req, params.applicationId);
    if (session.orgRole === "VIEWER") throw forbidden("Viewers can't change a candidate's stage");

    const body = await req.json().catch(() => null);
    const parsed = setStageSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid stage");

    const current = await prisma.application.findUnique({
      where: { id: params.applicationId },
      select: { id: true, status: true, stage: true, hiredAt: true },
    });
    if (!current) throw notFound("Application not found");
    if (current.status !== "READY" && parsed.data.stage !== null) {
      throw badRequest("This application hasn't finished analysis yet, so it can't be moved to a stage.");
    }

    const next = computeStageUpdate({ stage: current.stage, hiredAt: current.hiredAt }, parsed.data.stage, new Date());
    const updated = await prisma.application.update({
      where: { id: params.applicationId },
      data: { stage: next.stage, hiredAt: next.hiredAt },
      select: { id: true, stage: true, hiredAt: true },
    });

    if (current.stage !== updated.stage) {
      await logAuditEvent({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "candidate.stage_changed",
        targetType: "Application",
        targetId: updated.id,
        metadata: { from: current.stage, to: updated.stage },
      });
    }

    return NextResponse.json({ id: updated.id, stage: updated.stage, hiredAt: updated.hiredAt });
  } catch (err) {
    return errorResponse(err);
  }
}
