import { Socket } from "net";

export type ScanResult =
  | { scanned: true; clean: true }
  | { scanned: true; clean: false; signature: string }
  | { scanned: false; reason: string };

const CLAMAV_TIMEOUT_MS = 10_000;

export function isVirusScanConfigured(): boolean {
  return !!process.env.CLAMAV_HOST;
}

export async function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST;
  if (!host) {
    return { scanned: false, reason: "CLAMAV_HOST is not set — virus scanning is disabled" };
  }
  const port = Number(process.env.CLAMAV_PORT ?? 3310);

  return new Promise((resolve) => {
    const socket = new Socket();
    let response = "";
    let settled = false;

    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(CLAMAV_TIMEOUT_MS);
    socket.on("timeout", () => finish({ scanned: false, reason: "clamd connection timed out" }));
    socket.on("error", (err) => finish({ scanned: false, reason: `clamd connection error: ${err.message}` }));

    socket.connect(port, host, () => {

      socket.write("zINSTREAM\0");
      const lengthPrefix = Buffer.alloc(4);
      lengthPrefix.writeUInt32BE(buffer.length, 0);
      socket.write(lengthPrefix);
      socket.write(buffer);
      const terminator = Buffer.alloc(4); // zero-length chunk = end of stream
      socket.write(terminator);
    });

    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });

    socket.on("end", () => {
    
      const match = response.match(/stream:\s*(.*?)\s*(OK|FOUND)\0?$/);
      if (!match) {
        finish({ scanned: false, reason: `unrecognized clamd response: ${response}` });
        return;
      }
      if (match[2] === "OK") {
        finish({ scanned: true, clean: true });
      } else {
        finish({ scanned: true, clean: false, signature: match[1] });
      }
    });
  });
}
