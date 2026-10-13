import type { ApplicationStage } from "../domain-enums";

type CandidateRow = {
  id: string;
  fullName: string;
  email: string | null;
  createdAt: Date;
  positionId: string;
  stage: ApplicationStage | null;
  hiredAt: Date | null;
  position: { title: string };
  score: { matchPct: number } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysSince(date: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

/**
 * One entry of GET /api/candidates/pipeline and GET /api/candidates/directory. The dashboard calls an application a
 * "candidate", so `id` is the application id.
 */
export function serializeCandidateEntry(row: CandidateRow, now: Date = new Date()) {
  return {
    id: row.id,
    name: row.fullName,
    email: row.email ?? "",
    positionId: row.positionId,
    positionTitle: row.position.title,
    matchPct: Math.round(row.score?.matchPct ?? 0),
    appliedDaysAgo: daysSince(row.createdAt, now),
    createdAt: row.createdAt,
    stage: row.stage ?? null,
    hiredAt: row.hiredAt ?? null,
  };
}

export const CANDIDATE_ENTRY_INCLUDE = {
  position: { select: { title: true } },
  score: { select: { matchPct: true } },
} as const;
