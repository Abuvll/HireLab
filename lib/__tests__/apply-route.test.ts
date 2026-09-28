import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A transient queue/Redis outage must not turn a candidate's submission into a failed request: the application
// row is already safely committed by the time enqueueAnalysis runs, and losing the HTTP response at that point
// would also discard the resume upload that already succeeded. See app/api/apply/[positionId]/route.ts.
vi.mock("../jobs/queue", () => ({
  enqueueAnalysis: vi.fn(),
}));

import { enqueueAnalysis } from "../jobs/queue";
import { POST as applyRoute } from "../../app/api/apply/[positionId]/route";
import { prisma } from "../db";

let testDir: string;
const originalUploadsDir = process.env.UPLOADS_DIR;

const REAL_PDF_BYTES = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "hirelab-apply-route-test-"));
  process.env.UPLOADS_DIR = testDir;
  vi.mocked(enqueueAnalysis).mockReset();
});

afterEach(async () => {
  process.env.UPLOADS_DIR = originalUploadsDir;
  await rm(testDir, { recursive: true, force: true });
});

// Minimal real position + org, written directly with the test's own Prisma client — mirrors how the other route
// tests in this file set up fixtures (see upload-routes.test.ts) rather than going through the dashboard API.
async function seedOpenPosition(id: string) {
  const org = await prisma.organization.create({ data: { name: "Acme Test Co" } });
  await prisma.position.create({
    data: { id, organizationId: org.id, title: "Test Role", location: "Remote", description: "d", requirementChips: [], status: "OPEN" },
  });
}

function applyRequest(positionId: string, body: Record<string, unknown>, ip = "10.1.1.1"): NextRequest {
  return new NextRequest(`https://example.com/api/apply/${positionId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const validBody = (email: string) => ({
  fullName: "Jamie Applicant",
  contactMethod: "EMAIL",
  email,
  resumeUrl: "https://example.com/resume.pdf",
  coverLetterText: "I've spent the last three years building things I'm proud of.",
  githubUrl: "https://github.com/jamie",
});

describe("POST /api/apply/:positionId — resilience to a failed job-queue enqueue", () => {
  it("still returns 201 and creates the application when enqueueAnalysis throws (e.g. Redis unreachable)", async () => {
    const positionId = "pos-queue-down";
    await seedOpenPosition(positionId);
    vi.mocked(enqueueAnalysis).mockRejectedValue(new Error("REDIS_URL is not set"));

    const res = await applyRoute(applyRequest(positionId, validBody("queue-down@example.com")), { params: { positionId } });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applicationId).toBeDefined();

    const saved = await prisma.application.findUnique({ where: { id: body.applicationId } });
    expect(saved).toBeDefined();
    expect(saved?.email).toBe("queue-down@example.com");
  });

  it("still calls enqueueAnalysis (doesn't skip it just because it might fail)", async () => {
    const positionId = "pos-queue-called";
    await seedOpenPosition(positionId);
    vi.mocked(enqueueAnalysis).mockResolvedValue(undefined);

    await applyRoute(applyRequest(positionId, validBody("queue-called@example.com")), { params: { positionId } });

    expect(enqueueAnalysis).toHaveBeenCalledTimes(1);
  });

  it("a successful enqueue behaves exactly as before (no change for the common case)", async () => {
    const positionId = "pos-queue-ok";
    await seedOpenPosition(positionId);
    vi.mocked(enqueueAnalysis).mockResolvedValue(undefined);

    const res = await applyRoute(applyRequest(positionId, validBody("queue-ok@example.com")), { params: { positionId } });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("PROCESSING");
  });

  it("does NOT swallow a genuine validation error just because enqueueAnalysis is mocked to fail elsewhere", async () => {
    const positionId = "pos-queue-validation";
    await seedOpenPosition(positionId);
    vi.mocked(enqueueAnalysis).mockRejectedValue(new Error("should never be reached"));

    const res = await applyRoute(applyRequest(positionId, { ...validBody("bad@example.com"), coverLetterText: "short" }), { params: { positionId } });

    expect(res.status).toBe(400);
    expect(enqueueAnalysis).not.toHaveBeenCalled();
  });
});
