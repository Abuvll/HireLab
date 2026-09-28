import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "../auth/cookies";
import type { SessionPayload } from "../auth/session";
import type { OrgRole } from "../domain-enums";
import { unauthorized, forbidden } from "./errors";

// The signed session cookie only proves WHO is calling. What that person may
// do is read fresh from the database on every request: the role inside the
// JWT is frozen at login and the token lives for 7 days, so trusting it
// would let a demoted user keep their old permissions — and a removed team
// member keep their access to the organization — until it expired.
export type VerifiedUser = { id: string; organizationId: string; orgRole: OrgRole };

export type AuthDeps = {
  loadUser: (userId: string) => Promise<VerifiedUser | null>;
};

async function loadUserFromDb(userId: string): Promise<VerifiedUser | null> {
  // Lazy import so unit tests that inject `deps` never construct a Prisma client.
  const { prisma } = await import("../db");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, orgRole: true },
  });
  return user as VerifiedUser | null;
}

const defaultDeps: AuthDeps = { loadUser: loadUserFromDb };

export async function requireAuth(req: NextRequest, deps: AuthDeps = defaultDeps): Promise<SessionPayload> {
  const session = await getSessionFromRequest(req);
  if (!session) throw unauthorized();

  const user = await deps.loadUser(session.userId);
  // Valid signature but the account no longer exists (e.g. removed from
  // the team): treat exactly like an expired session.
  if (!user) throw unauthorized();

  return { userId: user.id, organizationId: user.organizationId, orgRole: user.orgRole };
}

export async function requireRole(
  req: NextRequest,
  allowedRoles: OrgRole[],
  deps: AuthDeps = defaultDeps
): Promise<SessionPayload> {
  const session = await requireAuth(req, deps);
  if (!allowedRoles.includes(session.orgRole)) {
    throw forbidden(`This action requires one of: ${allowedRoles.join(", ")}`);
  }
  return session;
}
