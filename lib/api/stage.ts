import type { ApplicationStage } from "../domain-enums";

export type StageState = { stage: ApplicationStage | null; hiredAt: Date | null };

/**
 * What to store when a candidate is moved to `next` (null = take them out of the pipeline).
 *
 * `hiredAt` is the moment of the move to HIRED, and the SERVER stamps it: the client's clock (which the dashboard also
 * sends, so it can show something instantly) is never trusted. Rules:
 *   - moving to HIRED stamps `now`, unless the candidate is already HIRED, in which case the original date stays
 *     (re-sending HIRED, e.g. from a double click or a retry, must not move the hire date);
 *   - any other stage, or null, clears it.
 */
export function computeStageUpdate(current: StageState, next: ApplicationStage | null, now: Date): StageState {
  if (next === "HIRED") {
    const keep = current.stage === "HIRED" && current.hiredAt ? current.hiredAt : now;
    return { stage: "HIRED", hiredAt: keep };
  }
  return { stage: next, hiredAt: null };
}
