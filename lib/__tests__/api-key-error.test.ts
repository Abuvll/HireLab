import { describe, it, expect, vi } from "vitest";
import {
  API_KEY_ERROR_CODE,
  API_KEY_ERROR_REASONS,
  API_KEY_ERROR_STATUS,
  ApiKeyError,
  apiKeyErrorMessage,
  assertOrgApiKeyUsable,
  classifyProviderKeyFailure,
  type ApiKeyErrorReason,
  type OrgKeyGuardDeps,
} from "../api/api-key-error";
import { ApiError, badRequest, errorResponse } from "../api/errors";
import { DecryptionError, EncryptionConfigError } from "../security/encryption";
import type { LiteLLMKeyCheck } from "../extraction/litellm-client";

describe("ApiKeyError / errorResponse — the wire contract the dashboard relies on", () => {
  it("is an ApiError with a status that is neither 401 (session expired) nor 403 (role denied)", () => {
    const err = new ApiKeyError("invalid");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(API_KEY_ERROR_STATUS);
    expect(err.status).not.toBe(401);
    expect(err.status).not.toBe(403);
  });

  it("serialises as { error, code: 'API_KEY_ERROR', reason } via errorResponse", async () => {
    const res = errorResponse(new ApiKeyError("expired"));
    expect(res.status).toBe(API_KEY_ERROR_STATUS);
    const body = await res.json();
    expect(body.code).toBe("API_KEY_ERROR");
    expect(body.reason).toBe("expired");
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("expired");
  });

  it("errorResponse leaves ordinary ApiErrors exactly as before (only { error })", async () => {
    const res = errorResponse(badRequest("nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("extra fields can never overwrite the error message", async () => {
    const res = errorResponse(new ApiError(418, "real message", { error: "spoofed", code: "X" }));
    const body = await res.json();
    expect(body.error).toBe("real message");
    expect(body.code).toBe("X");
  });

  it("covers every reason the dashboard knows about", () => {
    expect([...API_KEY_ERROR_REASONS]).toEqual(["missing", "invalid", "expired", "revoked", "rejected", "model_unavailable"]);
    expect(API_KEY_ERROR_CODE).toBe("API_KEY_ERROR");
  });
});

describe("apiKeyErrorMessage", () => {
  it("every message is short and never looks like it contains a key", () => {
    for (const reason of API_KEY_ERROR_REASONS) {
      for (const canManage of [true, false]) {
        const msg = apiKeyErrorMessage(reason, canManage);
        expect(msg.length).toBeLessThanOrEqual(240);
        expect(/sk-[A-Za-z0-9_-]{8,}/.test(msg)).toBe(false);
        expect(/[A-Za-z0-9_\-+/=]{30,}/.test(msg)).toBe(false); // no long unbroken token
      }
    }
  });

  it("points people who can manage the key to Settings → API Keys", () => {
    expect(apiKeyErrorMessage("revoked", true)).toContain("Settings → API Keys");
    expect(apiKeyErrorMessage("revoked", true)).toContain("revoked");
  });

  it("points everyone else at an Owner or Admin instead of a screen they can't use", () => {
    const msg = apiKeyErrorMessage("missing", false);
    expect(msg).toContain("Owner or Admin");
    expect(msg).not.toContain("then try again");
  });

  it("ApiKeyError honours canManage", () => {
    expect(new ApiKeyError("missing", { canManage: false }).message).toContain("Owner or Admin");
    expect(new ApiKeyError("missing").message).toContain("Update it");
  });
});

describe("classifyProviderKeyFailure", () => {
  it("401 defaults to invalid", () => {
    expect(classifyProviderKeyFailure(401)).toBe("invalid");
    expect(classifyProviderKeyFailure(401, "No auth credentials found")).toBe("invalid");
  });

  it("401 uses the provider's wording to tell expired and revoked apart", () => {
    expect(classifyProviderKeyFailure(401, "This key has expired")).toBe("expired");
    expect(classifyProviderKeyFailure(401, "API key was revoked")).toBe("revoked");
    expect(classifyProviderKeyFailure(401, "Key disabled by owner")).toBe("revoked");
    expect(classifyProviderKeyFailure(401, "User not found.")).toBe("revoked");
  });

  it("402 (no credit) and 403 (refused) are 'rejected'", () => {
    expect(classifyProviderKeyFailure(402)).toBe("rejected");
    expect(classifyProviderKeyFailure(403)).toBe("rejected");
  });

  it("statuses that say nothing about the key (or a model) are not classified", () => {
    for (const status of [400, 404, 408, 429, 500, 502, 503]) {
      expect(classifyProviderKeyFailure(status, "expired")).toBeNull();
    }
  });

  it("400/404 mentioning the model -> model_unavailable, so a bad model is caught proactively too, not just the key", () => {
    expect(classifyProviderKeyFailure(400, "The model `gpt-5-nonexistent` does not exist")).toBe("model_unavailable");
    expect(classifyProviderKeyFailure(404, "model not found")).toBe("model_unavailable");
  });

  it("400 that doesn't mention a model is left unclassified, not misread as model_unavailable", () => {
    expect(classifyProviderKeyFailure(400, "malformed request body")).toBeNull();
  });
});

describe("assertOrgApiKeyUsable", () => {
  function makeDeps(overrides: Partial<OrgKeyGuardDeps> = {}): OrgKeyGuardDeps {
    return {
      loadStoredKey: vi.fn(async () => ({ encryptedKey: "ciphertext", model: "anthropic/claude-3-5-sonnet-20241022" })),
      decrypt: vi.fn(() => "sk-ant-plaintext-key"),
      checkKey: vi.fn(async (): Promise<LiteLLMKeyCheck> => ({ outcome: "valid" })),
      ...overrides,
    };
  }
  async function reasonOf(promise: Promise<void>): Promise<ApiKeyErrorReason | "no error"> {
    try {
      await promise;
      return "no error";
    } catch (err) {
      if (err instanceof ApiKeyError) return err.reason;
      throw err;
    }
  }

  it("passes silently when the key exists and the provider accepts it", async () => {
    const deps = makeDeps();
    await expect(assertOrgApiKeyUsable("org1", { canManage: true }, deps)).resolves.toBeUndefined();
    expect(deps.loadStoredKey).toHaveBeenCalledWith("org1");
    // the DECRYPTED key, and the model it's stored alongside (LiteLLM has no key-only validation — see
    // lib/extraction/litellm-client.ts), is what's checked
    expect(deps.checkKey).toHaveBeenCalledWith("sk-ant-plaintext-key", "anthropic/claude-3-5-sonnet-20241022");
  });

  it("no stored key -> missing (and never calls the provider)", async () => {
    const deps = makeDeps({ loadStoredKey: vi.fn(async () => null) });
    expect(await reasonOf(assertOrgApiKeyUsable("org1", { canManage: true }, deps))).toBe("missing");
    expect(deps.checkKey).not.toHaveBeenCalled();
  });

  it("a stored key that can't be decrypted -> invalid", async () => {
    const deps = makeDeps({
      decrypt: vi.fn(() => {
        throw new DecryptionError("bad tag");
      }),
    });
    expect(await reasonOf(assertOrgApiKeyUsable("org1", { canManage: true }, deps))).toBe("invalid");
    expect(deps.checkKey).not.toHaveBeenCalled();
  });

  it("a server misconfiguration (missing ENCRYPTION_KEY) is NOT blamed on the org's key", async () => {
    const deps = makeDeps({
      decrypt: vi.fn(() => {
        throw new EncryptionConfigError("ENCRYPTION_KEY is not set");
      }),
    });
    await expect(assertOrgApiKeyUsable("org1", { canManage: true }, deps)).rejects.toBeInstanceOf(EncryptionConfigError);
  });

  it("provider 401 -> invalid; wording can refine it to expired / revoked", async () => {
    const check = (status: number, message?: string) =>
      makeDeps({ checkKey: vi.fn(async (): Promise<LiteLLMKeyCheck> => ({ outcome: "rejected", status, message })) });
    expect(await reasonOf(assertOrgApiKeyUsable("o", { canManage: true }, check(401)))).toBe("invalid");
    expect(await reasonOf(assertOrgApiKeyUsable("o", { canManage: true }, check(401, "key expired")))).toBe("expired");
    expect(await reasonOf(assertOrgApiKeyUsable("o", { canManage: true }, check(401, "revoked")))).toBe("revoked");
  });

  it("provider 402 / 403 -> rejected", async () => {
    for (const status of [402, 403]) {
      const deps = makeDeps({ checkKey: vi.fn(async (): Promise<LiteLLMKeyCheck> => ({ outcome: "rejected", status })) });
      expect(await reasonOf(assertOrgApiKeyUsable("o", { canManage: true }, deps))).toBe("rejected");
    }
  });

  it("a 404 mentioning the model -> model_unavailable, caught at publish time, not just discovered later per-candidate", async () => {
    const deps = makeDeps({ checkKey: vi.fn(async (): Promise<LiteLLMKeyCheck> => ({ outcome: "rejected", status: 404, message: "The model `some-model` does not exist" })) });
    expect(await reasonOf(assertOrgApiKeyUsable("o", { canManage: true }, deps))).toBe("model_unavailable");
  });

  it("fails OPEN on rate limits and provider outages — not the key's fault", async () => {
    for (const status of [429, 500, 503]) {
      const deps = makeDeps({ checkKey: vi.fn(async (): Promise<LiteLLMKeyCheck> => ({ outcome: "rejected", status })) });
      expect(await reasonOf(assertOrgApiKeyUsable("o", { canManage: true }, deps))).toBe("no error");
    }
  });

  it("fails OPEN when the provider can't be reached at all", async () => {
    const deps = makeDeps({ checkKey: vi.fn(async (): Promise<LiteLLMKeyCheck> => ({ outcome: "unreachable" })) });
    expect(await reasonOf(assertOrgApiKeyUsable("o", { canManage: true }, deps))).toBe("no error");
  });

  it("threads canManage through to the message", async () => {
    const deps = makeDeps({ loadStoredKey: vi.fn(async () => null) });
    const err = await assertOrgApiKeyUsable("o", { canManage: false }, deps).catch((e) => e);
    expect(err).toBeInstanceOf(ApiKeyError);
    expect(err.message).toContain("Owner or Admin");
  });
});
