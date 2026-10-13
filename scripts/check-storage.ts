// Verifies the configured resume storage (STORAGE_DRIVER=local|s3) by writing, reading back and deleting a tiny file.
// Run it on the machine/container that runs the web app:   npm run storage:check
// It prints which step failed and why (e.g. bad credentials, wrong bucket or region); it never prints secrets.
import { getStorageDriver, saveUpload, readUpload, deleteUpload } from "../lib/storage";

async function main(): Promise<void> {
  const sample = Buffer.from("%PDF-1.4\n% HireLab storage check\n");
  let storedName: string | undefined;
  try {
    console.log(`Storage driver: ${getStorageDriver()}`);

    storedName = await saveUpload(sample, "storage-check.pdf");
    console.log(`  write   ok  (${storedName})`);

    const readBack = await readUpload(storedName);
    if (!readBack.equals(sample)) throw new Error("the bytes read back differ from the bytes written");
    console.log("  read    ok  (bytes match)");

    await deleteUpload(storedName);
    storedName = undefined;
    console.log("  delete  ok");

    console.log("Storage is working.");
  } catch (err) {
    console.error(`Storage check FAILED: ${(err as Error).message}`);
    if (storedName) await deleteUpload(storedName).catch(() => undefined);
    process.exit(1);
  }
}

void main();
