import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../lib/db";
import { requirePositionAccess } from "../../../../../../lib/api/position-access";
import { forbidden, errorResponse } from "../../../../../../lib/api/errors";

// NOTE ON VERIFICATION: touches prisma.positionTeam, unverified in
// this sandbox — see prisma-repository.ts's caveat.

export async function DELETE(
  req: NextRequest,
  { params }: { params: { positionId: string; userId: string } }
) {
  try {
    const { session } = await requirePositionAccess(req, params.positionId);
    if (!["OWNER", "ADMIN"].includes(session.orgRole)) {
      throw forbidden("Only an Owner or Admin can remove team members");
    }

    await prisma.positionTeam.delete({
      where: { positionId_userId: { positionId: params.positionId, userId: params.userId } },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
