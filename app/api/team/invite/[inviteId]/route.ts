import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requireRole } from "../../../../../lib/api/auth";
import { notFound, errorResponse } from "../../../../../lib/api/errors";
import { logAuditEvent } from "../../../../../lib/api/audit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { inviteId: string } }
) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const invite = await prisma.pendingInvite.findUnique({ where: { id: params.inviteId } });
    if (!invite || invite.organizationId !== session.organizationId) {
      throw notFound("Invite not found");
    }

    await prisma.pendingInvite.delete({ where: { id: params.inviteId } });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "team.invite_revoked",
      targetType: "PendingInvite",
      targetId: params.inviteId,
      metadata: { email: invite.email },
    });

    return NextResponse.json({ revoked: true });
  } catch (err) {
    return errorResponse(err);
  }
}
