import { Socket } from "net";

// Real virus scanning via ClamAV's clamd daemon, using its documented
// INSTREAM protocol directly over TCP (no npm package needed — the
// protocol is simple enough to implement in ~40 lines and this avoids
// pulling in a dependency for it). This talks to a real clamd instance if
// CLAMAV_HOST/CLAMAV_PORT are set — clamd is standard, widely-deployed
// infrastructure (a sidecar container in most container setups, a native
// package on most Linux hosts, or a managed offering on several cloud
// providers), not something this app can stand up on its own from application code.
//
// If CLAMAV_HOST isn't set, scanning is skipped — loudly, via the returned
// `scanned: false`, which callers must check and surface (see the upload
// route). This is intentionally NOT "assume clean" dressed up as a scan:
// callers should decide whether to accept unscanned uploads (fine for a
// staging/demo environment) or reject them outright (recommended before a
// real production launch) — see UPLOAD_REQUIRE_VIRUS_SCAN below.

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
      // INSTREAM protocol: a "zINSTREAM\0" command, then the payload as a
      // series of 4-byte big-endian length-prefixed chunks, terminated by
      // a zero-length chunk.
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
      // clamd replies "stream: OK" for clean, or
      // "stream: <Signature> FOUND" for a detected threat.
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
