import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { createRedisConnection } from "../../../../lib/security/redis-connection";

// Readiness probe: checks that PostgreSQL and Redis are reachable. Returns 200 when both are, 503 otherwise.
// The response only says which dependency is down — never connection strings, hosts or error details
// (those go to the server log).
// force-dynamic: without it Next.js could evaluate this handler once at build time and cache the result.
export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} check timed out`)), CHECK_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function checkDatabase(): Promise<boolean> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, "database");
    return true;
  } catch (err) {
    console.error("[health] database check failed:", err);
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  let client: ReturnType<typeof createRedisConnection> | null = null;
  try {
    // A short-lived client with no retries, so a down Redis fails the check quickly instead of queueing commands.
    client = createRedisConnection({ maxRetriesPerRequest: 0 });
    const reply = await withTimeout(client.ping(), "redis");
    return reply === "PONG";
  } catch (err) {
    console.error("[health] redis check failed:", err);
    return false;
  } finally {
    client?.disconnect();
  }
}

export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ok = database && redis;
  return NextResponse.json(
    {
      status: ok ? "ok" : "unavailable",
      checks: { database: database ? "ok" : "down", redis: redis ? "ok" : "down" },
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
