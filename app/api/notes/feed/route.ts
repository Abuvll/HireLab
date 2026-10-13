import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { serializeFeedNote } from "../../../../lib/api/notes";
import { errorResponse } from "../../../../lib/api/errors";

// The feed is the organization's most recent notes. Past this many, older ones are left out (each candidate's own page
// still lists all of theirs).
const FEED_LIMIT = 2000;

const FEED_INCLUDE = {
  application: { select: { fullName: true, positionId: true, createdAt: true, position: { select: { title: true } } } },
} as const;

/**
 * GET /api/notes/feed -> { notes, lastViewedAt }
 *   notes         every note and reply in the organization, newest first, each with candidateName / positionId /
 *                 positionTitle / appliedDaysAgo so the feed can group by candidate
 *   lastViewedAt  when the signed-in person last opened the feed (null the first time); the dashboard marks threads with
 *                 newer activity as "new". POST /api/notes/feed/viewed moves it forward.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const where = { application: { position: { organizationId: session.organizationId } } };

    const [recent, me] = await Promise.all([
      prisma.candidateNote.findMany({
        where,
        include: FEED_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: FEED_LIMIT,
      }),
      prisma.user.findUnique({ where: { id: session.userId }, select: { notesLastViewedAt: true } }),
    ]);

    // A reply whose parent fell outside the limit would be orphaned (and not shown), so pull those parents in too.
    const have = new Set(recent.map((n) => n.id));
    const missingParentIds = [...new Set(recent.map((n) => n.parentId).filter((id): id is string => !!id && !have.has(id)))];
    const parents = missingParentIds.length
      ? await prisma.candidateNote.findMany({ where: { id: { in: missingParentIds }, ...where }, include: FEED_INCLUDE })
      : [];

    const notes = [...recent, ...parents].map((n) => serializeFeedNote(n as never));
    return NextResponse.json({ notes, lastViewedAt: me?.notesLastViewedAt ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
