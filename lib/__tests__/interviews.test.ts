import { describe, it, expect } from "vitest";
import { serializeInterview, interviewChangeProblem, type InterviewRow } from "../api/interviews";
import { createInterviewSchema, updateInterviewSchema } from "../api/validation";

const row: InterviewRow = {
  id: "iv1",
  applicationId: "app1",
  type: "TECHNICAL",
  startTime: new Date("2026-03-10T09:00:00Z"),
  endTime: new Date("2026-03-10T10:00:00Z"),
  interviewerName: "Rita Cole",
  status: "SCHEDULED",
  createdAt: new Date("2026-03-01T00:00:00Z"),
  application: { fullName: "Alice Nguyen", positionId: "pos1", position: { title: "Senior Backend Engineer" } },
};

describe("serializeInterview", () => {
  it("maps the row to the shape the Interviews view reads (candidateId is the application id)", () => {
    expect(serializeInterview(row)).toEqual({
      id: "iv1",
      candidateId: "app1",
      candidateName: "Alice Nguyen",
      positionId: "pos1",
      positionTitle: "Senior Backend Engineer",
      type: "TECHNICAL",
      startTime: row.startTime,
      endTime: row.endTime,
      interviewerName: "Rita Cole",
      status: "SCHEDULED",
    });
  });

  it("does not leak internal columns", () => {
    const keys = Object.keys(serializeInterview(row));
    expect(keys).not.toContain("applicationId");
    expect(keys).not.toContain("createdAt");
    expect(keys).not.toContain("application");
  });
});

describe("interviewChangeProblem", () => {
  it("allows changes only while SCHEDULED", () => {
    expect(interviewChangeProblem("SCHEDULED")).toBeNull();
  });
  it("blocks completed and canceled interviews with a specific message", () => {
    expect(interviewChangeProblem("COMPLETED")).toMatch(/completed/);
    expect(interviewChangeProblem("CANCELED")).toMatch(/canceled/);
  });
});

describe("createInterviewSchema", () => {
  const good = { candidateId: "app1", type: "SCREENING", startTime: "2026-03-10T09:00:00.000Z", endTime: "2026-03-10T09:45:00.000Z", interviewerName: "Rita" };

  it("accepts a valid interview and defaults the interviewer to an empty string", () => {
    expect(createInterviewSchema.safeParse(good).success).toBe(true);
    const { interviewerName, ...noName } = good;
    const parsed = createInterviewSchema.safeParse(noName);
    expect(parsed.success && parsed.data.interviewerName).toBe("");
  });

  it("accepts all four interview types and rejects anything else", () => {
    for (const type of ["SCREENING", "TECHNICAL", "FINAL_ROUND", "HIRING_REVIEW"]) {
      expect(createInterviewSchema.safeParse({ ...good, type }).success).toBe(true);
    }
    expect(createInterviewSchema.safeParse({ ...good, type: "VIDEO" }).success).toBe(false);
  });

  it("requires the end to be after the start", () => {
    const r = createInterviewSchema.safeParse({ ...good, endTime: good.startTime });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("endTime must be after startTime");
    expect(createInterviewSchema.safeParse({ ...good, endTime: "2026-03-10T08:00:00.000Z" }).success).toBe(false);
  });

  it("rejects missing or unparseable times and a missing candidate", () => {
    expect(createInterviewSchema.safeParse({ ...good, startTime: "soon" }).success).toBe(false);
    const { endTime, ...noEnd } = good;
    expect(createInterviewSchema.safeParse(noEnd).success).toBe(false);
    expect(createInterviewSchema.safeParse({ ...good, candidateId: "" }).success).toBe(false);
  });

  it("trims the interviewer name and caps its length", () => {
    const parsed = createInterviewSchema.safeParse({ ...good, interviewerName: "  Rita  " });
    expect(parsed.success && parsed.data.interviewerName).toBe("Rita");
    expect(createInterviewSchema.safeParse({ ...good, interviewerName: "x".repeat(201) }).success).toBe(false);
  });
});

describe("updateInterviewSchema", () => {
  const start = "2026-03-11T09:00:00.000Z";
  const end = "2026-03-11T10:00:00.000Z";

  it("accepts a status-only change (complete / cancel)", () => {
    expect(updateInterviewSchema.safeParse({ status: "COMPLETED" }).success).toBe(true);
    expect(updateInterviewSchema.safeParse({ status: "CANCELED" }).success).toBe(true);
  });

  it("rejects an unknown status and an empty body", () => {
    expect(updateInterviewSchema.safeParse({ status: "DONE" }).success).toBe(false);
    const r = updateInterviewSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Nothing to update");
  });

  it("a reschedule must send both times, in order", () => {
    expect(updateInterviewSchema.safeParse({ startTime: start, endTime: end }).success).toBe(true);
    expect(updateInterviewSchema.safeParse({ startTime: start }).success).toBe(false);
    expect(updateInterviewSchema.safeParse({ endTime: end }).success).toBe(false);
    expect(updateInterviewSchema.safeParse({ startTime: end, endTime: start }).success).toBe(false);
  });

  it("can change type and interviewer together with the times", () => {
    expect(updateInterviewSchema.safeParse({ type: "FINAL_ROUND", interviewerName: "Sam", startTime: start, endTime: end }).success).toBe(true);
  });
});
