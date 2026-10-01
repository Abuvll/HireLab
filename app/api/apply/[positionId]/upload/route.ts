import { NextRequest, NextResponse } from "next/server";
import { saveLocalFile, InvalidUploadError } from "../../../../../lib/storage/local-storage";
import { badRequest, errorResponse } from "../../../../../lib/api/errors";
import { detectFileType } from "../../../../../lib/security/file-type";
import { scanBuffer, isVirusScanConfigured } from "../../../../../lib/security/virus-scan";
import { checkRateLimitSafe, getClientIp } from "../../../../../lib/security/rate-limit";


const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; 

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

    const detectedType = detectFileType(buffer);
    if (!detectedType) {
      throw badRequest("This doesn't look like a valid PDF or DOCX file. Only .pdf and .docx are accepted.");
    }

    if (isVirusScanConfigured()) {
      const scanResult = await scanBuffer(buffer);
      if (scanResult.scanned && !scanResult.clean) {
        throw badRequest("This file was flagged by virus scanning and can't be accepted.");
      }

    } else if (process.env.UPLOAD_REQUIRE_VIRUS_SCAN === "true") {
    
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
