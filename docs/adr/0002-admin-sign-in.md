---
status: accepted
date: 2026-11-18
---

# ADR 0002: Admin sign-in with email, password and database sessions

## Context

v1 has one role, Admin, used by the BFTM. Telegram is out of v1. The PRD settles email and password sign-in, with Admin accounts created by a seed script and no public sign-up. Story E0-S3 requires a 30-day httpOnly session, sign-out that ends the session on the server, and a lockout after 5 failed attempts in 15 minutes. The options were sessions of our own in Postgres, Better Auth, and Auth.js credentials. Auth.js credentials uses JWT sessions, which cannot be revoked on the server without extra work. Better Auth would work but brings sign-up and other endpoints to disable, plus a dependency to keep current, for a single seeded Admin.

## Decision

Build sign-in in the app, with no auth library:

- **Passwords** are hashed with Node's `crypto.scrypt` (N=2^15, r=8, p=1, 16-byte random salt, 64-byte key) and compared with `timingSafeEqual`. The hash string records its parameters, so they can be raised later.
- **Admin accounts** are created or updated only by `scripts/seed-admin.mts <email>`, which reads the password from a prompt or `ADMIN_PASSWORD`, never from argv in CI logs. There is no sign-up route.
- **Sessions:** on sign-in, the server creates a random 32-byte token, stores its SHA-256 hash in the `session` table with `expires_at` (30 days), and sets the raw token in the `bftm_session` cookie: httpOnly, `Secure` in production, `SameSite=Lax`, `Path=/`. Sign-out deletes the row and clears the cookie.
- **Checks:** `proxy.ts` (Next.js 16) does only an optimistic check: no cookie means a redirect to `/masuk?next=<path>` for pages, or 401 for `/api/*`. The real check is `requireAdmin()` in `src/server/auth/`, which looks up the session hash in the database. Every Route Handler and every Server Component that reads data calls it. The public routes are `/masuk`, `POST /api/auth/sign-in` and `/api/health`.
- **Lockout:** each failed attempt is a row in `sign_in_attempt` (normalised email, time). When there are 5 or more failures for the email in the last 15 minutes, sign-in is refused before the password is checked, with the same message for unknown and known emails. A success clears the email's failures.
- **CSRF:** mutations are JSON `POST`/`PATCH` requests with `SameSite=Lax` cookies, and Route Handlers also reject a request whose `Origin` header is present and does not match the host.

## Consequences

- No third party holds Admin credentials, and the whole flow is testable in Vitest against Postgres.
- The project owns the security of about 200 lines of code. The security review runs on E0-S3 and on any later change to `src/server/auth/`.
- Adding Funding Officer logins later (when the PRD adds them) extends the same tables with a role. It does not need a new auth system.
- There is no password reset in v1. The developer reruns the seed script to reset a password.
