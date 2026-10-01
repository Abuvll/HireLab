import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { hashToken } from "../../../../lib/security/encryption";
import { hashPassword } from "../../../../lib/auth/password";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { badRequest, errorResponse } from "../../../../lib/api/errors";
import { checkRateLimitSafe, getClientIp } from "../../../../lib/security/rate-limit";
import { checkPasswordStrength } from "../../../../lib/security/password-strength";
import { logAuditEvent } from "../../../../lib/api/audit";

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const rl = await checkRateLimitSafe(`accept-invite:${ip}`, 10, 60);
    if (!rl.allowed) throw badRequest("Too many attempts — wait a moment and try again.");

    const body = await req.json().catch(() => null);
    const parsed = acceptSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request");

    const strength = checkPasswordStrength(parsed.data.password);
    if (!strength.valid) throw badRequest(strength.error!);

    const invite = await prisma.pendingInvite.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw badRequest("This invite link is invalid or has expired — ask for a new one.");
    }

    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) throw badRequest("An account with this email already exists — try logging in instead.");

    const passwordHash = await hashPassword(parsed.data.password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: invite.email,
          name: invite.name,
          passwordHash,
          orgRole: invite.role,
          organizationId: invite.organizationId,
        },
      });
      await tx.pendingInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return created;
    });

    await logAuditEvent({
      organizationId: invite.organizationId,
      actorUserId: user.id,
      action: "team.invite_accepted",
      targetType: "User",
      targetId: user.id,
    });

    const res = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, orgRole: user.orgRole } });
    await setSessionCookie(res, { userId: user.id, organizationId: user.organizationId, orgRole: user.orgRole });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
