import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { CANDIDATE_ENTRY_INCLUDE, serializeCandidateEntry } from "../../../../lib/api/pipeline";
import { errorResponse } from "../../../../lib/api/errors";

/**
 * GET /api/candidates/directory -> { candidates } : every analysed candidate in the organization, for the pickers in
 * "Add a note" and "Schedule interview". Applications that are still processing, or failed, have no score and aren't listed.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const rows = await prisma.application.findMany({
      where: { status: "READY", score: { isNot: null }, position: { organizationId: session.organizationId } },
      include: CANDIDATE_ENTRY_INCLUDE,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    });
    const now = new Date();
    return NextResponse.json({ candidates: rows.map((r) => serializeCandidateEntry(r as never, now)) });
  } catch (err) {
    return errorResponse(err);
  }
}
