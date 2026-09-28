import { describe, it, expect, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "../auth/session";

const SECRET = "test-secret-at-least-32-characters-long";
const payload = { userId: "user1", organizationId: "org1", orgRole: "ADMIN" as const };

describe("session tokens", () => {
  it("round-trips a valid payload", async () => {
    const token = await createSessionToken(payload, SECRET);
    const result = await verifySessionToken(token, SECRET);
    expect(result).toEqual(payload);
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await createSessionToken(payload, SECRET);
    const result = await verifySessionToken(token, "a-completely-different-secret-value");
    expect(result).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    const result = await verifySessionToken("not.a.valid.jwt", SECRET);
    expect(result).toBeNull();
  });

  it("returns null for an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await createSessionToken(payload, SECRET);

    vi.setSystemTime(new Date("2026-02-01T00:00:00Z")); // 8 days later, past the 7-day expiry
    const result = await verifySessionToken(token, SECRET);
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it("returns null for a token with tampered payload fields", async () => {
    const token = await createSessionToken(payload, SECRET);
    const [header, , signature] = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, orgRole: "OWNER" })).toString(
      "base64url"
    );
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
    const result = await verifySessionToken(tamperedToken, SECRET);
    expect(result).toBeNull();
  });

  it("re-throws genuinely unexpected (non-jose) errors instead of swallowing them", async () => {
    const token = await createSessionToken(payload, SECRET);
    let caught: unknown;
    try {
      await verifySessionToken(token, "");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeNull();
    expect((caught as Error).constructor.name).not.toBe("JOSEError");
  });
});
