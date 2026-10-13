import { saveLocalFile, readLocalFile, deleteLocalFile } from "./local-storage";
import { saveS3File, readS3File, deleteS3File } from "./s3-storage";

// One entry point for uploaded resumes. The backend is chosen with STORAGE_DRIVER:
//   local (default)  files on this machine's disk, in UPLOADS_DIR (default ./uploads) — needs a persistent disk
//   s3               any S3-compatible object store — works on hosts whose filesystem is ephemeral
// Callers get back the same "<uuid>.<ext>" name either way, so upload URLs and the worker's download flow
// (see lib/storage/fetch-storage.ts) are identical for both drivers.

export { InvalidUploadError, FileNotFoundError, mimeTypeForExtension } from "./local-storage";

export type StorageDriver = "local" | "s3";

export function getStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const value = (env.STORAGE_DRIVER || "local").trim().toLowerCase();
  if (value === "local" || value === "s3") return value;
  throw new Error(`Unsupported STORAGE_DRIVER "${env.STORAGE_DRIVER}". Use "local" or "s3".`);
}

let warnedAboutLocalDisk = false;

function warnOnceIfLocalDiskInProduction(): void {
  if (warnedAboutLocalDisk || process.env.NODE_ENV !== "production") return;
  warnedAboutLocalDisk = true;
  console.warn(
    "[storage] Resumes are stored on local disk. This is only safe if UPLOADS_DIR is on a persistent volume; " +
      "on hosts with an ephemeral filesystem they are lost on every restart. Set STORAGE_DRIVER=s3 to use object storage."
  );
}

export async function saveUpload(buffer: Buffer, originalFilename: string): Promise<string> {
  if (getStorageDriver() === "s3") return saveS3File(buffer, originalFilename);
  warnOnceIfLocalDiskInProduction();
  return saveLocalFile(buffer, originalFilename);
}

export async function readUpload(filename: string): Promise<Buffer> {
  return getStorageDriver() === "s3" ? readS3File(filename) : readLocalFile(filename);
}

export async function deleteUpload(filename: string): Promise<void> {
  return getStorageDriver() === "s3" ? deleteS3File(filename) : deleteLocalFile(filename);
}
