import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requireApplicationAccess } from "../../../../../lib/api/application-access";
import { errorResponse } from "../../../../../lib/api/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  try {
    const { session } = await requireApplicationAccess(req, params.applicationId);

    await prisma.notificationRead.upsert({
      where: { userId_applicationId: { userId: session.userId, applicationId: params.applicationId } },
      create: { userId: session.userId, applicationId: params.applicationId },
      update: {},
    });

    return NextResponse.json({ read: true });
  } catch (err) {
    return errorResponse(err);
  }
}
