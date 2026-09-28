# Production-readiness audit

Written against the checklist's own verification-pass list, item by item. Honest about
what's fully done, what's real-but-partial, and what's deliberately deferred with reasoning.

**Nothing in this build has run** — package installation is blocked in this sandbox (403
from the npm registry) and there's no live Postgres/Redis to connect to, so none of this
compiled, migrated, or executed here. Everything below is hand-traced, not test-verified.
Before deploying, run:

```
npm install
npx prisma migrate dev --name production-integration
npx tsc --noEmit
npm test
npm run build
```

---

## 1. Are all frontend features connected to real backend functionality?

Yes, with two explicit, documented exceptions:

- **Google Sign-In** — not built. Requires a real Google Cloud OAuth client (client
  ID/secret) that only you can provision; building the flow without real credentials to
  test against felt like a good way to ship something subtly broken. `.env.example` has
  the setup steps for when you're ready.
- **CSV export** — the checklist itself concluded this is fine to stay client-side
  (exports data already loaded into the page), so no backend endpoint was added.

Everything else — API keys, org-wide team + invites, candidate notes, notification
prefs/read-state, personal profile, password change, org profile — is wired end to end:
frontend calls a real endpoint, the endpoint touches the real database, the response
updates real UI state. Verified by grep, not just by writing the code: zero remaining
`uiDelay()` calls (the pattern every mock-write used) after wiring was complete.

## 2. Any remaining mock values, hardcoded demo states, or unused fake flows?

- `DESIGN_REVIEW_MODE` (hardcoded `true` in `apply.html`, bypassing the real API entirely)
  — removed.
- `MOCK_DB` and all ten `mock*()` fallback functions in `dashboard.html` — removed. This
  was the more serious issue of the two: every API-client method caught its own errors
  and silently substituted fabricated candidate data, meaning a broken or misconfigured
  backend would show an employer fake applicants with no indication they weren't real.
  Errors now propagate to the existing error-state UI instead.
- The artificial `uiDelay()` used by every fake save — removed as dead code once its
  last call site was wired to a real request (a real request has its own latency; no
  need to fake one).
- `CANDIDATE_NOTES_SEED` and the hardcoded single-owner `orgTeam` seed array — removed,
  replaced by real fetches.
- Confirmed via full-file grep across all three frontend files: zero remaining matches
  for `SEED`, `MOCK`, `DESIGN_REVIEW`, `BYPASS`, `dummyData`, `fakeData`.
- The **role switcher** in Settings (Owner/Admin/Recruiter/Viewer "preview as" toggle) was
  *not* removed — it's a legitimate preview tool (the backend enforces real permissions
  regardless of what's client-side-previewed), but it now starts from the signed-in
  user's actual role instead of defaulting everyone to Owner, which was a real,
  visible bug (every user saw full owner-level controls by default, regardless of
  their real permissions).

## 3. Do all API endpoints work correctly and handle failures properly?

30 route files total (see the changelog-equivalent list in this repo's git history for
the full endpoint inventory). Every endpoint follows the existing codebase's
`try { ... } catch (err) { return errorResponse(err) }` pattern, so failures return a
structured `{ error: "..." }` JSON body with an appropriate status code rather than an
unhandled crash. Specific failure paths deliberately covered:

- Signup: concurrent duplicate-email race caught at the DB-constraint level (P2002), not
  just the pre-check.
- Apply submission: the one-application-per-position DB constraint surfaces as a
  friendly message, not a raw 500.
- Analysis pipeline: a missing org API key fails the job cleanly with a specific,
  visible reason (`NoLlmCredentialError`) rather than crashing the worker or hanging.
- File upload: empty file, oversized file, wrong extension, and content that doesn't
  match its claimed type are all distinct, specific 400s.
- Decryption failure (wrong/rotated `ENCRYPTION_KEY`) is a distinct error type
  (`DecryptionError`) so it's distinguishable in logs from "no key saved."

## 4. Are authentication and authorization enforced correctly?

- Every mutating endpoint re-derived from the session, not trusted from the request body
  — role checks happen server-side via `requireRole`/`requireAuth`, independent of what
  the frontend's own `canManagePosition()` shows or hides.
- Privilege escalation closed: an Admin inviting a new team member cannot grant Owner;
  only an existing Owner can.
- Last-Owner protection: removing the final Owner from an org is rejected, preventing an
  org from being locked out of its own Owner-gated settings.
- Org-scoping verified on every new endpoint that touches another table by ID (notes,
  invites, team members) — each checks the target actually belongs to the caller's
  organization before acting, not just that *some* valid session exists.
- Password changes verify the actual current password via bcrypt comparison — the
  frontend's form previously had no way to do this at all, since only the backend holds
  the hash.
- Changing your own login email requires re-entering your password (no email-verification
  infrastructure exists to confirm the new address is reachable, so this is the real
  mitigation available against a hijacked-session account takeover).
- **Known, documented gap**: password change does not invalidate other active sessions.
  Doing that correctly means moving session verification from a pure stateless-JWT check
  to one that also hits the database on every authenticated request — a real
  architectural change to the auth path every single route in this app depends on. Not
  attempted under this change's scope; flagged rather than silently left undone.

## 5. Are database migrations and schema changes safe?

