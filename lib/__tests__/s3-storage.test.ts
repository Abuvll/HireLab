import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveS3File,
  readS3File,
  deleteS3File,
  getS3Config,
  S3ConfigError,
  S3RequestError,
} from "../storage/s3-storage";
import { FileNotFoundError, InvalidUploadError } from "../storage/local-storage";

// fetch is replaced by hand (no network is touched): every request the driver makes is recorded and answered
// by the handler a test installs.

type Call = { url: string; init: RequestInit };

const ENV_KEYS = [
  "STORAGE_DRIVER", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE", "S3_KEY_PREFIX", "S3_ALLOW_HTTP",
];
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let calls: Call[] = [];

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

async function failure(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

beforeEach(() => {
  calls = [];
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.S3_ENDPOINT = "https://s3.example.com";
  process.env.S3_REGION = "eu-west-1";
  process.env.S3_BUCKET = "hirelab-bucket";
  process.env.S3_ACCESS_KEY_ID = "TESTKEY";
  process.env.S3_SECRET_ACCESS_KEY = "TESTSECRET";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const PDF = Buffer.from("%PDF-1.4 fake resume bytes");

describe("getS3Config", () => {
  it("names every missing variable", () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_SECRET_ACCESS_KEY;
    expect(() => getS3Config()).toThrow(S3ConfigError);
    expect(() => getS3Config()).toThrow("S3_BUCKET, S3_SECRET_ACCESS_KEY");
  });

  it("rejects an endpoint that is not a URL", () => {
    process.env.S3_ENDPOINT = "s3.example.com";
    expect(() => getS3Config()).toThrow("full URL");
  });

  it("refuses plain http:// to a remote host unless S3_ALLOW_HTTP=true; loopback is always allowed", () => {
    process.env.S3_ENDPOINT = "http://minio.internal:9000";
    expect(() => getS3Config()).toThrow("S3_ALLOW_HTTP");
    process.env.S3_ALLOW_HTTP = "true";
    expect(getS3Config().endpoint).toBe("http://minio.internal:9000");
    delete process.env.S3_ALLOW_HTTP;
    process.env.S3_ENDPOINT = "http://localhost:9000";
    expect(getS3Config().endpoint).toBe("http://localhost:9000");
  });

  it("defaults: region us-east-1, path-style on, no key prefix; normalizes the prefix", () => {
    delete process.env.S3_REGION;
    const cfg = getS3Config();
    expect(cfg.region).toBe("us-east-1");
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.keyPrefix).toBe("");
    process.env.S3_KEY_PREFIX = "/resumes";
    expect(getS3Config().keyPrefix).toBe("resumes/");
  });
});

describe("saveS3File", () => {
  it("PUTs the bytes to <endpoint>/<bucket>/<uuid>.pdf, signed with SigV4, and returns the bare file name", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const name = await saveS3File(PDF, "My Resume.PDF");

    expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(`https://s3.example.com/hirelab-bucket/${name}`);
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=TESTKEY\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(headers["content-type"]).toBe("application/pdf");
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe(PDF.toString());
    // the secret must never be sent
    expect(JSON.stringify(headers)).not.toContain("TESTSECRET");
  });

  it("stores docx with the Word content type", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const name = await saveS3File(Buffer.from("PK"), "cv.docx");
    expect(name).toMatch(/\.docx$/);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("puts objects under S3_KEY_PREFIX but still returns the bare file name", async () => {
    process.env.S3_KEY_PREFIX = "resumes";
    stubFetch(() => new Response(null, { status: 200 }));
    const name = await saveS3File(PDF, "a.pdf");
    expect(calls[0].url).toBe(`https://s3.example.com/hirelab-bucket/resumes/${name}`);
    expect(name.includes("/")).toBe(false);
  });

  it("keeps a path prefix on the endpoint (some providers expose S3 under e.g. /storage/v1/s3)", async () => {
    process.env.S3_ENDPOINT = "https://proj.example.com/storage/v1/s3/";
    stubFetch(() => new Response(null, { status: 200 }));
    const name = await saveS3File(PDF, "a.pdf");
    expect(calls[0].url).toBe(`https://proj.example.com/storage/v1/s3/hirelab-bucket/${name}`);
  });

  it("supports virtual-hosted style (S3_FORCE_PATH_STYLE=false)", async () => {
    process.env.S3_FORCE_PATH_STYLE = "false";
    stubFetch(() => new Response(null, { status: 200 }));
    const name = await saveS3File(PDF, "a.pdf");
    expect(calls[0].url).toBe(`https://hirelab-bucket.s3.example.com/${name}`);
  });

  it("rejects unsupported extensions before any network call", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const err = await failure(() => saveS3File(PDF, "payload.exe"));
    expect(err).toBeInstanceOf(InvalidUploadError);
    expect(calls).toHaveLength(0);
  });

  it("turns a 403 into a clear permissions error and does not leak the secret", async () => {
    stubFetch(() => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }));
    const err = await failure(() => saveS3File(PDF, "a.pdf"));
    expect(err).toBeInstanceOf(S3RequestError);
    expect(err.message).toContain("status 403");
    expect(err.message).toContain("access denied");
    expect(err.message).toContain("AccessDenied");
    expect(err.message).not.toContain("TESTSECRET");
  });

  it("wraps network failures", async () => {
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND s3.example.com");
    });
    const err = await failure(() => saveS3File(PDF, "a.pdf"));
    expect(err).toBeInstanceOf(S3RequestError);
    expect(err.message).toContain("Could not reach the object storage endpoint");
  });
});

describe("readS3File", () => {
  it("GETs <endpoint>/<bucket>/<file> and returns the bytes", async () => {
    stubFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const bytes = await readS3File("abc.pdf");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls[0].url).toBe("https://s3.example.com/hirelab-bucket/abc.pdf");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("maps 404 to FileNotFoundError", async () => {
    stubFetch(() => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }));
    expect(await failure(() => readS3File("missing.pdf"))).toBeInstanceOf(FileNotFoundError);
  });

  it("surfaces other failures as S3RequestError", async () => {
    stubFetch(() => new Response("oops", { status: 500 }));
    const err = await failure(() => readS3File("abc.pdf"));
    expect(err).toBeInstanceOf(S3RequestError);
    expect(err.message).toContain("status 500");
  });

  it("rejects path traversal without a network call", async () => {
    stubFetch(() => new Response("x", { status: 200 }));
    for (const bad of ["../secret.pdf", "a/b.pdf", "a\\b.pdf"]) {
      expect(await failure(() => readS3File(bad))).toBeInstanceOf(InvalidUploadError);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("deleteS3File", () => {
  it("DELETEs the object, and a missing object is not an error", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await deleteS3File("abc.pdf");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe("https://s3.example.com/hirelab-bucket/abc.pdf");

    stubFetch(() => new Response("gone", { status: 404 }));
    await deleteS3File("abc.pdf");
  });
});
