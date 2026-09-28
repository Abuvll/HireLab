import { prisma } from "../db";

export async function logAuditEvent(params: {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {

  try {
    await prisma.auditLogEntry.create({
      data: {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        metadata: params.metadata,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[audit] Failed to write audit entry for "${params.action}":`, err);
  }
}
