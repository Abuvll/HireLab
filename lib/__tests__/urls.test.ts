import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApplyUrl } from "../api/urls";

describe("buildApplyUrl", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });

  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.app";
    expect(buildApplyUrl("pos123", "https://internal-proxy.local")).toBe(
      "https://hirelab.app/apply/pos123"
    );
  });

  it("falls back to the request origin when NEXT_PUBLIC_APP_URL isn't set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(buildApplyUrl("pos123", "https://hirelab.example.com")).toBe(
      "https://hirelab.example.com/apply/pos123"
    );
  });

  it("strips a trailing slash from the base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.app/";
    expect(buildApplyUrl("pos123", "https://x.com")).toBe("https://hirelab.app/apply/pos123");
  });
});
