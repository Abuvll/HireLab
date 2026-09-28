import { NextRequest, NextResponse } from "next/server";
import { readLocalFile, mimeTypeForExtension, FileNotFoundError, InvalidUploadError } from "../../../../lib/storage/local-storage";
import { requireAuth } from "../../../../lib/api/auth";
import { ApiError, errorResponse, badRequest, notFound, unauthorized } from "../../../../lib/api/errors";

// §3.17's security notes flag this as one of the highest-risk endpoints in
// the app: resumes contain PII, and this used to be fully public with no
// auth at all — anyone with (or guessing) the UUID filename could fetch
// any resume. Two legitimate callers need access without a browser
// session: the background worker (lib/storage/fetch-storage.ts, a plain
// server-side `fetch()` with no cookie jar) downloading a resume to run
// text extraction, and the same worker isn't the only non-browser caller
// this might ever need — so the gate is "a valid employer session, OR the
// shared internal-worker secret," not "a valid session, full stop."
//
// This is real, working access control, not a placeholder — but it's not
// the full destination state described in §3.17 (object storage +
// per-request signed URLs, with no standing secret at all). Documented as
// a deliberate, scoped improvement rather than the complete migration —
// see the production-readiness notes for the S3 migration sketch.

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
      // requireAuth re-checks the account in the database, so a team member
      // who has since been removed can't keep opening resumes with an old
      // (still validly signed) cookie.
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
