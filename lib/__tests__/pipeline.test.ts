import { describe, it, expect } from "vitest";
import { daysSince, serializeCandidateEntry } from "../api/pipeline";

const NOW = new Date("2026-03-10T12:00:00Z");

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(new Date("2026-03-10T11:00:00Z"), NOW)).toBe(0);
    expect(daysSince(new Date("2026-03-09T12:00:00Z"), NOW)).toBe(1);
    expect(daysSince(new Date("2026-03-07T13:00:00Z"), NOW)).toBe(2);
    expect(daysSince(new Date("2026-02-08T12:00:00Z"), NOW)).toBe(30);
  });

  it("never goes negative for a timestamp slightly in the future (clock skew)", () => {
    expect(daysSince(new Date("2026-03-10T12:05:00Z"), NOW)).toBe(0);
  });
});

describe("serializeCandidateEntry", () => {
  const row = {
    id: "app1",
    fullName: "Alice Nguyen",
    email: "alice@example.com",
    createdAt: new Date("2026-03-05T12:00:00Z"),
    positionId: "pos1",
    stage: "SHORTLISTED" as const,
    hiredAt: null,
    position: { title: "Senior Backend Engineer" },
    score: { matchPct: 87.6 },
  };

  it("produces the entry the Hiring and Notes screens read, keyed by application id", () => {
    expect(serializeCandidateEntry(row, NOW)).toEqual({
      id: "app1",
      name: "Alice Nguyen",
      email: "alice@example.com",
      positionId: "pos1",
      positionTitle: "Senior Backend Engineer",
      matchPct: 88,
      appliedDaysAgo: 5,
      createdAt: row.createdAt,
      stage: "SHORTLISTED",
      hiredAt: null,
    });
  });

  it("an unscored application shows 0%, a missing e-mail shows an empty string (never null)", () => {
    const out = serializeCandidateEntry({ ...row, score: null, email: null }, NOW);
    expect(out.matchPct).toBe(0);
    expect(out.email).toBe("");
  });

  it("carries the hire date for a HIRED candidate and null stage for an un-staged one", () => {
    const hiredAt = new Date("2026-03-09T00:00:00Z");
    expect(serializeCandidateEntry({ ...row, stage: "HIRED", hiredAt }, NOW)).toMatchObject({ stage: "HIRED", hiredAt });
    expect(serializeCandidateEntry({ ...row, stage: null }, NOW).stage).toBeNull();
  });
});
