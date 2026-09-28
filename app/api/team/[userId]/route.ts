import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireRole } from "../../../../lib/api/auth";
import { badRequest, forbidden, notFound, errorResponse } from "../../../../lib/api/errors";
import { logAuditEvent } from "../../../../lib/api/audit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const target = await prisma.user.findUnique({ where: { id: params.userId } });
    if (!target || target.organizationId !== session.organizationId) {
      throw notFound("Team member not found");
    }

    // Same rule as inviting: an Admin can't act on an Owner. Only an
    // Owner can remove another Owner.
    if (target.orgRole === "OWNER" && session.orgRole !== "OWNER") {
      throw forbidden("Only an Owner can remove another Owner");
    }

    if (target.orgRole === "OWNER") {
      const ownerCount = await prisma.user.count({
        where: { organizationId: session.organizationId, orgRole: "OWNER" },
      });
      if (ownerCount <= 1) {
        throw badRequest("Can't remove the last remaining Owner — promote someone else first");
      }
    }

    // Removing from the org roster also removes every per-position
    // assignment (PositionTeam rows reference User, cascading delete —
    // see schema.prisma), since a person who's no longer in the org
    // shouldn't retain access to any individual position either.
    await prisma.user.delete({ where: { id: params.userId } });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "team.member_removed",
      targetType: "User",
      targetId: params.userId,
      metadata: { removedEmail: target.email },
    });

    return NextResponse.json({ removed: true });
  } catch (err) {
    return errorResponse(err);
  }
}
