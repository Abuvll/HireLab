import type { FileStorage } from "../jobs/types";

export class FileDownloadError extends Error {
  constructor(url: string, public readonly statusCode?: number, cause?: unknown) {
    super(`Failed to download file at ${url}${statusCode ? ` (status ${statusCode})` : ""}`);
    this.name = "FileDownloadError";
    this.cause = cause;
  }
}
function isOwnOrigin(url: string): boolean {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return false;
  try {
    return new URL(url).origin === new URL(configured).origin;
  } catch {
    return false;
  }
}

export class FetchFileStorage implements FileStorage {
  async download(url: string): Promise<Buffer> {
    const headers: Record<string, string> = {};
    const secret = process.env.WORKER_INTERNAL_SECRET;
    if (secret && isOwnOrigin(url)) {
      headers["X-Internal-Worker-Token"] = secret;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (err) {
      throw new FileDownloadError(url, undefined, err);
    }

    if (!response.ok) {
      throw new FileDownloadError(url, response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
