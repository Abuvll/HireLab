import type { NextRequest, NextResponse } from "next/server";
import { createSessionToken, verifySessionToken, type SessionPayload } from "./session";

const SESSION_COOKIE_NAME = "hirelab_session";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token, getSecret());
}

export async function setSessionCookie(res: NextResponse, payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload, getSecret());
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, 
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}
