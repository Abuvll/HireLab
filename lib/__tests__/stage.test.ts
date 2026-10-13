import { describe, it, expect } from "vitest";
import { computeStageUpdate } from "../api/stage";
import { setStageSchema } from "../api/validation";

const T0 = new Date("2026-03-01T10:00:00Z");
const T1 = new Date("2026-03-09T15:30:00Z");

describe("computeStageUpdate (hire date is stamped by the server)", () => {
  it("moving to HIRED stamps the server time", () => {
    expect(computeStageUpdate({ stage: "INTERVIEW", hiredAt: null }, "HIRED", T1)).toEqual({ stage: "HIRED", hiredAt: T1 });
  });

  it("moving from no stage straight to HIRED also stamps", () => {
    expect(computeStageUpdate({ stage: null, hiredAt: null }, "HIRED", T1)).toEqual({ stage: "HIRED", hiredAt: T1 });
  });

  it("re-sending HIRED (double click, retry) keeps the original hire date", () => {
    expect(computeStageUpdate({ stage: "HIRED", hiredAt: T0 }, "HIRED", T1)).toEqual({ stage: "HIRED", hiredAt: T0 });
  });

  it("an already-HIRED row with a missing hiredAt (legacy data) gets stamped instead of staying null", () => {
    expect(computeStageUpdate({ stage: "HIRED", hiredAt: null }, "HIRED", T1)).toEqual({ stage: "HIRED", hiredAt: T1 });
  });

  it("moving away from HIRED clears the hire date", () => {
    expect(computeStageUpdate({ stage: "HIRED", hiredAt: T0 }, "INTERVIEW", T1)).toEqual({ stage: "INTERVIEW", hiredAt: null });
    expect(computeStageUpdate({ stage: "HIRED", hiredAt: T0 }, "SHORTLISTED", T1)).toEqual({ stage: "SHORTLISTED", hiredAt: null });
  });

  it("null takes the candidate out of the pipeline and clears the hire date", () => {
    expect(computeStageUpdate({ stage: "HIRED", hiredAt: T0 }, null, T1)).toEqual({ stage: null, hiredAt: null });
    expect(computeStageUpdate({ stage: "SHORTLISTED", hiredAt: null }, null, T1)).toEqual({ stage: null, hiredAt: null });
  });

  it("hire -> un-hire -> hire again stamps a fresh date the second time", () => {
    const hired = computeStageUpdate({ stage: "INTERVIEW", hiredAt: null }, "HIRED", T0);
    const back = computeStageUpdate(hired, "INTERVIEW", T0);
    expect(computeStageUpdate(back, "HIRED", T1).hiredAt).toEqual(T1);
  });
});

describe("setStageSchema", () => {
  it("accepts the three stages and null", () => {
    for (const stage of ["SHORTLISTED", "INTERVIEW", "HIRED", null]) {
      expect(setStageSchema.safeParse({ stage }).success).toBe(true);
    }
  });

  it("rejects an unknown stage", () => {
    expect(setStageSchema.safeParse({ stage: "OFFERED" }).success).toBe(false);
    expect(setStageSchema.safeParse({ stage: "hired" }).success).toBe(false);
  });

  it("requires the stage key (an empty body is not 'clear the stage')", () => {
    expect(setStageSchema.safeParse({}).success).toBe(false);
  });

  it("tolerates the client's own hiredAt (the server ignores it)", () => {
    const parsed = setStageSchema.safeParse({ stage: "HIRED", hiredAt: "2026-03-09T00:00:00.000Z" });
    expect(parsed.success).toBe(true);
    expect(setStageSchema.safeParse({ stage: null, hiredAt: null }).success).toBe(true);
  });
});
