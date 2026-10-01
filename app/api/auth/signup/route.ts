import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/db";
import { signupSchema } from "../../../../lib/api/validation";
import { hashPassword } from "../../../../lib/auth/password";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { badRequest, errorResponse } from "../../../../lib/api/errors";
import { checkRateLimitSafe, getClientIp } from "../../../../lib/security/rate-limit";
import { checkPasswordStrength } from "../../../../lib/security/password-strength";


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid signup data");

    const ip = getClientIp(req.headers);
    const rl = await checkRateLimitSafe(`signup-ip:${ip}`, 10, 3600);
    if (!rl.allowed) throw badRequest("Too many signup attempts from this network — try again later.");

    // Server-side floor, independent of the frontend's length >= 6 check
    // (§3.2's security notes — never trust the client's validation alone).
    const strength = checkPasswordStrength(parsed.data.password);
    if (!strength.valid) throw badRequest(strength.error!);

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) throw badRequest("An account with that email already exists");

    const passwordHash = await hashPassword(parsed.data.password);

    type TxClient = {
      organization: { create(args: { data: { name: string } }): Promise<{ id: string }> };
      user: {
        create(args: {
          data: {
            email: string;
            name: string;
            passwordHash: string;
            organizationId: string;
            orgRole: string;
          };
        }): Promise<{ id: string; email: string; name: string; organizationId: string; orgRole: string }>;
      };
    };

        let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: parsed.data.organizationName || "My Organization" },
        });

        const user = await tx.user.create({
          data: {
            email: parsed.data.email,
            name: parsed.data.name,
            passwordHash,
            organizationId: organization.id,
            orgRole: "OWNER",
          },
        });

        return user;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw badRequest("An account with that email already exists");
      }
      throw err;
    }


    const res = NextResponse.json(
      { user: { id: user.id, name: user.name, email: user.email, orgRole: user.orgRole } },
      { status: 201 }
    );
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
