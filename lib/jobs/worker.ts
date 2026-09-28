import { Worker, type Job } from "bullmq";
import { ANALYSIS_QUEUE_NAME, type AnalyzeApplicationJobData } from "./queue";
import { analyzeApplication } from "./analyze-application";
import { PrismaAnalysisRepository } from "../db-adapters/prisma-repository";
import { FetchFileStorage } from "../storage/fetch-storage";
import { GithubApiFetcher } from "../github/fetcher-adapter";
import { LiteLLMClient } from "../extraction/litellm-client";


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
    // Each job builds its client from the applying org's own decrypted key (resolved by the repository from
    // Application -> Position -> Organization -> OrgApiKey) — never a global credential. LiteLLMClient sends
    // that key to our own LiteLLM proxy as a per-request override (real BYOK — see the module comment in
    // lib/extraction/litellm-client.ts), rather than the app holding provider credentials of its own.
    llmClientFactory: (apiKey: string) => new LiteLLMClient(apiKey),
  };
}

export function startWorker(): Worker<AnalyzeApplicationJobData> {
  const redisUrl = requireEnv("REDIS_URL");
  const deps = buildDeps();

  const worker = new Worker<AnalyzeApplicationJobData>(
    ANALYSIS_QUEUE_NAME,
    async (job: Job<AnalyzeApplicationJobData>) => {
      // job.attemptsMade is incremented BEFORE this processor runs for a given attempt, so during the last
      // allowed attempt it already equals the job's configured `attempts` (3 — see lib/jobs/queue.ts). Passed
      // through so analyzeApplication only records a user-visible FAILED once BullMQ has actually given up,
      // not on every attempt while a retry is still pending.
      const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
      await analyzeApplication(job.data.applicationId, deps, { isFinalAttempt });
    },
    {
      connection: { url: redisUrl },
      concurrency: 5,
      // Explicit rather than left to BullMQ's library defaults (which happen to match these values today, but
      // "happens to match" isn't the same as "intentional") — this is what recovers a job whose worker process
      // died mid-run (e.g. a server restart): BullMQ notices the lock wasn't renewed within stalledInterval and
      // re-queues the job, up to maxStalledCount times, before giving up on it. Since saveResumeExtract /
      // saveGithubAnalysis / saveScore are all upserts keyed on applicationId (see
      // lib/db-adapters/prisma-repository.ts), a re-run after a stall is safe to redo from scratch — it costs
      // a repeated LLM call, not a corrupted or duplicated record.
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

  return worker;
}
