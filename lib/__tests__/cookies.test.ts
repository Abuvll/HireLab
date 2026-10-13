import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
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

describe("session cookie hardening", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("clearSessionCookie uses the same attributes as the cookie it removes, with maxAge 0", () => {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    const cookie = res.cookies.get("hirelab_session");
    expect(cookie?.value).toBe("");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(0);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = NextResponse.json({ ok: true });
    await setSessionCookie(res, payload);
    expect(res.cookies.get("hirelab_session")?.secure).toBe(true);
  });

  it("refuses a SESSION_SECRET shorter than 32 characters in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "too-short");
    const res = NextResponse.json({ ok: true });
    await expect(setSessionCookie(res, payload)).rejects.toThrow(/at least 32 characters/);
  });

  it("still accepts a short SESSION_SECRET outside production (local dev / tests)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SESSION_SECRET", "short-dev-secret");
    const res = NextResponse.json({ ok: true });
    await expect(setSessionCookie(res, payload)).resolves.toBeUndefined();
  });
});

describe("'Remember me' cookie lifetime", () => {
  it("remember: true (and the default) sets a 7-day persistent cookie", async () => {
    for (const options of [{ remember: true }, undefined]) {
      const res = NextResponse.json({ ok: true });
      await setSessionCookie(res, payload, options);
      expect(res.cookies.get("hirelab_session")?.maxAge).toBe(60 * 60 * 24 * 7);
    }
  });

  it("remember: false sets a browser-session cookie: no Max-Age / Expires, so it goes when the browser closes", async () => {
    const res = NextResponse.json({ ok: true });
    await setSessionCookie(res, payload, { remember: false });
    const cookie = res.cookies.get("hirelab_session");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.maxAge).toBeUndefined();
    expect(cookie?.expires).toBeUndefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(res.headers.get("set-cookie")).not.toMatch(/max-age/i);
  });

  it("a session-only cookie still authenticates the request", async () => {
    const res = NextResponse.json({ ok: true });
    await setSessionCookie(res, payload, { remember: false });
    const req = new NextRequest("https://example.com/api/positions", {
      headers: { cookie: `hirelab_session=${res.cookies.get("hirelab_session")?.value}` },
    });
    expect(await getSessionFromRequest(req)).toEqual(payload);
  });
});
