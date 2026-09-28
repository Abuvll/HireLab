import { ApiError } from "./errors";
import { DecryptionError, decryptSecret } from "../security/encryption";
import { checkLiteLLMKey, classifyStatus, type LiteLLMKeyCheck } from "../extraction/litellm-client";

// The dashboard (public/dashboard.html, "API-key error handling") recognises
// exactly this shape on any failed request and shows its "There's a problem
// with your API key" pop-up:
//
//   HTTP 424  { "error": "<short, secret-free message>",
//               "code": "API_KEY_ERROR",
//               "reason": "missing" | "invalid" | "expired" | "revoked" | "rejected" | "model_unavailable" }
//
// The status is deliberately NOT 401 (the dashboard treats 401 as "session
// expired" and drops the person to the login screen) and NOT 403 (that's
// what role checks return). 424 Failed Dependency reads as "the request
// couldn't be completed because the AI provider credential isn't usable".
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
  // Not really a KEY problem — the key is fine, the selected model isn't — but it's caught and surfaced here
  // for the same reason a bad key is: better to tell the org proactively (at publish time) than let every
  // candidate's analysis fail one by one before anyone notices. Settings > API Keys is also where the model is
  // chosen, so pointing there is still the right instruction even though the key itself isn't at fault.
  model_unavailable: "The model your organization selected is unavailable.",
};

// Only Owners/Admins can change the key (see app/api/organization/api-key),
// so everyone else is pointed at them instead of at a screen they can't use.
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

// Maps an HTTP failure from the AI provider to the reason shown to the
// user, or null when the status says nothing about the key (rate limits,
// provider outages, ...). 401 is the only status where the wording of the
// provider's message can tell us more; anything we can't tell apart falls
// back to the generic "invalid" (401) / "rejected" (402, 403).
export function classifyProviderKeyFailure(status: number, providerMessage?: string | null): ApiKeyErrorReason | null {
  const m = providerMessage ?? "";
  if (status === 401) {
    if (/expir/i.test(m)) return "expired";
    if (/revok|disabled|deactivat|deleted|user not found/i.test(m)) return "revoked";
    return "invalid";
  }
  // 402: the key is fine but the account behind it can't pay; 403: the
  // provider refuses this key for this request. Either way the provider
  // turned the key away.
  if (status === 402 || status === 403) return "rejected";
  // Reuses the same model/message-sniffing classification the job pipeline itself uses (see
  // lib/extraction/litellm-client.ts) so a decommissioned or mistyped model is caught here too, not just
  // during background analysis.
  if (classifyStatus(status, m) === "model_unavailable") return "model_unavailable";
  return null;
}

export type OrgKeyGuardDeps = {
  loadStoredKey: (organizationId: string) => Promise<{ encryptedKey: string; model: string } | null>;
  decrypt: (encrypted: string) => string;
  // Unlike OpenRouter's account-level key-info endpoint, checking a BYOK provider key through LiteLLM means
  // actually exercising it against a specific model (see lib/extraction/litellm-client.ts) — there's no
  // generic "is this key good for anything" check independent of which model it's being used with.
  checkKey: (apiKey: string, model: string) => Promise<LiteLLMKeyCheck>;
};

const CHECK_TIMEOUT_MS = 5000;

export const defaultOrgKeyGuardDeps: OrgKeyGuardDeps = {
  loadStoredKey: async (organizationId) => {
    // Lazy import: keeps this module (and its unit tests) free of the
    // Prisma client unless a real lookup actually happens.
    const { prisma } = await import("../db");
    return prisma.orgApiKey.findUnique({ where: { organizationId } });
  },
  decrypt: decryptSecret,
  checkKey: (apiKey, model) => checkLiteLLMKey(apiKey, model, { timeoutMs: CHECK_TIMEOUT_MS }),
};

// Throws ApiKeyError unless the organization has a stored key that the
// provider still accepts. Used by requests that only make sense with a
// working key (publishing a position, opening a candidate whose analysis
// failed). It fails OPEN when the provider can't be reached or answers with
// something that isn't about the key (429, 5xx): a network blip must not be
// reported to the user as a problem with their key.
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
    // A stored key we can't decrypt (rotated ENCRYPTION_KEY, corrupted
    // row) is unusable from the org's point of view: re-entering it fixes
    // it. A missing/bad ENCRYPTION_KEY (EncryptionConfigError) is a server
    // misconfiguration, not the org's doing — let that surface as a 500.
    if (err instanceof DecryptionError) throw new ApiKeyError("invalid", opts);
    throw err;
  }

  const check = await deps.checkKey(apiKey, stored.model);
  if (check.outcome !== "rejected") return;

  const reason = classifyProviderKeyFailure(check.status, check.message);
  if (reason) throw new ApiKeyError(reason, opts);
}
