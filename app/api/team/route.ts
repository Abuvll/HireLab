import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/db";
import { requireAuth, requireRole } from "../../../lib/api/auth";
import { badRequest, forbidden, errorResponse } from "../../../lib/api/errors";
import { ORG_ROLES } from "../../../lib/domain-enums";
import { generateSecureToken, hashToken } from "../../../lib/security/encryption";
import { sendEmail, inviteEmail } from "../../../lib/email/send";
import { checkRateLimitSafe } from "../../../lib/security/rate-limit";
import { logAuditEvent } from "../../../lib/api/audit";
import { getPublicBaseUrl } from "../../../lib/api/urls";

const inviteSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  role: z.enum(ORG_ROLES),
});

const INVITE_EXPIRY_DAYS = 7;

/**
 * GET /api/team -> the organization roster for Settings > Team: every member (any role may read it) plus the invites that
 * are still open (not accepted, not expired). `userId` is the key DELETE /api/team/:userId takes; `inviteId` the one
 * DELETE /api/team/invite/:inviteId takes.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const [users, invites] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: session.organizationId },
        select: { id: true, name: true, email: true, orgRole: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.pendingInvite.findMany({
        where: { organizationId: session.organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return NextResponse.json({
      members: users.map((u) => ({ userId: u.id, name: u.name, email: u.email, role: u.orgRole })),
      pendingInvites: invites.map((i) => ({
        inviteId: i.id,
        name: i.name,
        email: i.email,
        role: i.role,
        invitedAt: i.createdAt,
        expiresAt: i.expiresAt,
        status: "pending",
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const rl = await checkRateLimitSafe(`team-invite:${session.organizationId}`, 20, 3600);
    if (!rl.allowed) throw badRequest("Too many invites sent recently — try again later.");

    const body = await req.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid invite data");

    // Privilege escalation: an ADMIN can't grant OWNER. Only an existing
    // OWNER can invite someone as OWNER.
    if (parsed.data.role === "OWNER" && session.orgRole !== "OWNER") {
      throw forbidden("Only an Owner can invite someone as an Owner");
    }

    const existingUser = await prisma.user.findFirst({
      where: { organizationId: session.organizationId, email: parsed.data.email },
    });
    if (existingUser) throw badRequest("This person is already part of your organization");

    const rawToken = generateSecureToken();
    const org = await prisma.organization.findUnique({ where: { id: session.organizationId } });
    const inviter = await prisma.user.findUnique({ where: { id: session.userId } });

    const invite = await prisma.pendingInvite.upsert({
      where: { organizationId_email: { organizationId: session.organizationId, email: parsed.data.email } },
      create: {
        organizationId: session.organizationId,
        email: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role,
        tokenHash: hashToken(rawToken),
        invitedByUserId: session.userId,
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
      
      update: {
        name: parsed.data.name,
        role: parsed.data.role,
        tokenHash: hashToken(rawToken),
        invitedByUserId: session.userId,
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        acceptedAt: null,
      },
    });

    const acceptUrl = `${getPublicBaseUrl(req.nextUrl.origin)}/accept-invite?token=${rawToken}`;
    await sendEmail(
      inviteEmail({
        to: parsed.data.email,
        inviterName: inviter?.name ?? "A teammate",
        organizationName: org?.name ?? "your organization",
        acceptUrl,
      })
    );

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "team.invited",
      targetType: "PendingInvite",
      targetId: invite.id,
      metadata: { email: parsed.data.email, role: parsed.data.role },
    });

    return NextResponse.json(
      {
        inviteId: invite.id,
        name: invite.name,
        email: invite.email,
        role: invite.role,
        invitedAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        status: "pending",
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
