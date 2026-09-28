import { z } from "zod";

export const experienceEntrySchema = z.object({
  title: z.string(),
  company: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  stack: z.array(z.string()),
  achievements: z.array(z.string()),
});

export const educationSchema = z.object({
  school: z.string(),
  field: z.string().nullable(),
  gpa: z.number().min(0).max(5).nullable(), // null when not stated (most resumes omit GPA)
  gradYear: z.number().min(1950).max(2100).nullable(),
});

export const resumeExtractSchema = z.object({
  education: educationSchema.nullable(),
  yearsExperience: z.number().min(0).max(60),
  topSkills: z.array(z.string()).max(15),
  experience: z.array(experienceEntrySchema),
});

export type ResumeExtractSchemaType = z.infer<typeof resumeExtractSchema>;
