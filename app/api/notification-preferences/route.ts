import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/db";
import { requireAuth } from "../../../lib/api/auth";
import { badRequest, errorResponse } from "../../../lib/api/errors";

const DEFAULTS = { newApplicant: true, qualified: true, teamActivity: true, emailDigest: false };

const prefsSchema = z.object({
  newApplicant: z.boolean().optional(),
  qualified: z.boolean().optional(),
  teamActivity: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const prefs = await prisma.notificationPrefs.findUnique({ where: { userId: session.userId } });
    return NextResponse.json(
      prefs
        ? {
            newApplicant: prefs.newApplicant,
            qualified: prefs.qualified,
            teamActivity: prefs.teamActivity,
            emailDigest: prefs.emailDigest,
          }
        : DEFAULTS
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const body = await req.json().catch(() => null);
    const parsed = prefsSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid preferences");

    const updated = await prisma.notificationPrefs.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId, ...DEFAULTS, ...parsed.data },
      update: parsed.data,
    });

    return NextResponse.json({
      newApplicant: updated.newApplicant,
      qualified: updated.qualified,
      teamActivity: updated.teamActivity,
      emailDigest: updated.emailDigest,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
