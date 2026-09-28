import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/db";
import { requireAuth } from "../../../lib/api/auth";
import { verifyPassword } from "../../../lib/auth/password";
import { badRequest, errorResponse } from "../../../lib/api/errors";

// §3.29 — email doubles as the login identifier, so changing it is
// treated as sensitive: this app has no email-verification-link
// infrastructure to confirm the new address is actually reachable by the
// account holder, so the mitigation used here is requiring the current
// password to confirm it's really the account owner making the change —
// not a full email-verification flow, but a real control against
// "hijacked session silently changes the login email" account takeover.

const updateMeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).nullable().optional(),
  currentPassword: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw badRequest("User not found");
    return NextResponse.json({ id: user.id, name: user.name, email: user.email, phone: user.phone, orgRole: user.orgRole });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const body = await req.json().catch(() => null);
    const parsed = updateMeSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid profile data");

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw badRequest("User not found");

    const changingEmail = parsed.data.email !== undefined && parsed.data.email !== user.email;
    if (changingEmail) {
      if (!parsed.data.currentPassword) {
        throw badRequest("Enter your current password to change your email");
      }
      const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
      if (!valid) throw badRequest("Current password is incorrect");

      const emailTaken = await prisma.user.findUnique({ where: { email: parsed.data.email } });
      if (emailTaken) throw badRequest("That email is already in use");
    }

    const updated = await prisma.user.update({
      where: { id: session.userId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(changingEmail ? { email: parsed.data.email } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      },
    });

    return NextResponse.json({ id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, orgRole: updated.orgRole });
  } catch (err) {
    return errorResponse(err);
  }
}
