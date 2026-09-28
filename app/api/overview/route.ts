import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api/auth";
import { buildOverviewData } from "../../../lib/api/overview";
import { errorResponse } from "../../../lib/api/errors";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const data = await buildOverviewData(session.organizationId, req.nextUrl.origin);
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
