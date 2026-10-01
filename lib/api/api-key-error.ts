import { ApiError } from "./errors";
import { DecryptionError, decryptSecret } from "../security/encryption";
import { checkLiteLLMKey, classifyStatus, type LiteLLMKeyCheck } from "../extraction/litellm-client";

export const API_KEY_ERROR_CODE = "API_KEY_ERROR" as const;
export const API_KEY_ERROR_STATUS = 424;

export const API_KEY_ERROR_REASONS = ["missing", "invalid", "expired", "revoked", "rejected", "model_unavailable"] as const;
export type ApiKeyErrorReason = (typeof API_KEY_ERROR_REASONS)[number];

const LEAD: Record<ApiKeyErrorReason, string> = {
  missing: "No API key is set up for your organization.",
  invalid: "Your organization's API key isn't valid.",
  expired: "Your organization's API key has expired.",
  revoked: "Your organization's API key has been revoked.",
  rejected: "Your organization's API key was rejected by the AI provider.",
 
  model_unavailable: "The model your organization selected is unavailable.",
};

export function apiKeyErrorMessage(reason: ApiKeyErrorReason, canManage: boolean): string {
  return canManage
    ? `${LEAD[reason]} Update it in Settings → API Keys, then try again.`
    : `${LEAD[reason]} Ask an Owner or Admin to update it in Settings → API Keys.`;
}

export class ApiKeyError extends ApiError {
  constructor(
    public readonly reason: ApiKeyErrorReason,
    opts: { canManage?: boolean } = {}
  ) {
    super(API_KEY_ERROR_STATUS, apiKeyErrorMessage(reason, opts.canManage ?? true), {
      code: API_KEY_ERROR_CODE,
      reason,
    });
    this.name = "ApiKeyError";
  }
}

export function classifyProviderKeyFailure(status: number, providerMessage?: string | null): ApiKeyErrorReason | null {
  const m = providerMessage ?? "";
  if (status === 401) {
    if (/expir/i.test(m)) return "expired";
    if (/revok|disabled|deactivat|deleted|user not found/i.test(m)) return "revoked";
    return "invalid";
  }

  if (status === 402 || status === 403) return "rejected";

  if (classifyStatus(status, m) === "model_unavailable") return "model_unavailable";
  return null;
}

export type OrgKeyGuardDeps = {
  loadStoredKey: (organizationId: string) => Promise<{ encryptedKey: string; model: string } | null>;
  decrypt: (encrypted: string) => string;

  checkKey: (apiKey: string, model: string) => Promise<LiteLLMKeyCheck>;
};

const CHECK_TIMEOUT_MS = 5000;

export const defaultOrgKeyGuardDeps: OrgKeyGuardDeps = {
  loadStoredKey: async (organizationId) => {
  
    const { prisma } = await import("../db");
    return prisma.orgApiKey.findUnique({ where: { organizationId } });
  },
  decrypt: decryptSecret,
  checkKey: (apiKey, model) => checkLiteLLMKey(apiKey, model, { timeoutMs: CHECK_TIMEOUT_MS }),
};

export async function assertOrgApiKeyUsable(
  organizationId: string,
  opts: { canManage: boolean },
  deps: OrgKeyGuardDeps = defaultOrgKeyGuardDeps
): Promise<void> {
  const stored = await deps.loadStoredKey(organizationId);
  if (!stored) throw new ApiKeyError("missing", opts);

  let apiKey: string;
  try {
    apiKey = deps.decrypt(stored.encryptedKey);
  } catch (err) {
    if (err instanceof DecryptionError) throw new ApiKeyError("invalid", opts);
    throw err;
  }

  const check = await deps.checkKey(apiKey, stored.model);
  if (check.outcome !== "rejected") return;

  const reason = classifyProviderKeyFailure(check.status, check.message);
  if (reason) throw new ApiKeyError(reason, opts);
}
