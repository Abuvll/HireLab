import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requireRole } from "../../../../../lib/api/auth";
import { notFound, errorResponse } from "../../../../../lib/api/errors";
import { logAuditEvent } from "../../../../../lib/api/audit";

// Not in the checklist's explicit §3.8 endpoint list, but a necessary
// companion to POST /api/team/invite: a sent invite needs to be
// cancellable (wrong email, changed their mind, invited the wrong role)
// before it's accepted, same as most team-invite UIs.

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
