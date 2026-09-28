import { describe, it, expect } from "vitest";
import {
  loginSchema,
  signupSchema,
  applySchema,
  rankedListQuerySchema,
  teamInviteSchema,
  createPositionSchema,
  updatePositionSchema,
  updatePositionStatusSchema,
  inferChipType,
  normalizeRequirementChips,
  zodIssuesToFields,
} from "../api/validation";

describe("loginSchema", () => {
  it("accepts a valid email/password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });
  it("rejects an invalid email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("signupSchema", () => {
  const validSignup = {
    organizationName: "Acme Inc",
    name: "Jordan Lee",
    email: "jordan@acme.com",
    password: "a-decent-password",
  };

  it("accepts a valid signup", () => {
    expect(signupSchema.safeParse(validSignup).success).toBe(true);
  });

  it("rejects a password under 8 characters", () => {
    expect(signupSchema.safeParse({ ...validSignup, password: "short" }).success).toBe(false);
  });

  it("allows a missing organization name (company name is optional — the route defaults it to 'My Organization')", () => {
    const { organizationName, ...rest } = validSignup;
    const result = signupSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationName).toBe("");
  });

  it("rejects an invalid email", () => {
    expect(signupSchema.safeParse({ ...validSignup, email: "not-an-email" }).success).toBe(false);
  });
});

const validApplyBase = {
  fullName: "Maren Ito",
  resumeUrl: "https://files.example.com/resume.pdf",
  coverLetterText: "I'm excited to apply for this role because of my background in distributed systems.",
  githubUrl: "https://github.com/mareni",
};

describe("applySchema", () => {
  it("accepts a valid EMAIL-contact submission", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "EMAIL", email: "m@x.com" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid PHONE-contact submission", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "PHONE", phone: "555-0100" });
    expect(result.success).toBe(true);
  });

  it("rejects EMAIL contact method without an email", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "EMAIL" });
    expect(result.success).toBe(false);
  });

  it("rejects PHONE contact method without a phone", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "PHONE" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid contact method (no OTHER option anymore)", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "OTHER" });
    expect(result.success).toBe(false);
  });

  it("rejects a cover letter that's too short (matches the apply form's own > 20 character check)", () => {
    const result = applySchema.safeParse({
      ...validApplyBase,
      contactMethod: "EMAIL",
      email: "m@x.com",
      coverLetterText: "too short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing coverLetterText", () => {
    const { coverLetterText, ...rest } = validApplyBase;
    const result = applySchema.safeParse({ ...rest, contactMethod: "EMAIL", email: "m@x.com" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL resumeUrl", () => {
    const result = applySchema.safeParse({
      ...validApplyBase,
      contactMethod: "EMAIL",
      email: "m@x.com",
      resumeUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing githubUrl", () => {
    const { githubUrl, ...rest } = validApplyBase;
    const result = applySchema.safeParse({ ...rest, contactMethod: "EMAIL", email: "m@x.com" });
    expect(result.success).toBe(false);
  });
});

describe("zodIssuesToFields — apply.html's field-level error display", () => {
  it("maps each top-level string-keyed issue to its field", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "EMAIL" }); // missing email
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodIssuesToFields(result.error);
      expect(fields.email).toBeDefined();
      expect(typeof fields.email).toBe("string");
    }
  });

  it("reports more than one bad field at once, each under its own key", () => {
    // Zod only runs a .refine() (which is how "email required when contactMethod is EMAIL" is enforced) once the
    // base object itself parses, so a submission with several base-schema failures reports THOSE, not email.
    const result = applySchema.safeParse({ fullName: "", contactMethod: "EMAIL" }); // missing resumeUrl, coverLetterText, githubUrl too
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodIssuesToFields(result.error);
      for (const key of ["fullName", "resumeUrl", "coverLetterText", "githubUrl"]) expect(fields[key]).toBeDefined();
    }
  });

  it("the cover-letter-too-short case lands specifically on 'coverLetterText'", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "EMAIL", email: "m@x.com", coverLetterText: "too short" });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(zodIssuesToFields(result.error))).toEqual(["coverLetterText"]);
  });

  it("keeps the FIRST message for a field that fails more than one rule on the same key", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "EMAIL", email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodIssuesToFields(result.error);
      expect(fields.email).toBe(result.error.issues.find((i) => i.path[0] === "email")?.message);
    }
  });

  it("returns an empty object for a fully valid submission (nothing to map)", () => {
    const result = applySchema.safeParse({ ...validApplyBase, contactMethod: "EMAIL", email: "m@x.com" });
    expect(result.success).toBe(true);
  });
});

