
export const ORG_ROLES = ["OWNER", "ADMIN", "RECRUITER", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const POSITION_STATUSES = ["OPEN", "PAUSED", "CLOSED"] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

export const APPLICATION_STATUSES = ["PROCESSING", "READY", "FAILED"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// Not a DB column — derived per-request from ApplicationStatus + Score.meetsRequirements
// for API responses (the frontend has no separate concept of "READY"; it wants to know
// straight away whether a finished application cleared the bar or not).
// READY + meetsRequirements=true  -> QUALIFIED
// READY + meetsRequirements=false -> REVIEWED
// PROCESSING / FAILED pass through unchanged.
export const APPLICATION_DISPLAY_STATUSES = ["PROCESSING", "REVIEWED", "QUALIFIED", "FAILED"] as const;
export type ApplicationDisplayStatus = (typeof APPLICATION_DISPLAY_STATUSES)[number];

export const CONTACT_METHODS = ["EMAIL", "PHONE"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "HYBRID"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

// The upstream AI provider an org's own BYOK key belongs to (see LlmProvider in schema.prisma). One key = one
// provider: LiteLLM routes each request to whichever provider the org's stored key's `provider` says, using
// that provider's own auth convention — it is not a broker that can use one key across many providers (that
// was OpenRouter's model, not a real BYOK one; see lib/extraction/litellm-client.ts).
//
// Deliberately NOT including Meta/Llama here: unlike the other five, Meta doesn't offer a first-party inference
// API a person can hold a direct key for — Llama models are only reachable BYOK-style through a specific host
// (Together, Groq, Bedrock, ...), and picking one on the org's behalf is a product decision, not an engineering
// one. Add it once that's decided.
export const LLM_PROVIDERS = ["ANTHROPIC", "OPENAI", "GEMINI", "MISTRAL", "XAI"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

// The lowercase prefix LiteLLM itself expects in a model string (e.g. "anthropic/claude-3-5-sonnet-20241022").
// Kept separate from the DB's SCREAMING_CASE enum value, matching how EmploymentType's DB value and its display
// label are already two different things (see EMPLOYMENT_LABELS in dashboard.html) rather than reusing one
// string for both a stored value and a wire-format detail.
export const LLM_PROVIDER_PREFIX: Record<LlmProvider, string> = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
  GEMINI: "gemini",
  MISTRAL: "mistral",
  XAI: "xai",
};

export function deriveApplicationStatus(
  status: ApplicationStatus,
  meetsRequirements: boolean | null | undefined
): ApplicationDisplayStatus {
  if (status === "PROCESSING") return "PROCESSING";
  if (status === "FAILED") return "FAILED";
  // status === "READY"
  return meetsRequirements ? "QUALIFIED" : "REVIEWED";
}
