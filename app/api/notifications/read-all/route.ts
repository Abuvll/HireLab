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

    await prisma.notificationRead.createMany({
      data: applications.map((a) => ({ userId: session.userId, applicationId: a.id })),
      skipDuplicates: true,
    });

    return NextResponse.json({ read: true, count: applications.length });
  } catch (err) {
    return errorResponse(err);
  }
}
