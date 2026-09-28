import { NextRequest, NextResponse } from "next/server";


export async function GET(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  const url = new URL(`/apply.html?position=${encodeURIComponent(params.positionId)}`, req.url);
  return NextResponse.redirect(url, 307);
}
