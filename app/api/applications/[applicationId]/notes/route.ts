import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/db";
import { requireApplicationAccess } from "../../../../../lib/api/application-access";
import { badRequest, forbidden, errorResponse } from "../../../../../lib/api/errors";

const createNoteSchema = z.object({ text: z.string().trim().min(1).max(5000) });

export async function GET(
  req: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  try {
    await requireApplicationAccess(req, params.applicationId);

    const notes = await prisma.candidateNote.findMany({
      where: { applicationId: params.applicationId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      notes: notes.map((n) => ({
        id: n.id,
        applicationId: n.applicationId,
        authorId: n.authorId,
        authorName: n.authorName,
        authorRole: n.authorRole,
        text: n.text,
        createdAt: n.createdAt,
        editedAt: n.editedAt,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

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

    const author = await prisma.user.findUnique({ where: { id: session.userId } });

    const note = await prisma.candidateNote.create({
      data: {
        applicationId: params.applicationId,
        authorId: session.userId,
        authorName: author?.name ?? "Unknown",
        authorRole: session.orgRole,
        text: parsed.data.text,
      },
    });

    return NextResponse.json(
      {
        id: note.id,
        applicationId: note.applicationId,
        authorId: note.authorId,
        authorName: note.authorName,
        authorRole: note.authorRole,
        text: note.text,
        createdAt: note.createdAt,
        editedAt: note.editedAt,
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
