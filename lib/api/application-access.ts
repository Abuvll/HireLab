import type { NextRequest } from "next/server";
import { prisma } from "../db";
import { requireAuth } from "./auth";
import type { SessionPayload } from "../auth/session";
import { notFound } from "./errors";



export async function requireApplicationAccess(
  req: NextRequest,
  applicationId: string
): Promise<{ session: SessionPayload; positionId: string }> {
  const session = await requireAuth(req);
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { position: { select: { organizationId: true } } },
  });
  if (!application || application.position.organizationId !== session.organizationId) {
    throw notFound("Application not found");
  }
  return { session, positionId: application.positionId };
}
