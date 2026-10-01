import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { requirePositionAccess } from "../../../lib/api/position-access";
import { teamInviteSchema } from "../../../lib/api/validation";
import { badRequest, forbidden, errorResponse } from "../../../lib/api/errors";



export async function GET(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  try {
    await requirePositionAccess(req, params.positionId);
    const team = await prisma.positionTeam.findMany({
      where: { positionId: params.positionId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return NextResponse.json({ team });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  try {
    const { session } = await requirePositionAccess(req, params.positionId);
    if (!["OWNER", "ADMIN"].includes(session.orgRole)) {
      throw forbidden("Only an Owner or Admin can add team members");
    }

    const body = await req.json().catch(() => null);
    const parsed = teamInviteSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid invite data");

    // Privilege escalation: an Admin can't hand out Owner (same rule as
    // POST /api/team/invite).
    if (parsed.data.role === "OWNER" && session.orgRole !== "OWNER") {
      throw forbidden("Only an Owner can assign the Owner role");
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || user.organizationId !== session.organizationId) {
      throw badRequest(
        "No one in your organization has that email yet — invite them from Settings \u2192 Team first, then add them to this position."
      );
    }

    const membership = await prisma.positionTeam.upsert({
      where: { positionId_userId: { positionId: params.positionId, userId: user.id } },
      create: { positionId: params.positionId, userId: user.id, role: parsed.data.role },
      update: { role: parsed.data.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return NextResponse.json({ membership }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
