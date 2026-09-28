import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requirePositionAccess } from "../../../../../lib/api/position-access";
import { updatePositionStatusSchema } from "../../../../../lib/api/validation";
import { badRequest, forbidden, errorResponse } from "../../../../../lib/api/errors";

// NOTE ON VERIFICATION: touches prisma.position, unverified in this
// sandbox — see prisma-repository.ts's caveat.
//
// Split out from the general PATCH /api/positions/[id] edit endpoint
// because the dashboard's position-actions menu (Pause / Reopen / Close)
// is a distinct, single-purpose action separate from editing the listing
// content — same split the frontend itself makes (renderPositionActionsMenu
// calls API.setPositionStatus, the edit form calls API.updatePosition).

export async function PATCH(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  try {
    const { session } = await requirePositionAccess(req, params.positionId);
    if (!["OWNER", "ADMIN"].includes(session.orgRole)) {
      throw forbidden("Only Owners and Admins can change a position's status");
    }

    const body = await req.json().catch(() => null);
    const parsed = updatePositionStatusSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid status");

    const position = await prisma.position.update({
      where: { id: params.positionId },
      data: { status: parsed.data.status },
    });

    return NextResponse.json({ position });
  } catch (err) {
    return errorResponse(err);
  }
}
