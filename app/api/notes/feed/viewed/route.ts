import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requireAuth } from "../../../../../lib/api/auth";
import { errorResponse } from "../../../../../lib/api/errors";

/** POST /api/notes/feed/viewed -> { lastViewedAt } : records that the signed-in person has just looked at the Notes feed. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const updated = await prisma.user.update({
      where: { id: session.userId },
      data: { notesLastViewedAt: new Date() },
      select: { notesLastViewedAt: true },
    });
    return NextResponse.json({ lastViewedAt: updated.notesLastViewedAt });
  } catch (err) {
    return errorResponse(err);
  }
}
