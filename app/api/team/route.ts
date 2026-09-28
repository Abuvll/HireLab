import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { requireRole } from "../../../../lib/api/auth";
import { badRequest, forbidden, errorResponse } from "../../../../lib/api/errors";
import { ORG_ROLES } from "../../../../lib/domain-enums";
import { generateSecureToken, hashToken } from "../../../../lib/security/encryption";
import { sendEmail, inviteEmail } from "../../../../lib/email/send";
import { checkRateLimitSafe } from "../../../../lib/security/rate-limit";
import { logAuditEvent } from "../../../../lib/api/audit";

const inviteSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  role: z.enum(ORG_ROLES),
});

const INVITE_EXPIRY_DAYS = 7;

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
      // Re-inviting (e.g. the previous link expired) issues a fresh token
      // rather than erroring — the old link simply stops working since its
      // hash no longer matches any row.
      update: {
        name: parsed.data.name,
        role: parsed.data.role,
        tokenHash: hashToken(rawToken),
        invitedByUserId: session.userId,
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        acceptedAt: null,
      },
    });

    const acceptUrl = `${(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "")}/accept-invite?token=${rawToken}`;
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
