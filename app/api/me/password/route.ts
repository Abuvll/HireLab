import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { verifyPassword, hashPassword } from "../../../../lib/auth/password";
import { badRequest, errorResponse } from "../../../../lib/api/errors";
import { checkRateLimitSafe } from "../../../../lib/security/rate-limit";
import { checkPasswordStrength } from "../../../../lib/security/password-strength";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must be different from your current password",
    path: ["newPassword"],
  });

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const rl = await checkRateLimitSafe(`change-password:${session.userId}`, 5, 300);
    if (!rl.allowed) throw badRequest("Too many attempts — wait a few minutes and try again.");

    const body = await req.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request");

    const strength = checkPasswordStrength(parsed.data.newPassword);
    if (!strength.valid) throw badRequest(strength.error!);

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw badRequest("User not found");

    const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) throw badRequest("Current password is incorrect");

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({ where: { id: session.userId }, data: { passwordHash } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
