import { createHash, createHmac } from "node:crypto";

export type SignS3RequestParams = {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  /** The request body; use an empty string/buffer for GET and DELETE. */
  payload: Uint8Array | string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Injectable for tests; defaults to the current time. */
  now?: Date;
};

export type SignedS3Request = {
  headers: Record<string, string>;
  /** The URL to request: the path is percent-encoded exactly the way it was signed. */
  url: string;
  signature: string;
};

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding as AWS requires it: everything except A-Z a-z 0-9 - _ . ~ is percent-encoded. */
export function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalPath(url: URL): string {
  // S3 does not double-encode: decode each segment of the (already parsed) path once, then encode it the AWS way.
  return url.pathname
    .split("/")
    .map((segment) => awsEncode(decodeURIComponent(segment)))
    .join("/");
}

export function signS3Request(params: SignS3RequestParams): SignedS3Request {
  const { method, url, payload, accessKeyId, secretAccessKey, region } = params;
  const now = params.now ?? new Date();

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  // Header names lower-cased; values trimmed. Everything in this map is signed.
  const toSign: Record<string, string> = { host: url.host };
  for (const [name, value] of Object.entries(params.headers ?? {})) toSign[name.toLowerCase()] = value.trim();
  toSign["x-amz-content-sha256"] = payloadHash;
  toSign["x-amz-date"] = amzDate;

  const names = Object.keys(toSign).sort();
  const canonicalHeaders = names.map((n) => `${n}:${toSign[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const path = canonicalPath(url);

  const canonicalRequest = [method.toUpperCase(), path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const headers: Record<string, string> = {};
  for (const n of names) if (n !== "host") headers[n] = toSign[n];
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, url: `${url.origin}${path}${url.search}`, signature };
}