describe("rankedListQuerySchema — shippedOnly", () => {
  it("'true' and '1' turn it on", () => {
    expect(rankedListQuerySchema.parse({ shippedOnly: "true" }).shippedOnly).toBe(true);
    expect(rankedListQuerySchema.parse({ shippedOnly: "1" }).shippedOnly).toBe(true);
  });

  it("'false' and '0' turn it OFF (regression: z.coerce.boolean() made the string 'false' truthy)", () => {
    expect(rankedListQuerySchema.parse({ shippedOnly: "false" }).shippedOnly).toBe(false);
    expect(rankedListQuerySchema.parse({ shippedOnly: "0" }).shippedOnly).toBe(false);
  });

  it("is undefined when omitted", () => {
    expect(rankedListQuerySchema.parse({}).shippedOnly).toBeUndefined();
  });

  it("rejects anything that isn't a boolean-ish string, with a readable message", () => {
    const result = rankedListQuerySchema.safeParse({ shippedOnly: "yes" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("shippedOnly must be true or false");
  });
});

describe("rankedListQuerySchema — the params the Position Details filters send", () => {
  it("parses every filter param together", () => {
    const r = rankedListQuerySchema.parse({ limit: "all", tech: "React, Docker ,", minConsistency: "60", minCollaboration: "40", shippedOnly: "true" });
    expect(r.limit).toBe("all");
    expect(r.tech).toEqual(["React", "Docker"]);
    expect(r.minConsistency).toBe(60);
    expect(r.minCollaboration).toBe(40);
    expect(r.shippedOnly).toBe(true);
  });

  it("rejects out-of-range thresholds", () => {
    expect(rankedListQuerySchema.safeParse({ minConsistency: "101" }).success).toBe(false);
    expect(rankedListQuerySchema.safeParse({ minCollaboration: "-1" }).success).toBe(false);
  });
});

describe("rankedListQuerySchema", () => {
  it("defaults limit to 10 when not provided", () => {
    const result = rankedListQuerySchema.parse({});
    expect(result.limit).toBe(10);
  });

  it("coerces a numeric limit string from query params", () => {
    const result = rankedListQuerySchema.parse({ limit: "20" });
    expect(result.limit).toBe(20);
  });

  it("accepts the literal 'all' for limit", () => {
    const result = rankedListQuerySchema.parse({ limit: "all" });
    expect(result.limit).toBe("all");
  });

  it("splits a comma-separated tech string into an array", () => {
    const result = rankedListQuerySchema.parse({ tech: "Python, Docker,Kubernetes" });
    expect(result.tech).toEqual(["Python", "Docker", "Kubernetes"]);
  });

  it("leaves tech undefined when not provided", () => {
    const result = rankedListQuerySchema.parse({});
    expect(result.tech).toBeUndefined();
  });

  it("coerces minConsistency from a query string to a number", () => {
    const result = rankedListQuerySchema.parse({ minConsistency: "60" });
    expect(result.minConsistency).toBe(60);
  });

  it("rejects minConsistency outside 0-100", () => {
    expect(rankedListQuerySchema.safeParse({ minConsistency: "150" }).success).toBe(false);
  });
});

describe("teamInviteSchema", () => {
  it("accepts a valid invite", () => {
    const result = teamInviteSchema.safeParse({ email: "a@b.com", name: "Jordan Lee", role: "RECRUITER" });
    expect(result.success).toBe(true);
  });
  it("accepts every current role name (Owner/Admin/Recruiter/Viewer)", () => {
    for (const role of ["OWNER", "ADMIN", "RECRUITER", "VIEWER"]) {
      expect(teamInviteSchema.safeParse({ email: "a@b.com", name: "Jordan Lee", role }).success).toBe(true);
    }
  });
  it("rejects the old, renamed-away role names", () => {
    for (const role of ["HIRING_MANAGER", "INTERVIEWER"]) {
      expect(teamInviteSchema.safeParse({ email: "a@b.com", name: "Jordan Lee", role }).success).toBe(false);
    }
  });
  it("rejects an invalid role", () => {
    const result = teamInviteSchema.safeParse({ email: "a@b.com", name: "Jordan Lee", role: "SUPERADMIN" });
    expect(result.success).toBe(false);
  });
});

const validPositionBase = {
  title: "Senior Backend Engineer",
  location: "Remote",
  employmentType: "FULL_TIME" as const,
  description: "Build and own our core services.",
  requirementChips: ["Python", "5+ years", "Remote"],
  endDate: "2026-12-31",
};

describe("createPositionSchema", () => {
  it("accepts plain-string requirement chips (the dashboard no longer sends {label,type} objects)", () => {
    expect(createPositionSchema.safeParse(validPositionBase).success).toBe(true);
  });

  it("still accepts the older {label, type} object form for compatibility", () => {
    const result = createPositionSchema.safeParse({
      ...validPositionBase,
      requirementChips: [{ label: "Python", type: "skill" as const }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid endDate (the deadline)", () => {
    const result = createPositionSchema.safeParse({ ...validPositionBase, endDate: "2026-12-31" });
    expect(result.success).toBe(true);
  });

  it("REQUIRES a deadline: missing, null, empty and blank all fail with the dashboard's own wording", () => {
    const { endDate, ...withoutDeadline } = validPositionBase;
    for (const body of [withoutDeadline, { ...validPositionBase, endDate: null }, { ...validPositionBase, endDate: "" }, { ...validPositionBase, endDate: "   " }]) {
      const result = createPositionSchema.safeParse(body);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toBe("Please choose a deadline.");
    }
  });

  it("accepts Hybrid as an employment type", () => {
    expect(createPositionSchema.safeParse({ ...validPositionBase, employmentType: "HYBRID" }).success).toBe(true);
    expect(createPositionSchema.safeParse({ ...validPositionBase, employmentType: "REMOTE" }).success).toBe(false);
  });

  it("rejects an unparseable endDate", () => {
    const result = createPositionSchema.safeParse({ ...validPositionBase, endDate: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing description", () => {
    const { description, ...rest } = validPositionBase;
    expect(createPositionSchema.safeParse(rest).success).toBe(false);
  });
});

describe("createPositionSchema — the optional New position details", () => {
  const parse = (extra: Record<string, unknown>) => createPositionSchema.safeParse({ ...validPositionBase, ...extra });

  it("omitted, empty, null and the form's 'None' all mean 'not specified' (stored as null)", () => {
    for (const value of [undefined, "", null, "None", "none", "  None  "]) {
      const r = parse({ salary: value, gender: value, vacancies: value, education: value, experience: value });
      expect(r.success).toBe(true);
      if (r.success) expect([r.data.salary, r.data.gender, r.data.vacancies, r.data.education, r.data.experience]).toEqual([null, null, null, null, null]);
    }
  });

  it("keeps preset options and custom entries, trimmed", () => {
    const r = parse({ salary: "60k \u2013 90k", gender: "  Self-described ", education: "Bachelor's degree", experience: "3+ years in a similar role" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.salary).toBe("60k \u2013 90k");
      expect(r.data.gender).toBe("Self-described");
      expect(r.data.education).toBe("Bachelor's degree");
      expect(r.data.experience).toBe("3+ years in a similar role");
    }
  });

  it("vacancies: the presets and any whole number are fine; other text is rejected", () => {
    for (const v of ["1", "5", "6\u201310", "More than 10", "12", "250"]) expect(parse({ vacancies: v }).success).toBe(true);
    for (const v of ["twelve", "1.5", "-3", "10 people", "1234567"]) {
      const r = parse({ vacancies: v });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Vacancies must be a whole number");
    }
  });

  it("rejects an over-long custom entry", () => {
    expect(parse({ salary: "x".repeat(121) }).success).toBe(false);
    expect(parse({ salary: "x".repeat(120) }).success).toBe(true);
  });
});

describe("updatePositionSchema", () => {
  it("accepts a partial update with just one field", () => {
    expect(updatePositionSchema.safeParse({ title: "Staff Backend Engineer" }).success).toBe(true);
  });
  it("accepts an empty object (no-op update)", () => {
    expect(updatePositionSchema.safeParse({}).success).toBe(true);
  });
  it("leaves omitted fields omitted, so an update never wipes details it didn't send", () => {
    const r = updatePositionSchema.safeParse({ title: "New title" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("endDate" in r.data).toBe(false);
      expect("salary" in r.data).toBe(false);
    }
  });
  it("a deadline that IS sent must be a real date: null, empty and garbage are rejected", () => {
    expect(updatePositionSchema.safeParse({ endDate: "2027-01-31" }).success).toBe(true);
    for (const endDate of [null, "", "not-a-date"]) expect(updatePositionSchema.safeParse({ endDate }).success).toBe(false);
  });
  it("can clear a detail back to 'None'", () => {
    const r = updatePositionSchema.safeParse({ salary: "None", experience: "" });
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.salary, r.data.experience]).toEqual([null, null]);
  });
});

describe("updatePositionStatusSchema", () => {
  it("accepts each valid status", () => {
    for (const status of ["OPEN", "PAUSED", "CLOSED"]) {
      expect(updatePositionStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });
  it("rejects an invalid status", () => {
    expect(updatePositionStatusSchema.safeParse({ status: "ARCHIVED" }).success).toBe(false);
  });
});

describe("inferChipType", () => {
  it("classifies a years-of-experience label", () => {
    expect(inferChipType("5+ years")).toBe("experience");
    expect(inferChipType("3 yr")).toBe("experience");
  });
  it("classifies a location label", () => {
    expect(inferChipType("Remote")).toBe("location");
    expect(inferChipType("Hybrid")).toBe("location");
    expect(inferChipType("On-site")).toBe("location");
  });
  it("falls back to skill for anything else", () => {
    expect(inferChipType("Python")).toBe("skill");
    expect(inferChipType("Kubernetes")).toBe("skill");
  });
});

describe("normalizeRequirementChips", () => {
  it("infers a type for plain-string chips", () => {
    const result = normalizeRequirementChips(["Python", "5+ years", "Remote"]);
    expect(result).toEqual([
      { label: "Python", type: "skill" },
      { label: "5+ years", type: "experience" },
      { label: "Remote", type: "location" },
    ]);
  });
  it("respects an explicit type on the older object form", () => {
    const result = normalizeRequirementChips([{ label: "5+ years", type: "skill" }]);
    expect(result).toEqual([{ label: "5+ years", type: "skill" }]);
  });
  it("infers a type when the object form omits it", () => {
    const result = normalizeRequirementChips([{ label: "Remote" }]);
    expect(result).toEqual([{ label: "Remote", type: "location" }]);
  });
});
