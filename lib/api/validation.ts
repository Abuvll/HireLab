import { z } from "zod";
import { CONTACT_METHODS, EMPLOYMENT_TYPES, ORG_ROLES, POSITION_STATUSES } from "../domain-enums";

export function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : undefined;
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signupSchema = z.object({
  organizationName: z.string().max(200).optional().default(""),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const applySchema = z
  .object({
    fullName: z.string().min(1).max(200),
    contactMethod: z.enum(CONTACT_METHODS),
    email: z.string().email().optional(),
    phone: z.string().max(50).optional(),
    resumeUrl: z.string().url(),
    coverLetterText: z.string().trim().min(21), 
    githubUrl: z.string().url(),
    personalSiteUrl: z.string().url().optional(),
    source: z.string().max(100).optional(),
    captchaToken: z.string().optional(),
  })
  .refine((data) => (data.contactMethod === "EMAIL" ? !!data.email : true), {
    message: "email is required when contactMethod is EMAIL",
    path: ["email"],
  })
  .refine((data) => (data.contactMethod === "PHONE" ? !!data.phone : true), {
    message: "phone is required when contactMethod is PHONE",
    path: ["phone"],
  });
const requirementChipInputSchema = z.union([
  z.string().min(1).max(200),
  z.object({
    label: z.string().min(1).max(200),
    type: z.enum(["skill", "experience", "location"]).optional(),
  }),
]);

export type RequirementChipInput = z.infer<typeof requirementChipInputSchema>;

export function inferChipType(label: string): "skill" | "experience" | "location" {
  if (/\d+\+?\s*(yr|year)/i.test(label)) return "experience";
  if (/\b(remote|hybrid|on-?site)\b/i.test(label)) return "location";
  return "skill";
}

export function normalizeRequirementChips(
  chips: RequirementChipInput[]
): { label: string; type: "skill" | "experience" | "location" }[] {
  return chips.map((c) => {
    if (typeof c === "string") return { label: c, type: inferChipType(c) };
    return { label: c.label, type: c.type ?? inferChipType(c.label) };
  });
}


const POSITION_DETAIL_MAX = 120;
function optionalDetail(label: string) {
  return z
    .string()
    .trim()
    .max(POSITION_DETAIL_MAX, `${label} must be ${POSITION_DETAIL_MAX} characters or fewer`)
    .nullish()
    .transform((v) => (v == null || v === "" || v.toLowerCase() === "none" ? null : v));
}

export const VACANCY_PRESETS = ["1", "2", "3", "4", "5", "6\u201310", "More than 10"];

const positionFieldsSchema = z.object({
  title: z.string().min(1).max(200),
  location: z.string().min(1).max(200),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("FULL_TIME"),
  description: z.string().min(1),
  requirementChips: z.array(requirementChipInputSchema),

  // Required (the dashboard blocks publishing without one and this enforces it
  // for API callers too). It doesn't gate applications. On update (.partial()
  // below) it may be omitted, but if it is sent it must be a real date:
  // null / "" are rejected.
  endDate: z
    .string({ required_error: "Please choose a deadline.", invalid_type_error: "Please choose a deadline." })
    .trim()
    .min(1, "Please choose a deadline.")
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "endDate must be a valid date" }),
  salary: optionalDetail("Salary"),
  gender: optionalDetail("Gender"),
  vacancies: optionalDetail("Vacancies").refine((v) => v === null || VACANCY_PRESETS.includes(v) || /^\d{1,6}$/.test(v), {
    message: "Vacancies must be a whole number",
  }),
  education: optionalDetail("Education qualifications"),
  experience: optionalDetail("Experience level"),
});

export const createPositionSchema = positionFieldsSchema;

export const updatePositionSchema = positionFieldsSchema.partial();

export const updatePositionStatusSchema = z.object({
  status: z.enum(POSITION_STATUSES),
});

export const rankedListQuerySchema = z.object({
  limit: z
    .union([z.literal("all"), z.coerce.number().int().positive()])
    .optional()
    .default(10),
  tech: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined)),
  minConsistency: z.coerce.number().min(0).max(100).optional(),
  minCollaboration: z.coerce.number().min(0).max(100).optional(),
  // "false" (a non-empty string) would coerce to true and switch the
  // shipped-only filter ON. Parse the string explicitly instead.
  shippedOnly: z
    .enum(["true", "false", "1", "0"], { errorMap: () => ({ message: "shippedOnly must be true or false" }) })
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
});

export const teamInviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role: z.enum(ORG_ROLES),
});
