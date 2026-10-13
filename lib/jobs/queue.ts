import { Queue } from "bullmq";
import { createRedisConnection } from "../security/redis-connection";

export const ANALYSIS_QUEUE_NAME = "analyze-application";

export type AnalyzeApplicationJobData = {
  applicationId: string;
};

let queue: Queue<AnalyzeApplicationJobData> | null = null;

function getQueue(): Queue<AnalyzeApplicationJobData> {
  if (!queue) {
    queue = new Queue<AnalyzeApplicationJobData>(ANALYSIS_QUEUE_NAME, {
      connection: createRedisConnection({ maxRetriesPerRequest: null }),
    });
    // Without a listener, a Redis connection error would surface as an unhandled "error" event on the queue.
    queue.on("error", (err: Error) => {
      console.error("[queue] error:", err);
    });
  }
  return queue;
}

/** Job id for an application. Deliberately has no ":" — BullMQ reserves it in custom job ids. */
export function analysisJobId(applicationId: string): string {
  return `analyze-${applicationId}`;
}

export async function enqueueAnalysis(applicationId: string): Promise<void> {
  await getQueue().add(
    "analyze",
    { applicationId },
    {
      jobId: analysisJobId(applicationId),
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: false,
    }
  );
}
