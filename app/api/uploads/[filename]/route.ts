import { NextRequest, NextResponse } from "next/server";
import { readLocalFile, mimeTypeForExtension, FileNotFoundError, InvalidUploadError } from "../../../../lib/storage/local-storage";
import { requireAuth } from "../../../../lib/api/auth";
import { ApiError, errorResponse, badRequest, notFound, unauthorized } from "../../../../lib/api/errors";


function hasValidInternalToken(req: NextRequest): boolean {
  const provided = req.headers.get("x-internal-worker-token");
  const expected = process.env.WORKER_INTERNAL_SECRET;
  return !!expected && !!provided && provided === expected;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    if (!hasValidInternalToken(req)) {
      try {
        await requireAuth(req);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) throw unauthorized("Sign in to view this file");
        throw err;
      }
    }

    let buffer: Buffer;
    try {
      buffer = await readLocalFile(params.filename);
    } catch (err) {
      if (err instanceof FileNotFoundError) throw notFound("File not found");
      if (err instanceof InvalidUploadError) throw badRequest(err.message);
      throw err;
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeTypeForExtension(params.filename),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
