import { NextRequest, NextResponse } from "next/server";
import { getPublicBaseUrl } from "../../../lib/api/urls";

// Short, shareable apply links (/apply/<positionId>[?src=<tag>]) redirect to the static apply page.
// The redirect target is built from the public base URL (NEXT_PUBLIC_APP_URL) so it stays correct behind a
// reverse proxy, where the request's own origin may be an internal host or http instead of https.
export async function GET(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  const base = getPublicBaseUrl(req.nextUrl.origin);
  const url = new URL("/apply.html", base);
  url.searchParams.set("position", params.positionId);
  // Keep the "where did you hear about us" tag of a shared link (e.g. /apply/<id>?src=linkedin).
  const src = req.nextUrl.searchParams.get("src");
  if (src) url.searchParams.set("src", src.slice(0, 100));
  return NextResponse.redirect(url, 307);
}
