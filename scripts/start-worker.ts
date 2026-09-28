import { startWorker } from "../lib/jobs/worker";
import { ANALYSIS_QUEUE_NAME } from "../lib/jobs/queue";

startWorker();
console.log(`Worker listening on queue "${ANALYSIS_QUEUE_NAME}"`);
