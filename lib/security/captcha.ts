// Real CAPTCHA verification via Cloudflare Turnstile's server-side
// siteverify endpoint (https://developers.cloudflare.com/turnstile/) —
// chosen over reCAPTCHA/hCaptcha because it's a drop-in single POST with
// no SDK, and Cloudflare offers it free with no request cap. Requires:
//   - TURNSTILE_SECRET_KEY (server-side, this file)
//   - a Turnstile sitekey embedded in apply.html's widget (frontend change,
//     outside this backend's scope, but the public sitekey is meant to be
//     public — only the secret key here is sensitive)
//
// If TURNSTILE_SECRET_KEY isn't set, verification is skipped — the public
// apply endpoint remains open to bot submissions until you configure this
// (see UPLOAD_REQUIRE_VIRUS_SCAN's sibling env var, APPLY_REQUIRE_CAPTCHA,
// for how callers decide whether that's acceptable for your deployment
// stage).

export function isCaptchaConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export async function verifyCaptchaToken(token: string, remoteIp?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — see APPLY_REQUIRE_CAPTCHA at the call site

  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success: boolean };
    return !!data.success;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[captcha] Turnstile verification request failed:", err);
    // Fail closed here (unlike rate-limiting) — a CAPTCHA outage
    // shouldn't silently turn into "no bot protection at all" on a
    // public write endpoint; better to reject and let a real applicant
    // retry than to open the floodgates during a provider outage.
    return false;
  }
}
