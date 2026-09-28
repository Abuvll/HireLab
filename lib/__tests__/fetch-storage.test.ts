import { describe, it, expect, vi, afterEach } from "vitest";
import { FetchFileStorage, FileDownloadError } from "../storage/fetch-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FetchFileStorage", () => {
  it("returns the response body as a Buffer on success", async () => {
    const bytes = new TextEncoder().encode("pdf bytes here").buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes }))
    );

    const storage = new FetchFileStorage();
    const buffer = await storage.download("https://files.example.com/resume.pdf");
    expect(buffer.toString()).toBe("pdf bytes here");
  });

  it("throws FileDownloadError on a non-OK HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })));

    const storage = new FetchFileStorage();
    await expect(storage.download("https://files.example.com/missing.pdf")).rejects.toThrow(
      FileDownloadError
    );
  });

  it("throws FileDownloadError when the network request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      })
    );

    const storage = new FetchFileStorage();
    await expect(storage.download("https://files.example.com/resume.pdf")).rejects.toThrow(
      FileDownloadError
    );
  });

  it("includes the status code in the error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) })));

    const storage = new FetchFileStorage();
    await expect(storage.download("https://files.example.com/resume.pdf")).rejects.toThrow(/403/);
  });

  it("attaches the internal worker token when downloading from this app's own origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.example.com";
    process.env.WORKER_INTERNAL_SECRET = "test-secret-value";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.stubGlobal("fetch", fetchMock);

    const storage = new FetchFileStorage();
    await storage.download("https://hirelab.example.com/api/uploads/abc123.pdf");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hirelab.example.com/api/uploads/abc123.pdf",
      { headers: { "X-Internal-Worker-Token": "test-secret-value" } }
    );

    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.WORKER_INTERNAL_SECRET;
  });

  it("never attaches the internal worker token when downloading from a different origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://hirelab.example.com";
    process.env.WORKER_INTERNAL_SECRET = "test-secret-value";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.stubGlobal("fetch", fetchMock);

    const storage = new FetchFileStorage();
    await storage.download("https://some-other-host.com/resume.pdf");

    expect(fetchMock).toHaveBeenCalledWith("https://some-other-host.com/resume.pdf", { headers: {} });

    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.WORKER_INTERNAL_SECRET;
  });
});
