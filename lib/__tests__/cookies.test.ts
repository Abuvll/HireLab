import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, setSessionCookie, clearSessionCookie } from "../auth/cookies";

const payload = { userId: "user1", organizationId: "org1", orgRole: "RECRUITER" as const };

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long";
});

describe("session cookie round-trip", () => {
  it("sets a cookie on the response, and a request carrying it reads back the same payload", async () => {
    const res = NextResponse.json({ ok: true });
    await setSessionCookie(res, payload);

    const setCookieHeader = res.cookies.get("hirelab_session")?.value;
    expect(setCookieHeader).toBeTruthy();

    const req = new NextRequest("https://example.com/api/positions", {
      headers: { cookie: `hirelab_session=${setCookieHeader}` },
    });

    const session = await getSessionFromRequest(req);
    expect(session).toEqual(payload);
  });

  it("returns null when there's no session cookie at all", async () => {
    const req = new NextRequest("https://example.com/api/positions");
    const session = await getSessionFromRequest(req);
    expect(session).toBeNull();
  });

  it("returns null for a request carrying an invalid session cookie", async () => {
    const req = new NextRequest("https://example.com/api/positions", {
      headers: { cookie: "hirelab_session=not-a-real-token" },
    });
    const session = await getSessionFromRequest(req);
    expect(session).toBeNull();
  });

  it("sets httpOnly and appropriate cookie attributes", async () => {
    const res = NextResponse.json({ ok: true });
    await setSessionCookie(res, payload);
    const cookie = res.cookies.get("hirelab_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  it("clearSessionCookie removes the session (verified via getSessionFromRequest)", async () => {
    const setRes = NextResponse.json({ ok: true });
    await setSessionCookie(setRes, payload);
    const token = setRes.cookies.get("hirelab_session")?.value;

    const clearRes = NextResponse.json({ ok: true });
    clearSessionCookie(clearRes);
    const clearedValue = clearRes.cookies.get("hirelab_session")?.value;

    // simulate a browser sending the cleared (empty) cookie back
    const req = new NextRequest("https://example.com/api/positions", {
      headers: { cookie: `hirelab_session=${clearedValue}` },
    });
    const session = await getSessionFromRequest(req);
    expect(session).toBeNull();
    expect(token).not.toBe(clearedValue); // sanity: it actually changed
  });
});
