import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { loginSchema } from "../../../../lib/api/validation";
import { verifyPassword } from "../../../../lib/auth/password";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { badRequest, unauthorized, errorResponse } from "../../../../lib/api/errors";
import { checkRateLimitSafe, getClientIp } from "../../../../lib/security/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request body");

    const ip = getClientIp(req.headers);
    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimitSafe(`login-ip:${ip}`, 20, 300),
      checkRateLimitSafe(`login-email:${parsed.data.email.toLowerCase()}`, 8, 300),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      throw badRequest("Too many login attempts — wait a few minutes and try again.");
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) throw unauthorized("Invalid email or password");

    const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!validPassword) throw unauthorized("Invalid email or password");

    const res = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, orgRole: user.orgRole },
    });
    await setSessionCookie(res, {
      userId: user.id,
      organizationId: user.organizationId,
      orgRole: user.orgRole,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
