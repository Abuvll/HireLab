import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApplyUrl, getPublicBaseUrl, isOwnUploadUrl } from "../api/urls";

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

describe("getPublicBaseUrl", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });

  it("prefers NEXT_PUBLIC_APP_URL over the request origin (e.g. an internal proxy host)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.example";
    expect(getPublicBaseUrl("http://localhost:10000")).toBe("https://hirelab.example");
  });

  it("falls back to the request origin when it isn't set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(getPublicBaseUrl("https://hirelab.example.com")).toBe("https://hirelab.example.com");
  });

  it("strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.example/";
    expect(getPublicBaseUrl("http://x")).toBe("https://hirelab.example");
  });

  it("reads the variable at call time (changing it on a running process takes effect)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://one.example";
    expect(getPublicBaseUrl("http://x")).toBe("https://one.example");
    process.env.NEXT_PUBLIC_APP_URL = "https://two.example";
    expect(getPublicBaseUrl("http://x")).toBe("https://two.example");
  });
});

describe("isOwnUploadUrl — only files our upload endpoint issued may be used as a resume", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;
  const ID = "5b1e0c52-8c0e-4c1a-9a53-0f3d7a2f6b11";
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });

  it("accepts <public base>/api/uploads/<uuid>.pdf and .docx", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.app";
    expect(isOwnUploadUrl(`https://hirelab.app/api/uploads/${ID}.pdf`, "http://internal:3000")).toBe(true);
    expect(isOwnUploadUrl(`https://hirelab.app/api/uploads/${ID}.docx`, "http://internal:3000")).toBe(true);
  });

  it("uses the request origin when NEXT_PUBLIC_APP_URL isn't set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(isOwnUploadUrl(`http://localhost:3000/api/uploads/${ID}.pdf`, "http://localhost:3000")).toBe(true);
    expect(isOwnUploadUrl(`http://localhost:3001/api/uploads/${ID}.pdf`, "http://localhost:3000")).toBe(false);
  });

  it("refuses other hosts, the request's internal origin when a public one is configured, and look-alike hosts", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.app";
    expect(isOwnUploadUrl(`https://evil.example/api/uploads/${ID}.pdf`, "https://hirelab.app")).toBe(false);
    expect(isOwnUploadUrl(`http://internal:3000/api/uploads/${ID}.pdf`, "http://internal:3000")).toBe(false);
    expect(isOwnUploadUrl(`https://hirelab.app.evil.example/api/uploads/${ID}.pdf`, "https://hirelab.app")).toBe(false);
    expect(isOwnUploadUrl(`https://hirelab.app@evil.example/api/uploads/${ID}.pdf`, "https://hirelab.app")).toBe(false);
    expect(isOwnUploadUrl(`https://user:pw@hirelab.app/api/uploads/${ID}.pdf`, "https://hirelab.app")).toBe(false);
  });

  it("refuses other paths, other file types, odd names, queries and fragments", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.app";
    for (const path of ["/api/auth/logout", "/api/uploads/", "/api/uploads/resume.pdf", `/api/uploads/${ID}.exe`, `/api/uploads/${ID}.pdf/extra`, `/api/uploads/../auth/me`, `/api/uploads/%2e%2e/x`, `/resume.pdf`]) {
      expect(isOwnUploadUrl(`https://hirelab.app${path}`, "https://hirelab.app")).toBe(false);
    }
    expect(isOwnUploadUrl(`https://hirelab.app/api/uploads/${ID}.pdf?x=1`, "https://hirelab.app")).toBe(false);
    expect(isOwnUploadUrl(`https://hirelab.app/api/uploads/${ID}.pdf#frag`, "https://hirelab.app")).toBe(false);
  });

  it("refuses things that aren't URLs", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.app";
    for (const v of ["", "not a url", "javascript:alert(1)", "data:application/pdf;base64,AAAA", "file:///etc/passwd"]) expect(isOwnUploadUrl(v, "https://hirelab.app")).toBe(false);
  });

  it("works on a sub-path deployment", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com/hirelab";
    expect(isOwnUploadUrl(`https://example.com/hirelab/api/uploads/${ID}.pdf`, "http://internal")).toBe(true);
    expect(isOwnUploadUrl(`https://example.com/api/uploads/${ID}.pdf`, "http://internal")).toBe(false);
  });
});
