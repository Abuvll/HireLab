import type { InterviewStatus, InterviewType } from "../domain-enums";

export type InterviewRow = {
  id: string;
  applicationId: string;
  type: InterviewType;
  startTime: Date;
  endTime: Date;
  interviewerName: string;
  status: InterviewStatus;
  createdAt: Date;
  application: {
    fullName: string;
    positionId: string;
    position: { title: string };
  };
};

/** The shape the dashboard's Interviews view reads. `candidateId` is the application id (that is what the dashboard calls a candidate). */
export function serializeInterview(row: InterviewRow) {
  return {
    id: row.id,
    candidateId: row.applicationId,
    candidateName: row.application.fullName,
    positionId: row.application.positionId,
    positionTitle: row.application.position.title,
    type: row.type,
    startTime: row.startTime,
    endTime: row.endTime,
    interviewerName: row.interviewerName,
    status: row.status,
  };
}

/** Prisma `include` that gives serializeInterview everything it needs. */
export const INTERVIEW_INCLUDE = {
  application: { select: { fullName: true, positionId: true, position: { select: { title: true } } } },
} as const;

/**
 * A finished or canceled interview is history: it can't be re-opened, moved or re-typed. Only a SCHEDULED one can change
 * (reschedule, complete, cancel). Returns an error message, or null when the change is allowed.
 */
export function interviewChangeProblem(currentStatus: InterviewStatus): string | null {
  if (currentStatus === "SCHEDULED") return null;
  return currentStatus === "COMPLETED"
    ? "This interview is already completed and can't be changed."
    : "This interview was canceled and can't be changed. Schedule a new one instead.";
}
