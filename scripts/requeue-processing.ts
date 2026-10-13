
import { prisma } from "../lib/db";
import { enqueueAnalysis } from "../lib/jobs/queue";
import { requeueProcessing } from "../lib/jobs/requeue";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const olderArg = args.find((a) => a.startsWith("--older-than="));
  const olderThanMinutes = olderArg ? Number(olderArg.split("=")[1]) : 15;
  if (!Number.isFinite(olderThanMinutes) || olderThanMinutes < 0) {
    console.error("--older-than must be a number of minutes, e.g. --older-than=30");
    return 2;
  }

  const result = await requeueProcessing(
    {
      findProcessing: (createdBefore) =>
        prisma.application.findMany({
          where: { status: "PROCESSING", createdAt: { lt: createdBefore } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        }),
      enqueue: enqueueAnalysis,
    },
    { olderThanMinutes, dryRun }
  );

  console.log(`Applications PROCESSING for more than ${olderThanMinutes} min: ${result.found}`);
  if (dryRun) {
    console.log("Dry run — nothing was queued.");
    return 0;
  }
  console.log(`Queued: ${result.requeued}`);
  for (const f of result.failed) console.error(`  could not queue ${f.id}: ${f.error}`);
  return result.failed.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`Re-queue FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
