import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { updateNoteSchema } from "../../../../lib/api/validation";
import { canDeleteNote, canEditNoteText, canPinNotes, serializeNote } from "../../../../lib/api/notes";
import { badRequest, forbidden, notFound, errorResponse } from "../../../../lib/api/errors";

async function loadNoteScopedToOrg(noteId: string, organizationId: string) {
  const note = await prisma.candidateNote.findUnique({
    where: { id: noteId },
    include: { application: { select: { position: { select: { organizationId: true } } } } },
  });
  if (!note || note.application.position.organizationId !== organizationId) return null;
  return note;
}

/**
 * PATCH /api/notes/:id  { text? , pinned? } -> the updated note.
 *   text    editing is for the note's author only; it stamps `editedAt`.
 *   pinned  anyone who can write notes (everyone but Viewers) may pin / unpin; it is not an edit, so `editedAt` is untouched.
 */
export async function PATCH(req: NextRequest, { params }: { params: { noteId: string } }) {
  try {
    const session = await requireAuth(req);

    const note = await loadNoteScopedToOrg(params.noteId, session.organizationId);
    if (!note) throw notFound("Note not found");

    const body = await req.json().catch(() => null);
    const parsed = updateNoteSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid note");
    const { text, pinned } = parsed.data;

    if (text !== undefined && !canEditNoteText(note, session.userId)) {
      throw forbidden("You can only edit your own notes");
    }
    if (pinned !== undefined && !canPinNotes(session.orgRole)) {
      throw forbidden("Viewers can't pin notes");
    }
    // Only a top-level note is pinned: a reply is part of its thread.
    if (pinned === true && note.parentId) {
      throw badRequest("Replies can't be pinned. Pin the note they belong to.");
    }

    const updated = await prisma.candidateNote.update({
      where: { id: params.noteId },
      data: {
        ...(text !== undefined && { text, editedAt: new Date() }),
        ...(pinned !== undefined && { pinned }),
      },
    });

    return NextResponse.json(serializeNote(updated as never));
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/notes/:id -> { deleted: true }. The author, or an Owner / Admin. Deleting a note deletes its replies. */
export async function DELETE(req: NextRequest, { params }: { params: { noteId: string } }) {
  try {
    const session = await requireAuth(req);

    const note = await loadNoteScopedToOrg(params.noteId, session.organizationId);
    if (!note) throw notFound("Note not found");

    if (!canDeleteNote(note, session.userId, session.orgRole)) {
      throw forbidden("You can only delete your own notes");
    }

    // Replies go with it: `CandidateNote.parent` is `onDelete: Cascade`, so the database removes the whole thread.
    await prisma.candidateNote.delete({ where: { id: params.noteId } });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
