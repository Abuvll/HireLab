import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { hashToken } from "../../../../lib/security/encryption";
import { hashPassword } from "../../../../lib/auth/password";
import { checkPasswordStrength } from "../../../../lib/security/password-strength";
import { checkRateLimitSafe, getClientIp } from "../../../../lib/security/rate-limit";
import { badRequest, errorResponse } from "../../../../lib/api/errors";

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const rl = await checkRateLimitSafe(`reset-password:${ip}`, 10, 300);
    if (!rl.allowed) throw badRequest("Too many attempts — wait a few minutes and try again.");

    const body = await req.json().catch(() => null);
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request");

    const strength = checkPasswordStrength(parsed.data.newPassword);
    if (!strength.valid) throw badRequest(strength.error!);

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw badRequest("This reset link is invalid or has expired — request a new one.");
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);

    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
      // Invalidate any other outstanding reset tokens for this user too —
      // a second, older "forgot password" email shouldn't still work
      // after this one has been used.
      prisma.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null, id: { not: resetToken.id } },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
