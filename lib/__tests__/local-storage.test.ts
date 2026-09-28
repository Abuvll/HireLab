import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  saveLocalFile,
  readLocalFile,
  mimeTypeForExtension,
  InvalidUploadError,
  FileNotFoundError,
} from "../storage/local-storage";

let testDir: string;
const originalUploadsDir = process.env.UPLOADS_DIR;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "hirelab-uploads-test-"));
  process.env.UPLOADS_DIR = testDir;
});

afterEach(async () => {
  process.env.UPLOADS_DIR = originalUploadsDir;
  await rm(testDir, { recursive: true, force: true });
});

describe("saveLocalFile / readLocalFile round-trip", () => {
  it("saves a PDF and reads the same bytes back", async () => {
    const original = Buffer.from("fake pdf bytes for testing");
    const storedName = await saveLocalFile(original, "resume.pdf");
    expect(storedName).toMatch(/\.pdf$/);

    const readBack = await readLocalFile(storedName);
    expect(readBack.equals(original)).toBe(true);
  });

  it("saves a DOCX and reads the same bytes back", async () => {
    const original = Buffer.from("fake docx bytes for testing");
    const storedName = await saveLocalFile(original, "resume.docx");
    expect(storedName).toMatch(/\.docx$/);

    const readBack = await readLocalFile(storedName);
    expect(readBack.equals(original)).toBe(true);
  });

  it("never reuses the client-supplied filename as the stored path", async () => {
    const storedName = await saveLocalFile(Buffer.from("x"), "resume.pdf");
    expect(storedName).not.toBe("resume.pdf");
  });

  it("rejects unsupported file extensions", async () => {
    await expect(saveLocalFile(Buffer.from("x"), "resume.exe")).rejects.toThrow(InvalidUploadError);
  });

  it("rejects files with no extension", async () => {
    await expect(saveLocalFile(Buffer.from("x"), "resume")).rejects.toThrow(InvalidUploadError);
  });

  it("throws FileNotFoundError for a filename that was never saved", async () => {
    await expect(readLocalFile("00000000-0000-0000-0000-000000000000.pdf")).rejects.toThrow(
      FileNotFoundError
    );
  });

  it("rejects path traversal attempts even if the name looks otherwise valid", async () => {
    await expect(readLocalFile("../../etc/passwd")).rejects.toThrow(InvalidUploadError);
    await expect(readLocalFile("..%2f..%2fetc%2fpasswd.pdf")).rejects.toThrow(InvalidUploadError);
  });

  it("rejects a filename containing a forward slash", async () => {
    await expect(readLocalFile("sub/dir.pdf")).rejects.toThrow(InvalidUploadError);
  });

  it("generates distinct filenames for two uploads of the same original name", async () => {
    const name1 = await saveLocalFile(Buffer.from("a"), "resume.pdf");
    const name2 = await saveLocalFile(Buffer.from("b"), "resume.pdf");
    expect(name1).not.toBe(name2);
  });
});

describe("mimeTypeForExtension", () => {
  it("returns application/pdf for .pdf", () => {
    expect(mimeTypeForExtension("abc123.pdf")).toBe("application/pdf");
  });
  it("returns the docx mime type for .docx", () => {
    expect(mimeTypeForExtension("abc123.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });
  it("falls back to octet-stream for unknown extensions", () => {
    expect(mimeTypeForExtension("abc123.xyz")).toBe("application/octet-stream");
  });
});
