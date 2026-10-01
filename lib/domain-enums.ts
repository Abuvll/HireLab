
export const ORG_ROLES = ["OWNER", "ADMIN", "RECRUITER", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const POSITION_STATUSES = ["OPEN", "PAUSED", "CLOSED"] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

export const APPLICATION_STATUSES = ["PROCESSING", "READY", "FAILED"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_DISPLAY_STATUSES = ["PROCESSING", "REVIEWED", "QUALIFIED", "FAILED"] as const;
export type ApplicationDisplayStatus = (typeof APPLICATION_DISPLAY_STATUSES)[number];

export const CONTACT_METHODS = ["EMAIL", "PHONE"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "HYBRID"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const LLM_PROVIDERS = ["ANTHROPIC", "OPENAI", "GEMINI", "MISTRAL", "XAI"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

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
