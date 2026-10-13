import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { requireAuth, requireRole } from "../../../lib/api/auth";
import { buildPositionsSummary } from "../../../lib/api/overview";
import { loadPositionDetail } from "../../../lib/api/position-detail";
import { createPositionSchema, normalizeRequirementChips } from "../../../lib/api/validation";
import { logAuditEvent } from "../../../lib/api/audit";
import { badRequest, errorResponse } from "../../../lib/api/errors";

/** GET /api/positions -> { positions } for the signed-in user's organization (with applyUrl, stats and funnel). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const { positions } = await buildPositionsSummary(session.organizationId, req.nextUrl.origin);
    return NextResponse.json({ positions });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/positions (Owner / Admin) -> 201 { position }. `status` is optional and defaults to OPEN. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const body = await req.json().catch(() => null);
    const parsed = createPositionSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid position data");
    const d = parsed.data;

    const created = await prisma.position.create({
      data: {
        organizationId: session.organizationId,
        title: d.title,
        location: d.location,
        employmentType: d.employmentType,
        description: d.description,
        requirementChips: normalizeRequirementChips(d.requirementChips),
        endDate: new Date(d.endDate),
        salary: d.salary,
        gender: d.gender,
        vacancies: d.vacancies,
        education: d.education,
        experience: d.experience,
        ...(d.status ? { status: d.status } : {}),
      },
    });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "position.created",
      targetType: "Position",
      targetId: created.id,
      metadata: { title: created.title },
    });

    const position = await loadPositionDetail(created.id, req.nextUrl.origin);
    return NextResponse.json({ position }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
