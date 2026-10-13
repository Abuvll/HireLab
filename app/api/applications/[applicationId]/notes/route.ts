import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requireApplicationAccess } from "../../../../../lib/api/application-access";
import { createNoteSchema } from "../../../../../lib/api/validation";
import { serializeNote } from "../../../../../lib/api/notes";
import { badRequest, forbidden, errorResponse } from "../../../../../lib/api/errors";

/** GET /api/applications/:id/notes -> { notes } : the candidate's notes and replies, newest first. */
export async function GET(
  req: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  try {
    await requireApplicationAccess(req, params.applicationId);

    const notes = await prisma.candidateNote.findMany({
      where: { applicationId: params.applicationId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });

    return NextResponse.json({ notes: notes.map((n) => serializeNote(n as never)) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/applications/:id/notes  { text, parentId? } -> 201, the new note.
 * With `parentId` the note is a reply to that note, which must belong to the same candidate.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  try {
    const { session } = await requireApplicationAccess(req, params.applicationId);
    // VIEWERs can read but never write — see §3.23's permission rules.
    if (session.orgRole === "VIEWER") throw forbidden("Viewers can't add notes");

    const body = await req.json().catch(() => null);
    const parsed = createNoteSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid note");

    const parentId = parsed.data.parentId ?? null;
    if (parentId) {
      const parent = await prisma.candidateNote.findUnique({
        where: { id: parentId },
        select: { id: true, applicationId: true },
      });
      // Same message for "doesn't exist" and "belongs to someone else's candidate": the caller learns nothing about notes
      // outside this application.
      if (!parent || parent.applicationId !== params.applicationId) {
        throw badRequest("The note you're replying to no longer exists.");
      }
    }

    const author = await prisma.user.findUnique({ where: { id: session.userId } });

    const note = await prisma.candidateNote.create({
      data: {
        applicationId: params.applicationId,
        authorId: session.userId,
        authorName: author?.name ?? "Unknown",
        authorRole: session.orgRole,
        text: parsed.data.text,
        parentId,
      },
    });

    return NextResponse.json(serializeNote(note as never), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
