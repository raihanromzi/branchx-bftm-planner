# API contract

Maintained by the backend skill. The frontend builds against this file. Architecture and conventions: `docs/architecture.md` and ADR 0003.

All endpoints are JSON Route Handlers under `/api`. Every endpoint needs a signed-in Admin session except where an endpoint says otherwise (sign-in arrives in E0-S3).

## Shared conventions

> To be implemented in E0-S6. Endpoints added before then follow them where they apply.

- **Errors** have one shape:

  ```json
  { "error": { "code": "validation", "message": "…", "fields": { "phone": "…" } } }
  ```

  `fields` is present only for validation errors. Status codes: `400` validation, `401` signed out, `404` missing, `409` version conflict or rule conflict, `422` forbidden state transition.
- **Idempotent creates:** every create takes an `Idempotency-Key` header (a client-generated UUID). The key is stored for 24 hours with the created record's ID, and a retry with the same key returns the record already created instead of a duplicate.
- **Optimistic concurrency:** every update sends the `version` the client loaded. If the record has changed since, nothing is saved and the response is `409`.
- **Caching:** API responses are not cached.

## Health

### `GET /api/health`

Reports whether the app can reach its database. Public: no session needed. Never cached (`Cache-Control: no-store`).

The check runs `select 1` with a 3 second timeout.

| Status | Body | When |
|--------|------|------|
| `200` | `{ "status": "ok", "database": "ok" }` | The database answered. |
| `503` | `{ "status": "error", "database": "error" }` | The database did not answer in time, refused the connection, or `DATABASE_URL` is not set. |

The response never contains connection details (host, database name, user, password or driver error). The cause is logged on the server only, as an error code.
