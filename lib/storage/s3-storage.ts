import { randomUUID } from "node:crypto";
import {
  extensionForUpload,
  assertSafeStoredFilename,
  mimeTypeForExtension,
  FileNotFoundError,
} from "./local-storage";
import { signS3Request } from "./s3-signer";

const REQUEST_TIMEOUT_MS = 30_000;

export type S3Config = {
  endpoint: string; // no trailing slash, e.g. https://<account>.r2.cloudflarestorage.com (a path prefix is kept)
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  keyPrefix: string;
};

export class S3ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "S3ConfigError";
  }
}

export class S3RequestError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "S3RequestError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function getS3Config(env: NodeJS.ProcessEnv = process.env): S3Config {
  const required = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new S3ConfigError(`STORAGE_DRIVER=s3 requires these environment variables: ${missing.join(", ")}`);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(env.S3_ENDPOINT as string);
  } catch {
    throw new S3ConfigError("S3_ENDPOINT must be a full URL such as https://s3.us-east-1.amazonaws.com");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new S3ConfigError("S3_ENDPOINT must start with https:// (or http:// for a private network)");
  }
  if (endpoint.protocol === "http:" && !LOOPBACK_HOSTS.has(endpoint.hostname) && env.S3_ALLOW_HTTP !== "true") {
    throw new S3ConfigError(
      "S3_ENDPOINT uses plain http://. Use https://, or set S3_ALLOW_HTTP=true if the endpoint is on a private network you trust."
    );
  }

  const prefix = (env.S3_KEY_PREFIX ?? "").replace(/^\/+/, "");
  return {
    // Keep a path prefix if the provider's S3 endpoint has one (e.g. https://host/storage/v1/s3).
    endpoint: endpoint.origin + endpoint.pathname.replace(/\/+$/, ""),
    region: env.S3_REGION || "us-east-1",
    bucket: env.S3_BUCKET as string,
    accessKeyId: env.S3_ACCESS_KEY_ID as string,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
    // Path-style (endpoint/bucket/key) works on every S3-compatible service; set S3_FORCE_PATH_STYLE=false for
    // virtual-hosted style (bucket.endpoint/key).
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
    keyPrefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix,
  };
}

function objectUrl(cfg: S3Config, key: string): URL {
  if (cfg.forcePathStyle) {
    return new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
  }
  const endpoint = new URL(cfg.endpoint);
  return new URL(`${endpoint.protocol}//${cfg.bucket}.${endpoint.host}${endpoint.pathname.replace(/\/+$/, "")}/${key}`);
}

async function s3Request(
  cfg: S3Config,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body?: Buffer,
  contentType?: string
): Promise<Response> {
  const payload = body ?? "";
  const signed = signS3Request({
    method,
    url: objectUrl(cfg, key),
    headers: contentType ? { "content-type": contentType } : undefined,
    payload,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
  });

  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new S3RequestError(`Could not reach the object storage endpoint: ${(err as Error).message}`);
  }
}

async function describeFailure(res: Response, action: string): Promise<S3RequestError> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // ignore: the status code alone is enough
  }
  const hint =
    res.status === 403
      ? " (access denied: check the access key, its permissions on the bucket, and S3_REGION)"
      : "";
  return new S3RequestError(`Object storage ${action} failed with status ${res.status}${hint}${detail ? `: ${detail}` : ""}`, res.status);
}

export async function saveS3File(buffer: Buffer, originalFilename: string): Promise<string> {
  const ext = extensionForUpload(originalFilename); // validates before any network call
  const cfg = getS3Config();
  const storedFilename = `${randomUUID()}${ext}`;

  const res = await s3Request(cfg, "PUT", `${cfg.keyPrefix}${storedFilename}`, buffer, mimeTypeForExtension(storedFilename));
  if (!res.ok) throw await describeFailure(res, "upload");
  return storedFilename;
}

export async function readS3File(filename: string): Promise<Buffer> {
  assertSafeStoredFilename(filename);
  const cfg = getS3Config();

  const res = await s3Request(cfg, "GET", `${cfg.keyPrefix}${filename}`);
  if (res.status === 404) throw new FileNotFoundError(filename);
  if (!res.ok) throw await describeFailure(res, "download");
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteS3File(filename: string): Promise<void> {
  assertSafeStoredFilename(filename);
  const cfg = getS3Config();

  const res = await s3Request(cfg, "DELETE", `${cfg.keyPrefix}${filename}`);
  if (!res.ok && res.status !== 404) throw await describeFailure(res, "delete");
}
