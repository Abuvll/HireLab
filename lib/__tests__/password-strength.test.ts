import { describe, it, expect } from "vitest";
import { checkPasswordStrength } from "../security/password-strength";

describe("checkPasswordStrength", () => {
  it("accepts a reasonable password", () => {
    expect(checkPasswordStrength("correct-horse-battery").valid).toBe(true);
  });

  it("rejects anything under 8 characters, regardless of what the caller already checked", () => {
    const result = checkPasswordStrength("short1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 8/);
  });

  it("rejects a single repeated character even if it's long enough", () => {
    const result = checkPasswordStrength("aaaaaaaaaaaa");
    expect(result.valid).toBe(false);
  });

  it("rejects common passwords", () => {
    expect(checkPasswordStrength("password123").valid).toBe(false);
    expect(checkPasswordStrength("PASSWORD123").valid).toBe(false); // case-insensitive
  });

  it("accepts a long passphrase with no special characters (length over arbitrary complexity)", () => {
    expect(checkPasswordStrength("mycatlikestositonthekeyboard").valid).toBe(true);
  });
});
