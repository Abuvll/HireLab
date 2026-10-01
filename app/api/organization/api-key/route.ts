import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { requireRole } from "../../../../lib/api/auth";
import { badRequest, errorResponse } from "../../../../lib/api/errors";
import { encryptSecret, last4 } from "../../../../lib/security/encryption";
import { validateProviderKey } from "../../../../lib/extraction/litellm-client";
import { checkRateLimitSafe } from "../../../../lib/security/rate-limit";
import { logAuditEvent } from "../../../../lib/api/audit";
import { LLM_PROVIDERS, LLM_PROVIDER_PREFIX } from "../../../../lib/domain-enums";
import { z } from "zod";

const saveKeySchema = z
  .object({
    apiKey: z.string().min(20).max(500),
    provider: z.enum(LLM_PROVIDERS),
    model: z.string().min(1).max(200),
  })
  .refine((data) => data.model.startsWith(`${LLM_PROVIDER_PREFIX[data.provider]}/`), {
    message: "That model doesn't belong to the selected provider.",
    path: ["model"],
  });

function maskedKeyDisplay(provider: (typeof LLM_PROVIDERS)[number], last4Digits: string): string {
  return `${provider} ••••••••${last4Digits}`;
}

function currentBillingCycleStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const key = await prisma.orgApiKey.findUnique({ where: { organizationId: session.organizationId } });
    if (!key) {
      return NextResponse.json({ hasKey: false, maskedKey: null, provider: null, model: null, usageThisCycle: null });
    }

    const usage = await prisma.apiUsageEvent.aggregate({
      where: { organizationId: session.organizationId, createdAt: { gte: currentBillingCycleStart() } },
      _sum: { costUsd: true },
    });

    return NextResponse.json({
      hasKey: true,
      maskedKey: maskedKeyDisplay(key.provider, key.last4),
      provider: key.provider,
      model: key.model,
      usageThisCycle: usage._sum.costUsd,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const rl = await checkRateLimitSafe(`api-key-save:${session.organizationId}`, 5, 60);
    if (!rl.allowed) throw badRequest("Too many attempts — wait a minute and try again.");

    const body = await req.json().catch(() => null);
    const parsed = saveKeySchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request");

    const validation = await validateProviderKey(parsed.data.apiKey, parsed.data.provider, parsed.data.model);
    if (!validation.valid) {
      throw badRequest(validation.error ?? "That key doesn't look valid — check it and try again.");
    }

    const encryptedKey = encryptSecret(parsed.data.apiKey);
    const keyLast4 = last4(parsed.data.apiKey);

    const existed = !!(await prisma.orgApiKey.findUnique({ where: { organizationId: session.organizationId } }));

    await prisma.orgApiKey.upsert({
      where: { organizationId: session.organizationId },
      create: {
        organizationId: session.organizationId,
        encryptedKey,
        last4: keyLast4,
        provider: parsed.data.provider,
        model: parsed.data.model,
        createdByUserId: session.userId,
      },
      update: {
        encryptedKey,
        last4: keyLast4,
        provider: parsed.data.provider,
        model: parsed.data.model,
        createdByUserId: session.userId,
      },
    });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: existed ? "api_key.replaced" : "api_key.created",
      targetType: "OrgApiKey",
    });

    return NextResponse.json(
      {
        hasKey: true,
        maskedKey: maskedKeyDisplay(parsed.data.provider, keyLast4),
        provider: parsed.data.provider,
        model: parsed.data.model,
        usageThisCycle: 0,
      },
      { status: existed ? 200 : 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const existing = await prisma.orgApiKey.findUnique({ where: { organizationId: session.organizationId } });
    if (!existing) throw badRequest("No key is currently configured");

    await prisma.orgApiKey.delete({ where: { organizationId: session.organizationId } });

    await logAuditEvent({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "api_key.removed",
      targetType: "OrgApiKey",
    });

    return NextResponse.json({ hasKey: false, maskedKey: null, provider: null, model: null, usageThisCycle: null });
  } catch (err) {
    return errorResponse(err);
  }
}
