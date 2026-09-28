import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { badRequest, forbidden, notFound, errorResponse } from "../../../../lib/api/errors";

// §3.23 permission rules: an author can edit their own note; an author OR
// an OWNER/ADMIN can delete a note (so a manager can moderate/remove a
// note even if they didn't write it, but can't silently rewrite someone
// else's words).

const updateNoteSchema = z.object({ text: z.string().trim().min(1).max(5000) });

async function loadNoteScopedToOrg(noteId: string, organizationId: string) {
  const note = await prisma.candidateNote.findUnique({
    where: { id: noteId },
    include: { application: { select: { position: { select: { organizationId: true } } } } },
  });
  if (!note || note.application.position.organizationId !== organizationId) return null;
  return note;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { noteId: string } }
) {
  try {
    const session = await requireAuth(req);

    const note = await loadNoteScopedToOrg(params.noteId, session.organizationId);
    if (!note) throw notFound("Note not found");

    if (note.authorId !== session.userId) {
      throw forbidden("You can only edit your own notes");
    }

    const body = await req.json().catch(() => null);
    const parsed = updateNoteSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid note");

    const updated = await prisma.candidateNote.update({
      where: { id: params.noteId },
      data: { text: parsed.data.text, editedAt: new Date() },
    });

    return NextResponse.json({
      id: updated.id,
      applicationId: updated.applicationId,
      authorId: updated.authorId,
      authorName: updated.authorName,
      authorRole: updated.authorRole,
      text: updated.text,
      createdAt: updated.createdAt,
      editedAt: updated.editedAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { noteId: string } }
) {
  try {
    const session = await requireAuth(req);

    const note = await loadNoteScopedToOrg(params.noteId, session.organizationId);
    if (!note) throw notFound("Note not found");

    const canDelete = note.authorId === session.userId || ["OWNER", "ADMIN"].includes(session.orgRole);
    if (!canDelete) throw forbidden("You can only delete your own notes");

    await prisma.candidateNote.delete({ where: { id: params.noteId } });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
