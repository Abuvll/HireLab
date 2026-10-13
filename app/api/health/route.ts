import { NextResponse } from "next/server";

// Liveness probe: answers 200 as long as the web process is up and serving requests.
// Deliberately does NOT touch the database or Redis, so a slow or sleeping dependency can't make the platform
// restart a healthy web server. Use /api/health/ready to check dependencies.
// force-dynamic: without it Next.js could evaluate this handler once at build time and cache the result.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
