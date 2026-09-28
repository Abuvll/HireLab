import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { OrgRole } from "../domain-enums";

export type SessionPayload = {
  userId: string;
  organizationId: string;
  orgRole: OrgRole;
};

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; 

export class SessionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionVerificationError";
  }
}

function toKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: SessionPayload,
  secret: string
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS)
    .sign(toKey(secret));
}

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, toKey(secret));
    if (
      typeof payload.userId !== "string" ||
      typeof payload.organizationId !== "string" ||
      typeof payload.orgRole !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      organizationId: payload.organizationId,
      orgRole: payload.orgRole as OrgRole,
    };
  } catch (err) {
 
    if (err instanceof joseErrors.JOSEError) return null;
    throw err;
  }
}
