---
status: accepted
date: 2026-11-18
---

# ADR 0004: Check-in photos in private Vercel Blob, uploaded through the server

## Context

Every Check-in needs a photo (E4-S3). Photos are JPEG, PNG or WebP of 5 MB or less, checked on the server by content (E4-S3 #2), and visible only to a signed-in Admin (E4-S3 #7). A Check-in must never exist without its photo (EC38). Vercel Blob supports private stores. Vercel Functions accept request bodies far above 5 MB.

## Decision

- The browser resizes the photo to 1600 px on the long edge as JPEG (E4-S4), then sends it with the Check-in fields as `multipart/form-data` to `POST /api/activities/:id/check-in`.
- The server checks the size, and checks the type by its magic bytes (JPEG, PNG, WebP). It stores the photo with `@vercel/blob` `put()` in a **private** store, at `check-ins/<check-in-uuid>.<ext>` with a random suffix. Only then does it insert the Check-in and mark the Activity Done in one database transaction. If that transaction fails, it deletes the blob.
- Photos are served by `GET /api/check-ins/:id/photo`, which calls `requireAdmin()` and streams the private blob with `Cache-Control: private`. The blob URL never reaches the browser.
- `BLOB_READ_WRITE_TOKEN` is added to `.env.example`. Tests use a storage interface in `src/server/storage/` with a Blob implementation and an in-memory one, so CI needs no Blob token.

## Consequences

- The content check happens before anything is stored, and the photo is never public.
- Uploads pass through the function, which is acceptable at 5 MB or less. A very slow connection is handled with a progress bar and a retry (E4-S4).
- Devops must create the private Blob store and connect it to the project before E4-S3 reaches a preview (`docs/ops/deploy.md`).
- If the process dies after `put()` and before the transaction, an orphaned blob remains. This is rare and harmless. It holds no customer data, and a cleanup can be added later if needed.
