import { z } from "zod";
import {
  APPLICATION_STAGES,
  CONTACT_METHODS,
  EMPLOYMENT_TYPES,
  INTERVIEW_STATUSES,
  INTERVIEW_TYPES,
  ORG_ROLES,
  POSITION_STATUSES,
} from "../domain-enums";

export function zodIssuesToFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : undefined;
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

// Messages below are shown to people as they are (the sign-in page, the public apply page), so they are written as plain sentences.
export const loginSchema = z.object({
  email: z.string({ required_error: "Enter your email address." }).trim().email("Enter a valid email address."),
  password: z.string({ required_error: "Enter your password." }).min(1, "Enter your password."),
  // "Remember me": true (the default) = a 7-day session, false = a browser-session cookie with a 24-hour token.
  remember: z.boolean().optional(),
});

export const signupSchema = z.object({
  organizationName: z.string().max(200, "The organization name is too long (200 characters at most).").optional().default(""),
  name: z.string({ required_error: "Enter your name." }).trim().min(1, "Enter your name.").max(200, "The name is too long (200 characters at most)."),
  email: z.string({ required_error: "Enter your email address." }).trim().email("Enter a valid email address."),
  password: z
    .string({ required_error: "Choose a password." })
    .min(8, "Use at least 8 characters for your password.")
    .max(200, "The password is too long (200 characters at most)."),
});

const GITHUB_USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** True for a link to a GitHub profile (or a repo/page under one): github.com or www.github.com, first path segment a valid username. */
export function isGithubProfileUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return false;
  const first = u.pathname.split("/").filter(Boolean)[0];
  return !!first && GITHUB_USERNAME.test(first);
}

// A link the browser would open: http(s) only (`z.string().url()` alone also accepts javascript: and data: URLs).
const httpUrl = (message: string, requiredMessage = message) =>
  z
    .string({ required_error: requiredMessage, invalid_type_error: message })
    .trim()
    .url(message)
    .refine((v) => /^https?:\/\//i.test(v), message);

export const COVER_LETTER_MIN = 21;
export const COVER_LETTER_MAX = 10000;

export const applySchema = z
  .object({
    fullName: z
      .string({ required_error: "Enter your full name." })
      .trim()
      .min(1, "Enter your full name.")
      .max(200, "Your name is too long (200 characters at most)."),
    contactMethod: z.enum(CONTACT_METHODS, { errorMap: () => ({ message: "Choose how we should contact you: email or phone." }) }),
    email: z.string().trim().email("Enter a valid email address.").optional(),
    phone: z.string().max(50, "That phone number is too long.").optional(),
    resumeUrl: httpUrl("Upload your resume first.", "Upload your resume first."),
    coverLetterText: z
      .string({ required_error: "Write a few sentences about why you're a good fit." })
      .trim()
      .min(COVER_LETTER_MIN, `Write a little more — the cover letter needs at least ${COVER_LETTER_MIN} characters.`)
      .max(COVER_LETTER_MAX, `The cover letter is too long (${COVER_LETTER_MAX.toLocaleString("en-US")} characters at most).`),
    githubUrl: z
      .string({ required_error: "Enter your GitHub profile link.", invalid_type_error: "Enter your GitHub profile link." })
      .trim()
      .refine(isGithubProfileUrl, "Enter a link to your GitHub profile, like github.com/yourname."),
    personalSiteUrl: httpUrl("Enter a valid website link, like yoursite.dev.").optional(),
    source: z.string().max(100, "The source tag is too long (100 characters at most).").optional(),
    captchaToken: z.string().optional(),
  })
  .refine((data) => (data.contactMethod === "EMAIL" ? !!data.email : true), {
    message: "Enter your email address — you chose to be contacted by email.",
    path: ["email"],
  })
  .refine((data) => (data.contactMethod === "PHONE" ? !!data.phone : true), {
    message: "Enter your phone number — you chose to be contacted by phone.",
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

// `status` is what the New position / Edit form's Open / Paused choice sends. Optional: a new position defaults to OPEN,
// an edit that doesn't send it leaves the status alone. (It can also be changed on its own: PATCH .../status.)
export const createPositionSchema = positionFieldsSchema.extend({ status: z.enum(POSITION_STATUSES).optional() });

export const updatePositionSchema = createPositionSchema.partial();

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

// ---------- candidate notes ----------

const NOTE_TEXT_MAX = 5000;

export const createNoteSchema = z.object({
  text: z.string().trim().min(1).max(NOTE_TEXT_MAX),
  // The note this one replies to (same candidate). null / omitted = a top-level note.
  parentId: z.string().min(1).nullish(),
});

// A note's text can be edited by its author only; pinning is a separate permission (anyone who can write notes), so the
// route checks each part against its own rule. At least one of the two must be present.
export const updateNoteSchema = z
  .object({
    text: z.string().trim().min(1).max(NOTE_TEXT_MAX).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((d) => d.text !== undefined || d.pinned !== undefined, { message: "Nothing to update" });

// ---------- hiring pipeline stage ----------

// `hiredAt` is accepted because the dashboard sends it, but the server stamps its own time (see lib/api/stage.ts).
export const setStageSchema = z.object({
  stage: z.enum(APPLICATION_STAGES).nullable(),
  hiredAt: z.string().nullish(),
});

// ---------- interviews ----------

function isoDateTime(label: string) {
  return z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be a date and time` })
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: `${label} must be a valid date and time` });
}

const interviewerNameSchema = z.string().trim().max(200, "Interviewer must be 200 characters or fewer");

export const createInterviewSchema = z
  .object({
    candidateId: z.string().min(1),
    type: z.enum(INTERVIEW_TYPES),
    startTime: isoDateTime("startTime"),
    endTime: isoDateTime("endTime"),
    interviewerName: interviewerNameSchema.optional().default(""),
  })
  .refine((d) => Date.parse(d.endTime) > Date.parse(d.startTime), { message: "endTime must be after startTime", path: ["endTime"] });

export const updateInterviewSchema = z
  .object({
    type: z.enum(INTERVIEW_TYPES).optional(),
    status: z.enum(INTERVIEW_STATUSES).optional(),
    startTime: isoDateTime("startTime").optional(),
    endTime: isoDateTime("endTime").optional(),
    interviewerName: interviewerNameSchema.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: "Nothing to update" })
  .refine((d) => (d.startTime === undefined) === (d.endTime === undefined), {
    message: "startTime and endTime must be changed together",
    path: ["endTime"],
  })
  .refine((d) => d.startTime === undefined || d.endTime === undefined || Date.parse(d.endTime) > Date.parse(d.startTime), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });
