import { startWorker } from "../lib/jobs/worker";
import { ANALYSIS_QUEUE_NAME } from "../lib/jobs/queue";

const worker = startWorker();
console.log(`Worker listening on queue "${ANALYSIS_QUEUE_NAME}"`);

// Container platforms stop a service with SIGTERM on every deploy/restart. Closing the worker lets in-flight jobs
// finish (instead of being marked stalled and retried) before the process exits.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing worker...`);
  // Safety net: if closing hangs, exit anyway (platforms send SIGKILL shortly after SIGTERM).
  setTimeout(() => {
    console.error("Worker did not close in time; exiting anyway.");
    process.exit(1);
  }, 25_000);
  try {
    await worker.close();
    process.exit(0);
  } catch (err) {
    console.error("Error while closing worker:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
