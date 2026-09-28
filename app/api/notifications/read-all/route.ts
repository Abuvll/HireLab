import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireAuth } from "../../../../lib/api/auth";
import { errorResponse } from "../../../../lib/api/errors";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);

    const applications = await prisma.application.findMany({
      where: { position: { organizationId: session.organizationId } },
      select: { id: true },
    });

    // createMany + skipDuplicates rather than N upserts: this can be
    // hundreds of rows for an org with a lot of history, and there's no
    // per-row data to merge — an already-read row staying as-is is fine.
    await prisma.notificationRead.createMany({
      data: applications.map((a) => ({ userId: session.userId, applicationId: a.id })),
      skipDuplicates: true,
    });

    return NextResponse.json({ read: true, count: applications.length });
  } catch (err) {
    return errorResponse(err);
  }
}
