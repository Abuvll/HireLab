import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx"]);

export class InvalidUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUploadError";
  }
}

export class FileNotFoundError extends Error {
  constructor(filename: string) {
    super(`Uploaded file not found: ${filename}`);
    this.name = "FileNotFoundError";
  }
}

/** Validates the extension of an uploaded file's original name and returns it (lower-case, with the dot). */
export function extensionForUpload(originalFilename: string): string {
  const ext = extname(originalFilename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new InvalidUploadError(
      `Unsupported file extension: ${ext || "(none)"}. Only .pdf and .docx are accepted.`
    );
  }
  return ext;
}

/** Rejects stored file names that could escape the storage location (path traversal). */
export function assertSafeStoredFilename(filename: string): void {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new InvalidUploadError("Invalid filename");
  }
}

function getUploadsDir(): string {
  return process.env.UPLOADS_DIR || join(process.cwd(), "uploads");
}


export async function saveLocalFile(buffer: Buffer, originalFilename: string): Promise<string> {
  const ext = extensionForUpload(originalFilename);

  const dir = getUploadsDir();
  await mkdir(dir, { recursive: true });

  const storedFilename = `${randomUUID()}${ext}`;
  await writeFile(join(dir, storedFilename), buffer);

  return storedFilename;
}

export async function readLocalFile(filename: string): Promise<Buffer> {
  assertSafeStoredFilename(filename);
  try {
    return await readFile(join(getUploadsDir(), filename));
  } catch {
    throw new FileNotFoundError(filename);
  }
}


export async function deleteLocalFile(filename: string): Promise<void> {
  assertSafeStoredFilename(filename);
  try {
    await unlink(join(getUploadsDir(), filename));
  } catch {
    // already gone — deleting is idempotent
  }
}

export function mimeTypeForExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}
