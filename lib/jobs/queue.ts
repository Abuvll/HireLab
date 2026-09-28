import { Queue } from "bullmq";

export const ANALYSIS_QUEUE_NAME = "analyze-application";

export type AnalyzeApplicationJobData = {
  applicationId: string;
};

let queue: Queue<AnalyzeApplicationJobData> | null = null;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
}

function getQueue(): Queue<AnalyzeApplicationJobData> {
  if (!queue) {
    queue = new Queue<AnalyzeApplicationJobData>(ANALYSIS_QUEUE_NAME, {
      connection: { url: getRedisUrl() },
    });
  }
  return queue;
}

export async function enqueueAnalysis(applicationId: string): Promise<void> {
  await getQueue().add(
    "analyze",
    { applicationId },
    {
      // A deterministic jobId (rather than BullMQ's default random one) makes a duplicate enqueue for the same
      // application a safe no-op instead of a second concurrent job. Not reachable today — there's exactly one
      // call site (POST /api/apply/:positionId, right after creating the application), and the DB's own unique
      // constraint on [positionId, email] means an application can't be created twice in the first place — but
      // it becomes reachable the moment anything else calls enqueueAnalysis for an application that might
      // already have a job in flight (an admin "retry analysis" action, a reconciliation sweep for stuck
      // PROCESSING rows, etc.), and costs nothing to have in place before that exists.
      jobId: `analyze:${applicationId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: false, 
    }
  );
}
