/**
 * The public, browser-facing base URL of the app (no trailing slash).
 *
 * Prefer NEXT_PUBLIC_APP_URL: behind a reverse proxy / PaaS router, the request's own origin can be an internal
 * host or the wrong scheme (http instead of https). Falling back to the request origin keeps local dev working
 * without any configuration.
 *
 * The variable is read through a variable key on purpose. Next.js replaces literal `process.env.NEXT_PUBLIC_*`
 * references with their build-time value; a dynamic lookup is always resolved at runtime, so changing the
 * environment variable on a running deployment (or building one image for several environments) just works.
 */
const PUBLIC_URL_ENV = "NEXT_PUBLIC_APP_URL";

export function getPublicBaseUrl(requestOrigin: string): string {
  const base = process.env[PUBLIC_URL_ENV] || requestOrigin;
  return base.replace(/\/$/, "");
}

export function buildApplyUrl(positionId: string, requestOrigin: string): string {
  return `${getPublicBaseUrl(requestOrigin)}/apply/${positionId}`;
}

/**
 * True only for a resume file that this app's own upload endpoint handed out: `<public base>/api/uploads/<uuid>.pdf|docx`.
 *
 * The apply route stores `resumeUrl` and the worker later downloads it — attaching its internal token when the URL is on
 * this app's origin. Accepting any URL there would let an anonymous visitor make the worker request arbitrary hosts
 * (internal addresses, cloud metadata) or any of this app's own endpoints while carrying that token.
 */
export function isOwnUploadUrl(value: string, requestOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  let own: URL;
  try {
    own = new URL(getPublicBaseUrl(requestOrigin));
  } catch {
    return false;
  }
  if (u.origin !== own.origin || u.username || u.password || u.search || u.hash) return false;
  // `own.pathname` is "/" for a plain origin; a sub-path deployment (https://host/hirelab) is respected.
  const prefix = own.pathname.replace(/\/$/, "");
  return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/uploads/[0-9a-fA-F-]{36}\\.(pdf|docx)$`).test(u.pathname);
}
