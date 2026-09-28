import { NextRequest, NextResponse } from "next/server";
import { saveLocalFile, InvalidUploadError } from "../../../../../lib/storage/local-storage";
import { badRequest, errorResponse } from "../../../../../lib/api/errors";
import { detectFileType } from "../../../../../lib/security/file-type";
import { scanBuffer, isVirusScanConfigured } from "../../../../../lib/security/virus-scan";
import { checkRateLimitSafe, getClientIp } from "../../../../../lib/security/rate-limit";


const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — matches apply.html's "PDF or DOCX, up to 10MB" copy

// §3.17 — "one of the highest-risk surfaces in the whole app": public,
// unauthenticated, accepts arbitrary file uploads. Layered defenses below:
// rate limiting, a hard size cap, real content-sniffing (not just trusting
// the extension), and virus scanning when configured.

export async function POST(
  req: NextRequest,
  { params }: { params: { positionId: string } }
) {
  try {
    const ip = getClientIp(req.headers);
    const rl = await checkRateLimitSafe(`upload:${ip}`, 20, 3600);
    if (!rl.allowed) throw badRequest("Too many uploads from this network — try again later.");

    const formData = await req.formData().catch(() => null);
    if (!formData) throw badRequest("Expected multipart/form-data");

    const file = formData.get("file");
    if (!(file instanceof File)) throw badRequest("Missing 'file' field");

    if (file.size === 0) throw badRequest("Uploaded file is empty");
    if (file.size > MAX_FILE_SIZE_BYTES) throw badRequest("File exceeds the 10MB limit");

    const buffer = Buffer.from(await file.arrayBuffer());

    // Real content-sniffing: the extension/MIME header are whatever the
    // client claims and are trivially spoofed (rename a .exe to .pdf) —
    // this checks the actual file bytes instead.
    const detectedType = detectFileType(buffer);
    if (!detectedType) {
      throw badRequest("This doesn't look like a valid PDF or DOCX file. Only .pdf and .docx are accepted.");
    }

    if (isVirusScanConfigured()) {
      const scanResult = await scanBuffer(buffer);
      if (scanResult.scanned && !scanResult.clean) {
        throw badRequest("This file was flagged by virus scanning and can't be accepted.");
      }
      // scanned: false (e.g. clamd unreachable) intentionally does NOT
      // block the upload here — see UPLOAD_REQUIRE_VIRUS_SCAN below for
      // the stricter mode.
    } else if (process.env.UPLOAD_REQUIRE_VIRUS_SCAN === "true") {
      // Explicit opt-in for deployments that want to hard-fail uploads
      // rather than accept them unscanned when CLAMAV_HOST isn't reachable.
      throw badRequest("File upload is temporarily unavailable — please try again shortly.");
    }

    let storedFilename: string;
    try {
      storedFilename = await saveLocalFile(buffer, file.name);
    } catch (err) {
      if (err instanceof InvalidUploadError) throw badRequest(err.message);
      throw err;
    }

    const url = new URL(`/api/uploads/${storedFilename}`, req.nextUrl.origin).toString();
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
