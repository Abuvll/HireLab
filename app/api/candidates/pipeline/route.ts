import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { CANDIDATE_ENTRY_INCLUDE, serializeCandidateEntry } from "../../../../lib/api/pipeline";
import { errorResponse } from "../../../../lib/api/errors";

/** GET /api/candidates/pipeline -> { candidates } : every candidate in the organization that has been given a stage. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const rows = await prisma.application.findMany({
      where: { stage: { not: null }, position: { organizationId: session.organizationId } },
      include: CANDIDATE_ENTRY_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const now = new Date();
    return NextResponse.json({ candidates: rows.map((r) => serializeCandidateEntry(r as never, now)) });
  } catch (err) {
    return errorResponse(err);
  }
}
