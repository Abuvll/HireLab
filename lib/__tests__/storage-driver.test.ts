import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getStorageDriver, saveUpload, readUpload, deleteUpload, FileNotFoundError } from "../storage";

const ENV_KEYS = ["STORAGE_DRIVER", "UPLOADS_DIR", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_KEY_PREFIX", "S3_FORCE_PATH_STYLE", "S3_ALLOW_HTTP"];
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let testDir: string;
let methods: string[] = [];

beforeEach(async () => {
  methods = [];
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  testDir = await mkdtemp(join(tmpdir(), "hirelab-storage-driver-test-"));
  process.env.UPLOADS_DIR = testDir;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await rm(testDir, { recursive: true, force: true });
});

function useS3() {
  process.env.STORAGE_DRIVER = "s3";
  process.env.S3_ENDPOINT = "https://s3.example.com";
  process.env.S3_BUCKET = "b";
  process.env.S3_ACCESS_KEY_ID = "k";
  process.env.S3_SECRET_ACCESS_KEY = "s";
  const objects = new Map<string, Uint8Array>();
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const key = new URL(String(url)).pathname; // /b/<file>
    methods.push(`${init?.method} ${key.split("/").pop()}`);
    if (init?.method === "PUT") { objects.set(key, new Uint8Array(init.body as Uint8Array)); return new Response(null, { status: 200 }); }
    if (init?.method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
    const found = objects.get(key);
    return found ? new Response(new Uint8Array(found), { status: 200 }) : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("getStorageDriver", () => {
  it("defaults to local", () => {
    expect(getStorageDriver()).toBe("local");
  });

  it("accepts s3 (case-insensitive) and local", () => {
    expect(getStorageDriver({ STORAGE_DRIVER: "S3" } as NodeJS.ProcessEnv)).toBe("s3");
    expect(getStorageDriver({ STORAGE_DRIVER: " local " } as NodeJS.ProcessEnv)).toBe("local");
  });

  it("rejects anything else with a clear message", () => {
    expect(() => getStorageDriver({ STORAGE_DRIVER: "gcs" } as NodeJS.ProcessEnv)).toThrow('Use "local" or "s3"');
  });
});

describe("saveUpload / readUpload / deleteUpload", () => {
  it("local driver: round-trips through UPLOADS_DIR and deletes", async () => {
    const name = await saveUpload(Buffer.from("local bytes"), "r.pdf");
    expect((await readdir(testDir)).includes(name)).toBe(true);
    expect((await readUpload(name)).toString()).toBe("local bytes");
    await deleteUpload(name);
    expect((await readdir(testDir)).includes(name)).toBe(false);
  });

  it("s3 driver: round-trips through the object store and writes nothing to local disk", async () => {
    useS3();
    const name = await saveUpload(Buffer.from("s3 bytes"), "r.pdf");
    expect((await readdir(testDir)).length).toBe(0);
    expect((await readUpload(name)).toString()).toBe("s3 bytes");
    await deleteUpload(name);
    let missing: Error | null = null;
    try { await readUpload(name); } catch (e) { missing = e as Error; }
    expect(missing).toBeInstanceOf(FileNotFoundError);
    expect(methods.map((m) => m.split(" ")[0]).join(",")).toBe("PUT,GET,DELETE,GET");
  });
});
