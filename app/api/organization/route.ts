import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/db";
import { requireAuth, requireRole } from "../../../lib/api/auth";
import { badRequest, errorResponse } from "../../../lib/api/errors";

const updateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  website: z.string().url().max(300).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const org = await prisma.organization.findUnique({ where: { id: session.organizationId } });
    if (!org) throw badRequest("Organization not found");
    return NextResponse.json({
      name: org.name,
      website: org.website,
      industry: org.industry,
      description: org.description,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole(req, ["OWNER", "ADMIN"]);

    const body = await req.json().catch(() => null);
    const parsed = updateOrgSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid organization data");

    const updated = await prisma.organization.update({
      where: { id: session.organizationId },
      data: parsed.data,
    });

    return NextResponse.json({
      name: updated.name,
      website: updated.website,
      industry: updated.industry,
      description: updated.description,
      contactEmail: updated.contactEmail,
      contactPhone: updated.contactPhone,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
