import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { requireApplicationAccess } from "../../../../../lib/api/application-access";
import { errorResponse } from "../../../../../lib/api/errors";

// §3.27 — "activity" today is exactly "an application arrived", so the
// application IS the activity record (see the schema comment on
// NotificationRead for the path to first-class activity records if more
// types are ever needed). Scoped per-user, per requireApplicationAccess's
// own org check.

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
