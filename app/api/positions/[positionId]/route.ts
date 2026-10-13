import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requirePositionAccess } from "../../../../lib/api/position-access";
import { loadPositionDetail } from "../../../../lib/api/position-detail";
import { updatePositionSchema, normalizeRequirementChips } from "../../../../lib/api/validation";
import { logAuditEvent } from "../../../../lib/api/audit";
import { badRequest, forbidden, notFound, errorResponse } from "../../../../lib/api/errors";

/** GET /api/positions/:id -> { position } (with applyUrl, stats, funnel and the position's team). */
export async function GET(req: NextRequest, { params }: { params: { positionId: string } }) {
  try {
    await requirePositionAccess(req, params.positionId);
    const position = await loadPositionDetail(params.positionId, req.nextUrl.origin);
    if (!position) throw notFound("Position not found");
    return NextResponse.json({ position });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH /api/positions/:id (Owner / Admin) -> { position }. Only the fields that are sent are changed. */
export async function PATCH(req: NextRequest, { params }: { params: { positionId: string } }) {
  try {
    const { session } = await requirePositionAccess(req, params.positionId);
    if (!["OWNER", "ADMIN"].includes(session.orgRole)) {
      throw forbidden("Only Owners and Admins can edit a position");
    }

    const body = await req.json().catch(() => null);
    const parsed = updatePositionSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid position data");
    const d = parsed.data;

    // A position created before the deadline became mandatory has no endDate. It keeps loading, but the next edit has to
    // give it one (the same rule the form enforces).
    if (d.endDate === undefined) {
      const current = await prisma.position.findUnique({ where: { id: params.positionId }, select: { endDate: true } });
      if (current && !current.endDate) throw badRequest("Please choose a deadline.");
    }

    // Only the fields that were sent are written. (zod's .partial() leaves an omitted field undefined; the optional
    // detail fields turn "" / "None" into null, which clears them.)
    await prisma.position.update({
      where: { id: params.positionId },
      data: {
        ...(d.title !== undefined && { title: d.title }),
        ...(d.location !== undefined && { location: d.location }),
        ...(d.employmentType !== undefined && { employmentType: d.employmentType }),
        ...(d.description !== undefined && { description: d.description }),
        ...(d.requirementChips !== undefined && { requirementChips: normalizeRequirementChips(d.requirementChips) }),
        ...(d.endDate !== undefined && { endDate: new Date(d.endDate) }),
        ...(d.salary !== undefined && { salary: d.salary }),
        ...(d.gender !== undefined && { gender: d.gender }),
        ...(d.vacancies !== undefined && { vacancies: d.vacancies }),
        ...(d.education !== undefined && { education: d.education }),
        ...(d.experience !== undefined && { experience: d.experience }),
        ...(d.status !== undefined && { status: d.status }),
      },
    });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "position.updated",
      targetType: "Position",
      targetId: params.positionId,
      metadata: { fields: Object.keys(d) },
    });

    const position = await loadPositionDetail(params.positionId, req.nextUrl.origin);
    return NextResponse.json({ position });
  } catch (err) {
    return errorResponse(err);
  }
}
