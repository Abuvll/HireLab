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
      jobId: `analyze:${applicationId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: false, 
    }
  );
}