This is a pre-launch schema with (as far as this build can tell) no real production
data yet, so "safe" mostly means "does `prisma migrate dev` produce a coherent
migration" — hand-traced, not run. One thing worth flagging explicitly if this *does*
ever run against a database with real rows already in it: **the `OrgRole` enum values
were renamed** (`HIRING_MANAGER`→`ADMIN`, `INTERVIEWER`→`VIEWER`). Postgres will reject
removing an enum value that's still referenced by an existing row — if there's ever real
data with the old role names, that data needs an explicit `UPDATE` remapping old values
to new ones *before* the migration that drops them, not left to Prisma to figure out.
Same caution applies to `Application.submittedAt` → `createdAt` (a rename, not a type
change, so lower risk) and `ResumeExtract.education` changing from `String?` to `Json?`
(existing string values would not be valid JSON and would need a data migration, not a
bare column-type change).

## 6. Is sensitive data (API keys, credentials, user data) securely handled?

- Org API keys: AES-256-GCM encrypted at rest, a real working implementation (not a
  placeholder) using Node's built-in `crypto` — genuinely not a KMS-backed envelope
  encryption setup, since that needs real cloud infrastructure this sandbox can't
  provision, but also genuinely not the "hardcoded secret" anti-pattern the checklist
  warned against; the key is externally supplied via `ENCRYPTION_KEY`, and swapping in a
  KMS-decrypted key later doesn't require touching any of the encrypt/decrypt call sites.
- The raw key is never returned by any endpoint after the initial save — only a
  server-computed `sk-or-v1-••••••••1234` masked display, computed once at save time.
- Passwords: bcrypt, unchanged from the existing (already-correct) implementation.
- Invite tokens and password-reset tokens: stored as SHA-256 hashes, not raw values — a
  database read alone can't be replayed as a valid link, only the value that was actually
  emailed can.
- Audit logging on every API-key create/replace/remove and team invite/removal — records
  who and when, never the sensitive value itself.
- `.env.example` documents every required and optional secret with generation
  instructions, and `.dockerignore` excludes `.env`/`.env.local` from ever entering a
  built image.

## 7. Are environment variables and deployment configuration production-ready?

- `.env.example` fully rewritten: every new required and optional variable documented,
  with what breaks (loudly, not silently) if left unset.
- `next.config.js` added: `output: "standalone"` for a minimal Docker image, plus
  security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Strict-Transport-Security).
- **Known, documented gap**: no Content-Security-Policy header. The three frontend pages
  are hand-written HTML with inline `<script>`/`<style>` tags, so a CSP strict enough to
  matter (no `unsafe-inline`) would need those pages restructured first — flagged as a
  follow-up rather than shipping a CSP too loose to do anything.
- `Dockerfile` added: multi-stage build with **separate targets for the web server and
  the background worker**, since this app is two processes, not one — building
  `--target runner` for web, `--target worker` for the worker. `postinstall` now runs
  `prisma generate` automatically (previously missing — a production build would have
  either failed or silently used a stale generated client).
- **Known, documented gap**: file storage is still local disk (`lib/storage/
  local-storage.ts`) — fine for a single instance, but won't survive horizontal scaling
  or an ephemeral filesystem, and doesn't give the true per-request signed-URL model the
  checklist describes. A partial, real improvement was made (the file-serving endpoint
  now requires a session or a shared worker secret, closing the "fully public, no auth
  at all" gap) but the full migration to S3-compatible object storage was not attempted —
  hand-writing untested AWS SigV4/presigned-URL code felt riskier than clearly
  documenting the gap for a deliberate, tested follow-up.

## 8. Error handling, logging, and monitoring readiness

- Every new failure mode logs with `console.error`/`console.warn` and enough context to
  debug (which org, which action, what failed) without ever logging a secret value.
- Config-dependent features (email, CAPTCHA, virus scanning) log a specific, loud warning
  when unconfigured rather than failing silently or pretending to work — you'll see
  exactly what's not wired up the first time each path is exercised.
- **Not built**: structured/centralized logging (e.g. shipping logs to Datadog/Sentry) or
  APM. Out of scope for this pass — `console.*` calls are in place as the hooks a real
  logging pipeline would tap into, not a finished observability setup.

## 9. Any obvious security vulnerabilities?

Addressed this pass: unauthenticated file access, unvalidated file content (extension
spoofing), no rate limiting anywhere, no CAPTCHA on public write endpoints, no
server-side password strength floor, ad-hoc position "team members" that didn't
correspond to real accounts, a signup race condition, prompt injection into the
resume-extraction LLM call (added explicit delimiters and a "treat as data, not
instructions" system-prompt instruction), and the API-key-storage gap that was the
whole reason this pass started.

**Not addressed, flagged as follow-ups**: no session revocation on password change (see
§4); local file storage instead of true signed-URL object storage (see §7); no CSP (see
§7); Google OAuth unbuilt (see §1).

## 10. Does the application build successfully and is it ready to deploy?

Not verified — cannot run `npm install`/`next build` in this sandbox (blocked network
access to the npm registry). Every change was hand-traced across its full call chain,
and two independent automated passes were run against the actual source (not just
read by eye): one confirming every relative import in the codebase resolves to a real
file, a second confirming every named import matches a real export in that file — both
came back clean. That is meaningfully more confidence than "I read it and it looked
right," but it is not the same as a real `tsc --noEmit` and `npm test` run, which you'll
need to do before trusting this in production.
