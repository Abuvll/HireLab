import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole, type AuthDeps, type VerifiedUser } from "../api/auth";
import { setSessionCookie } from "../auth/cookies";
import { ApiError } from "../api/errors";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

async function requestWithSession(payload: {
  userId: string;
  organizationId: string;
  orgRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}): Promise<NextRequest> {
  const res = NextResponse.json({});
  await setSessionCookie(res, payload);
  const cookieValue = res.cookies.get("hirelab_session")!.value;
  return new NextRequest("https://example.com/api/positions", {
    headers: { cookie: `hirelab_session=${cookieValue}` },
  });
}

// requireAuth reads the caller's CURRENT role/org from the database (the
// cookie only proves identity), so tests inject a fake user table instead of
// a real Prisma client.
function depsWith(users: VerifiedUser[]): AuthDeps {
  return { loadUser: async (id) => users.find((u) => u.id === id) ?? null };
}
const u1 = (orgRole: VerifiedUser["orgRole"], organizationId = "o1"): VerifiedUser => ({ id: "u1", organizationId, orgRole });

describe("requireAuth", () => {
  it("returns the session payload for an authenticated request", async () => {
    const req = await requestWithSession({ userId: "u1", organizationId: "o1", orgRole: "RECRUITER" });
    const session = await requireAuth(req, depsWith([u1("RECRUITER")]));
    expect(session.userId).toBe("u1");
  });

  it("takes the role from the database, not from the cookie (demoted user)", async () => {
    // The cookie was minted while u1 was an OWNER; the database now says VIEWER.
    const req = await requestWithSession({ userId: "u1", organizationId: "o1", orgRole: "OWNER" });
    const session = await requireAuth(req, depsWith([u1("VIEWER")]));
    expect(session.orgRole).toBe("VIEWER");
  });

  it("takes the organization from the database, not from the cookie", async () => {
    const req = await requestWithSession({ userId: "u1", organizationId: "old-org", orgRole: "ADMIN" });
    const session = await requireAuth(req, depsWith([u1("ADMIN", "new-org")]));
    expect(session.organizationId).toBe("new-org");
  });

  it("throws a 401 when the account no longer exists (removed team member)", async () => {
    const req = await requestWithSession({ userId: "u1", organizationId: "o1", orgRole: "OWNER" });
    await expect(requireAuth(req, depsWith([]))).rejects.toMatchObject({ status: 401 });
  });

  it("doesn't touch the database when there's no session cookie", async () => {
    const loadUser = vi.fn(async () => null);
    const req = new NextRequest("https://example.com/api/positions");
    await expect(requireAuth(req, { loadUser })).rejects.toMatchObject({ status: 401 });
    expect(loadUser).not.toHaveBeenCalled();
  });

  it("throws a 401 ApiError for an unauthenticated request", async () => {
    const req = new NextRequest("https://example.com/api/positions");
    await expect(requireAuth(req, depsWith([]))).rejects.toMatchObject({ status: 401 });
  });

  it("the thrown error is an instance of ApiError", async () => {
    const req = new NextRequest("https://example.com/api/positions");
    await expect(requireAuth(req, depsWith([]))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("requireRole", () => {
  it("passes when the session's role is in the allowed list", async () => {
    const req = await requestWithSession({ userId: "u1", organizationId: "o1", orgRole: "OWNER" });
    const session = await requireRole(req, ["OWNER", "ADMIN"], depsWith([u1("OWNER")]));
    expect(session.orgRole).toBe("OWNER");
  });

  it("throws a 403 when the session's role isn't allowed", async () => {
    const req = await requestWithSession({ userId: "u1", organizationId: "o1", orgRole: "VIEWER" });
    await expect(requireRole(req, ["OWNER", "ADMIN"], depsWith([u1("VIEWER")]))).rejects.toMatchObject({ status: 403 });
  });

  it("throws a 403 for a user demoted since login, even though their cookie still says OWNER", async () => {
    const req = await requestWithSession({ userId: "u1", organizationId: "o1", orgRole: "OWNER" });
    await expect(requireRole(req, ["OWNER", "ADMIN"], depsWith([u1("RECRUITER")]))).rejects.toMatchObject({ status: 403 });
  });

  it("grants a user promoted since login, even though their cookie still says VIEWER", async () => {
    const req = await requestWithSession({ userId: "u1", organizationId: "o1", orgRole: "VIEWER" });
    const session = await requireRole(req, ["OWNER", "ADMIN"], depsWith([u1("ADMIN")]));
    expect(session.orgRole).toBe("ADMIN");
  });

  it("throws a 401 (not 403) when there's no session at all", async () => {
    const req = new NextRequest("https://example.com/api/positions");
    await expect(requireRole(req, ["OWNER"], depsWith([]))).rejects.toMatchObject({ status: 401 });
  });
});
