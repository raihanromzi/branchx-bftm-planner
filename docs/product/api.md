# API contract

Maintained by the backend skill. The frontend builds against this file. Architecture and conventions: `docs/architecture.md` and ADR 0003.

All endpoints are JSON Route Handlers under `/api`. Every endpoint needs a signed-in Admin session except where an endpoint says otherwise (sign-in arrives in E0-S3).

## Shared conventions

Implemented in E0-S6: `src/server/http/` (error shape, idempotency, version check, Origin check) and `src/lib/validation/` (input rules, re-exported by `src/server/validation/`). Forms import the same zod rules from `@/lib/validation` for inline checks; the server always validates again.

### Errors

Every error has one shape. `fields` is present only on validation errors, with one message per field, keyed by the field path joined with `.`:

```json
{
  "error": {
    "code": "validation",
    "message": "Periksa kembali isian yang ditandai.",
    "fields": {
      "name": "Wajib diisi.",
      "contact.phone": "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
      "note": "Jangan tulis NIK atau nomor rekening nasabah."
    }
  }
}
```

| Status | `code` | When |
|--------|--------|------|
| `400` | `validation` | A field broke a rule. See `fields`. A problem with the body as a whole has no field and is in `message`. |
| `400` | `invalid_json` | The body is not JSON. |
| `400` | `idempotency_key` | A create without an `Idempotency-Key` header, or with one that is not a UUID. |
| `401` | `unauthorized` | Signed out or the session expired. |
| `403` | `forbidden_origin` | A mutation (`POST`, `PUT`, `PATCH`, `DELETE`) whose `Origin` header is present and does not match the host (ADR 0002). Requests without `Origin` pass. |
| `404` | `not_found` | The record does not exist ("Data tidak ditemukan."). |
| `409` | `version_conflict` | An update sent a `version` that is no longer current. |
| `409` | `conflict` (or a more specific code) | A rule conflict, such as a duplicate. The endpoint documents it. |
| `409` | `idempotency_key_pending` | Rare: the same create is still being processed. Retry with the same key. |
| `422` | `idempotency_key_reused` | The key was already used for a different kind of create. Generate a new key. |
| `422` | `invalid_state` (or a more specific code) | A forbidden state transition. The endpoint documents it. |
| `500` | `internal` | Unexpected. No details are returned; they are logged on the server. |

Every message is in Bahasa Indonesia and can be shown to the Admin as it is. Error responses are sent with `Cache-Control: no-store`.

Default field messages: a missing field is "Wajib diisi."; a value of the wrong type or format is "Isian tidak valid.", unless the rule below has its own message.

### Idempotent creates (`Idempotency-Key`)

- Every create sends an `Idempotency-Key` header: a UUID the client generates once per form submission and reuses on every retry of that submission (including a double tap). Generate a new key after a success or when the Admin changes the form.
- Missing or not a UUID: `400 idempotency_key`.
- The first request creates the record and answers `201` with it. A repeat with the same key creates nothing and answers `200` with the record already created (read again, so it shows its current state). Two requests with the same key at the same time also produce one record.
- If the create fails (for example `400` or `409`), the key is not kept, so a corrected retry with the same key is allowed.
- Keys are kept for 24 hours. After that a repeat counts as a new create.
- A key used for a different kind of create: `422 idempotency_key_reused`.

### Optimistic concurrency (`version`)

- Every record the Admin edits has an integer `version`, starting at `1`, returned with the record.
- Every update body includes the `version` the client loaded: an integer of at least 1, otherwise `400` with `fields.version`.
- If the record changed since then, nothing is saved and the response is:

  ```json
  { "error": { "code": "version_conflict", "message": "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru." } }
  ```

  with status `409`. An unknown id is `404 not_found`. A successful update returns the record with `version` increased by 1.

### Input rules

- **Phone numbers** are accepted as `08…`, `628…` or `+62…`, with or without spaces, dots or dashes, and are stored and returned as `+62…` (for example `0812-3456-7890` becomes `+6281234567890`). There must be 9 to 13 digits after the country code, and the first of them must not be `0`. Otherwise: "Nomor telepon tidak valid. Contoh: 0812 3456 7890".
- **Free text** (notes, purposes, reasons, addresses and similar) is trimmed and has at most 500 characters (counted as characters, so an emoji counts once), unless an endpoint sets a lower limit. Longer text: "Maksimal 500 karakter." (with the endpoint's limit). A required free-text field that is empty after trimming: "Wajib diisi." An optional one that is empty is stored as `null`.
- **No customer numbers in free text** (ADR 0001): digits joined across up to three spaces, dots or dashes on one line form one run. Numeric dates with a four-digit year (`18-11-2026`, `18.11.2026`, `2026-11-18`) are removed first. A run of 16 or more digits (a NIK), or of 10 or more digits that is not a valid phone number by the rule above (an account number), is rejected with "Jangan tulis NIK atau nomor rekening nasabah." So `3201 2345 6789 0001`, `3201.2345.6789.0001` and `1234567890` are rejected; `0812 3456 7890`, `+62 812-3456-7890`, `350 rekening` and `Blok B 12` are accepted. Notes with dates and times, such as `Kunjungan 18-11-2026 10.30`, are accepted.

### Caching

API responses are not cached.

## Health

### `GET /api/health`

Reports whether the app can reach its database. Public: no session needed. Never cached (`Cache-Control: no-store`).

The check runs `select 1` with a 3 second timeout.

| Status | Body | When |
|--------|------|------|
| `200` | `{ "status": "ok", "database": "ok" }` | The database answered. |
| `503` | `{ "status": "error", "database": "error" }` | The database did not answer in time, refused the connection, or `DATABASE_URL` is not set. |

The response never contains connection details (host, database name, user, password or driver error). The cause is logged on the server only, as an error code.
