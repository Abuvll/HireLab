import { Worker, type Job } from "bullmq";
import { ANALYSIS_QUEUE_NAME, type AnalyzeApplicationJobData } from "./queue";
import { analyzeApplication } from "./analyze-application";
import { PrismaAnalysisRepository } from "../db-adapters/prisma-repository";
import { FetchFileStorage } from "../storage/fetch-storage";
import { GithubApiFetcher } from "../github/fetcher-adapter";
import { LiteLLMClient } from "../extraction/litellm-client";
import { createRedisConnection } from "../security/redis-connection";


function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function buildDeps() {
  return {
    repository: new PrismaAnalysisRepository(),
    fileStorage: new FetchFileStorage(),
    githubClient: new GithubApiFetcher(requireEnv("GITHUB_TOKEN")),

    llmClientFactory: (apiKey: string) => new LiteLLMClient(apiKey),
  };
}

export function startWorker(): Worker<AnalyzeApplicationJobData> {
  requireEnv("REDIS_URL");
  const deps = buildDeps();

  const worker = new Worker<AnalyzeApplicationJobData>(
    ANALYSIS_QUEUE_NAME,
    async (job: Job<AnalyzeApplicationJobData>) => {
      const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
      await analyzeApplication(job.data.applicationId, deps, { isFinalAttempt });
    },
    {
      connection: createRedisConnection({ maxRetriesPerRequest: null }),
      concurrency: 5,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`Application analysis failed for job ${job?.id} (application ${job?.data.applicationId}):`, err);
  });

  worker.on("completed", (job) => {
    console.log(`Application analysis completed: ${job.data.applicationId}`);
  });

  // Connection-level errors (e.g. Redis restarting or waking up): log them and let BullMQ reconnect,
  // instead of crashing the process on an unhandled "error" event.
  worker.on("error", (err: Error) => {
    console.error("[worker] error:", err);
  });

  return worker;
}
