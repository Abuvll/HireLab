import type { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_DURATION_SECONDS,
  SHORT_SESSION_DURATION_SECONDS,
  type SessionPayload,
} from "./session";

const SESSION_COOKIE_NAME = "hirelab_session";

const MIN_PRODUCTION_SECRET_LENGTH = 32;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  // A short secret makes the signed session cookie guessable offline; refuse to run production with one.
  if (process.env.NODE_ENV === "production" && secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`);
  }
  return secret;
}

function cookieAttributes() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token, getSecret());
}

/**
 * Signs the person in. `remember` (default true) keeps the cookie for 7 days; `remember: false` sets a browser-session
 * cookie (no Max-Age, gone when the browser closes) whose token is also only valid for 24 hours.
 */
export async function setSessionCookie(
  res: NextResponse,
  payload: SessionPayload,
  options: { remember?: boolean } = {}
): Promise<void> {
  const remember = options.remember !== false;
  const token = await createSessionToken(
    payload,
    getSecret(),
    remember ? SESSION_DURATION_SECONDS : SHORT_SESSION_DURATION_SECONDS
  );
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    ...cookieAttributes(),
    ...(remember ? { maxAge: SESSION_DURATION_SECONDS } : {}),
  });
}

export function clearSessionCookie(res: NextResponse): void {
  // Same attributes as when the cookie was set, so every browser treats this as the same cookie and removes it.
  res.cookies.set(SESSION_COOKIE_NAME, "", { ...cookieAttributes(), maxAge: 0 });
}
