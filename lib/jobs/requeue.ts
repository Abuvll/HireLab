
export type StuckApplication = { id: string };

export interface RequeueDeps {
  /** Applications still PROCESSING that were created before `createdBefore`. */
  findProcessing(createdBefore: Date): Promise<StuckApplication[]>;
  enqueue(applicationId: string): Promise<void>;
  now?: () => Date;
}

export interface RequeueResult {
  found: number;
  requeued: number;
  failed: { id: string; error: string }[];
}

export async function requeueProcessing(
  deps: RequeueDeps,
  options: { olderThanMinutes?: number; dryRun?: boolean } = {}
): Promise<RequeueResult> {
  const olderThanMinutes = options.olderThanMinutes ?? 15;
  const now = (deps.now ? deps.now() : new Date()).getTime();
  const stuck = await deps.findProcessing(new Date(now - olderThanMinutes * 60_000));
  const result: RequeueResult = { found: stuck.length, requeued: 0, failed: [] };
  if (options.dryRun) return result;
  for (const application of stuck) {
    try {
      await deps.enqueue(application.id);
      result.requeued++;
    } catch (err) {
      result.failed.push({ id: application.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
