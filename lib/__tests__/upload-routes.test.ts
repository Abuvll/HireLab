import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { POST as uploadRoute } from "../../app/api/apply/[positionId]/upload/route";
import { GET as serveRoute } from "../../app/api/uploads/[filename]/route";

let testDir: string;
const originalUploadsDir = process.env.UPLOADS_DIR;

// A minimal-but-real PDF: real magic bytes so lib/security/file-type.ts's
// content-sniffing (not just extension) genuinely accepts it — this is
// what §3.17's "validate by content-sniffing, not just extension" means
// in practice for these tests.
const REAL_PDF_BYTES = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";

const INTERNAL_SECRET = "test-worker-secret";

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "hirelab-upload-route-test-"));
  process.env.UPLOADS_DIR = testDir;
  process.env.WORKER_INTERNAL_SECRET = INTERNAL_SECRET;
});

afterEach(async () => {
  process.env.UPLOADS_DIR = originalUploadsDir;
  delete process.env.WORKER_INTERNAL_SECRET;
  await rm(testDir, { recursive: true, force: true });
});

function makeUploadRequest(fileContent: string, filename: string, fieldName = "file"): NextRequest {
  const formData = new FormData();
  const file = new File([fileContent], filename, { type: "application/pdf" });
  formData.append(fieldName, file);
  return new NextRequest("https://example.com/api/apply/pos1/upload", {
    method: "POST",
    body: formData,
    headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` }, // spread across rate-limit buckets
  });
}

function makeServeRequest(url: string): NextRequest {
  // Using the internal-worker-token bypass rather than a real session
  // cookie/JWT — simpler to construct in a unit test, and exercises the
  // same authorization branch the background worker actually uses (see
  // lib/storage/fetch-storage.ts).
  return new NextRequest(url, { headers: { "x-internal-worker-token": INTERNAL_SECRET } });
}

describe("upload -> serve round trip", () => {
  it("uploads a real PDF and serves the identical bytes back at the returned URL", async () => {
    const req = makeUploadRequest(REAL_PDF_BYTES, "resume.pdf");
    const uploadRes = await uploadRoute(req, { params: { positionId: "pos1" } });
    expect(uploadRes.status).toBe(201);

    const { url } = await uploadRes.json();
    expect(url).toContain("/api/uploads/");

    const filename = url.split("/api/uploads/")[1];
    const serveRes = await serveRoute(makeServeRequest(url), { params: { filename } });
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("content-type")).toBe("application/pdf");

    const bytes = await serveRes.text();
    expect(bytes).toBe(REAL_PDF_BYTES);
  });

  it("rejects an upload with no file field", async () => {
    const formData = new FormData();
    const req = new NextRequest("https://example.com/api/apply/pos1/upload", {
      method: "POST",
      body: formData,
    });
    const res = await uploadRoute(req, { params: { positionId: "pos1" } });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported file extension", async () => {
    const req = makeUploadRequest("exe content", "malware.exe");
    const res = await uploadRoute(req, { params: { positionId: "pos1" } });
    expect(res.status).toBe(400);
  });

  it("rejects a file with a .pdf extension whose content isn't actually a PDF (spoofed extension)", async () => {
    const req = makeUploadRequest("just plain text, not a real pdf", "resume.pdf");
    const res = await uploadRoute(req, { params: { positionId: "pos1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/doesn't look like a valid/i);
  });

  it("serving requires either a session or the internal worker token — plain requests are rejected", async () => {
    const req = makeUploadRequest(REAL_PDF_BYTES, "resume.pdf");
    const uploadRes = await uploadRoute(req, { params: { positionId: "pos1" } });
    const { url } = await uploadRes.json();
    const filename = url.split("/api/uploads/")[1];

    const unauthedReq = new NextRequest(url); // no cookie, no internal token
    const res = await serveRoute(unauthedReq, { params: { filename } });
    expect(res.status).toBe(401);
  });

  it("returns 404 when serving a filename that was never uploaded", async () => {
    const filename = "00000000-0000-0000-0000-000000000000.pdf";
    const req = makeServeRequest(`https://example.com/api/uploads/${filename}`);
    const res = await serveRoute(req, { params: { filename } });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a path-traversal filename rather than leaking filesystem contents", async () => {
    const req = makeServeRequest("https://example.com/api/uploads/x");
    const res = await serveRoute(req, { params: { filename: "../../../etc/passwd" } });
    expect(res.status).toBe(400);
  });

  it("two uploads of the same original filename get different stored URLs", async () => {
    const req1 = makeUploadRequest(REAL_PDF_BYTES, "resume.pdf");
    const req2 = makeUploadRequest(REAL_PDF_BYTES.replace("1.4", "1.5"), "resume.pdf");
    const res1 = await uploadRoute(req1, { params: { positionId: "pos1" } });
    const res2 = await uploadRoute(req2, { params: { positionId: "pos1" } });
    const { url: url1 } = await res1.json();
    const { url: url2 } = await res2.json();
    expect(url1).not.toBe(url2);
  });
});
