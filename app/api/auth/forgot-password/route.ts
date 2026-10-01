import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { generateSecureToken, hashToken } from "../../../../lib/security/encryption";
import { sendEmail, passwordResetEmail } from "../../../../lib/email/send";
import { checkRateLimitSafe, getClientIp } from "../../../../lib/security/rate-limit";
import { badRequest, errorResponse } from "../../../../lib/api/errors";

const RESET_TOKEN_EXPIRY_MINUTES = 30;

const forgotPasswordSchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const rl = await checkRateLimitSafe(`forgot-password:${ip}`, 5, 300);
    if (!rl.allowed) throw badRequest("Too many requests — wait a few minutes and try again.");

    const body = await req.json().catch(() => null);
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request");

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

    if (user) {
      const rawToken = generateSecureToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000),
        },
      });

      const resetUrl = `${(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "")}/reset-password?token=${rawToken}`;
      await sendEmail(passwordResetEmail({ to: user.email, resetUrl }));
    }

    // Same response either way — see the file header.
    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email, we've sent a password reset link.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
