import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Optional machine-readable fields merged into the JSON body next to
    // `error` (e.g. { code, reason } for API-key failures — see
    // lib/api/api-key-error.ts). Non-sensitive values only.
    public readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function unauthorized(message = "Not authenticated"): ApiError {
  return new ApiError(401, message);
}

export function forbidden(message = "Not authorized for this action"): ApiError {
  return new ApiError(403, message);
}

export function notFound(message = "Not found"): ApiError {
  return new ApiError(404, message);
}

export function badRequest(message: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(400, message, extra);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    // `error` is spread last so `extra` can never overwrite the message.
    return NextResponse.json({ ...(err.extra ?? {}), error: err.message }, { status: err.status });
  }
  console.error("Unhandled API error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
