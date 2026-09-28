import type { NextRequest } from "next/server";
import { prisma } from "../db";
import { requireAuth } from "./auth";
import type { SessionPayload } from "../auth/session";
import { notFound } from "./errors";

export async function requirePositionAccess(
  req: NextRequest,
  positionId: string
): Promise<{ session: SessionPayload; position: { id: string; organizationId: string } }> {
  const session = await requireAuth(req);
  const position = await prisma.position.findUnique({ where: { id: positionId } });
  if (!position || position.organizationId !== session.organizationId) {
    throw notFound("Position not found");
  }
  return { session, position };
}
