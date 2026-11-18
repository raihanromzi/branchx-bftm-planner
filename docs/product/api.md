# API contract

Maintained by the backend skill. The frontend builds against this file. Architecture and conventions: `docs/architecture.md` and ADR 0003.

All endpoints are JSON Route Handlers under `/api`. Every endpoint needs a signed-in Admin session except where an endpoint says otherwise. See [Authentication](#authentication).

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
| `401` | `unauthorized` | Signed out or the session expired ("Sesi Anda sudah berakhir. Silakan masuk lagi."). |
| `401` | `invalid_credentials` | Sign-in only: wrong email or password. |
| `429` | `locked_out` | Sign-in only: too many failed attempts for the email. |
| `403` | `forbidden_origin` | A mutation (`POST`, `PUT`, `PATCH`, `DELETE`) whose `Origin` header is present and does not match the host (ADR 0002). Requests without `Origin` pass. |
| `404` | `not_found` | The record does not exist ("Data tidak ditemukan."). |
| `409` | `version_conflict` | An update sent a `version` that is no longer current. |
| `409` | `conflict` (or a more specific code) | A rule conflict, such as a duplicate. The endpoint documents it. |
| `409` | `idempotency_key_pending` | Rare: the same create is still being processed. Retry with the same key. |
| `422` | `idempotency_key_reused` | The key was already used for a different kind of create. Generate a new key. |
| `422` | `invalid_state` (or a more specific code) | A forbidden state transition. The endpoint documents it. |
| `422` | `funding_officer_inactive`, `funding_officer_not_found` | The Funding Officer set on a record is inactive or does not exist. See [the rule](#rule-only-an-active-funding-officer-can-be-assigned). |
| `422` | `prospect_archived` | An edit to an archived Prospect. See [Prospects](#prospects). |
| `409` | `template_name_taken`, `template_in_use` | Pipeline Templates: another active template has the name, or a delete of a template a Pipeline uses. See [Pipeline Templates](#pipeline-templates). |
| `422` | `template_archived`, `last_template`, `template_archived_cannot_start`, `template_not_found` | Pipeline Templates: an edit to an archived template, archiving or deleting the only active one, or starting a Pipeline from an archived or unknown one. |
| `422` | `prospect_has_open_pipeline` | Archiving a Prospect that has an open or On Hold Pipeline ("Tutup atau tunda Pipeline dulu."). See [Prospects](#prospects). |
| `409` | `pipeline_already_open` | Pipelines: starting or reopening one while the Prospect has another open or On Hold Pipeline. See [Pipelines](#pipelines). |
| `422` | `pipeline_closed`, `invalid_transition`, `prospect_not_found` | Pipelines: a change the Pipeline's Outcome does not allow, an Outcome transition that is not allowed, or starting one for an unknown Prospect. |
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

## Authentication

Implemented in E0-S3 (ADR 0002). One role exists in v1: Admin. Admins are created by `npm run admin:seed`; there is no sign-up endpoint.

- **Session cookie:** `bftm_session`, set by sign-in. `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (30 days), and `Secure` in production. The browser sends it automatically; the frontend never reads it. The server keeps only a SHA-256 hash of the token, so signing out (or re-seeding the Admin's password) ends the session for good.
- **Public:** `POST /api/auth/sign-in` and `GET /api/health`, and the `/masuk` page. Everything else needs a valid session.
- **Without a valid session** (no cookie, an unknown cookie, or an expired session), every other API route answers:

  ```json
  { "error": { "code": "unauthorized", "message": "Sesi Anda sudah berakhir. Silakan masuk lagi." } }
  ```

  with status `401`. A page visited without the cookie is redirected (`307`) to `/masuk?next=<path and query, URL-encoded>`, for example `/masuk?next=%2Fprospek%3Fq%3Dabc`.
- **Lockout (EC41):** 5 failed sign-ins for one email within 15 minutes refuse further attempts for that email with `429 locked_out`, even with the right password, until the oldest of those failures is 15 minutes old. Refused attempts do not extend it. A successful sign-in clears the email's failures. Unknown and known emails behave identically.
- **Origin check:** `POST` requests whose `Origin` header is present and does not match the host are refused with `403 forbidden_origin`.

### `POST /api/auth/sign-in`

Public. Request:

```json
{ "email": "admin@contoh.id", "password": "…" }
```

| Field | Rules |
|-------|-------|
| `email` | Required. Trimmed and lower-cased; at most 254 characters; must look like an email ("Format email tidak valid."). |
| `password` | Required, as typed (not trimmed); at most 200 characters. |

| Status | Body | When |
|--------|------|------|
| `200` | `{ "admin": { "email": "admin@contoh.id" } }`, plus `Set-Cookie: bftm_session=…` | Email and password match. |
| `400` | `validation` with `fields.email` / `fields.password`, or `invalid_json` | The body broke a rule. Not counted as a failed attempt. |
| `401` | `{ "error": { "code": "invalid_credentials", "message": "Email atau kata sandi salah." } }` | Unknown email or wrong password. The two responses are byte-identical. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `429` | `{ "error": { "code": "locked_out", "message": "Terlalu banyak percobaan. Coba lagi dalam 15 menit." } }` | Locked out (see above). |

The form validation rules are exported as `signInInput` from `@/lib/validation`.

### `POST /api/auth/sign-out`

No body. Ends this browser's session on the server and clears the cookie.

| Status | Body | When |
|--------|------|------|
| `204` | none, plus `Set-Cookie: bftm_session=; Max-Age=0; …` | The session was ended. The old cookie no longer works. |
| `401` | `unauthorized`, and the cookie is still cleared | No valid session (already signed out or expired). The frontend can treat this as signed out. |
| `403` | `forbidden_origin` | Cross-origin request; the session is kept. |

### `GET /api/auth/me`

The signed-in Admin. Never cached.

| Status | Body | When |
|--------|------|------|
| `200` | `{ "admin": { "email": "admin@contoh.id" } }` | Valid session. |
| `401` | `unauthorized` | No valid session. |

### Server-side helpers (for later stories)

- Route Handlers: `requireAdmin(request)` from `@/server/auth` returns `{ id, email }` or throws `ApiError` 401. Call it first in every protected handler; `tests/unit/E0-S3.test.ts` checks every `route.ts` under `src/app/api/` for this.
- Server Components: `getAdmin()` (memoised per render, `null` when signed out) and `requireAdminPage(path)` (redirects to `/masuk?next=<path>`) from `@/server/auth/page`.

## Funding Officers

Implemented in E1-S1. A Funding Officer is a team member that work is assigned to. They do not sign in. A Funding Officer is never deleted (EC22): there is no `DELETE` endpoint, and `DELETE` on these paths answers `405`. Instead they are deactivated, and can be reactivated.

Every endpoint needs an Admin session (`401 unauthorized` otherwise). Mutations are refused cross-origin (`403 forbidden_origin`). An `:id` that is unknown or not a UUID is `404 not_found`. Responses are sent with `Cache-Control: no-store`.

### The record

```json
{
  "id": "6f1c2a4e-1b2d-4c3e-9f8a-1234567890ab",
  "name": "Rina Kartika",
  "phone": "+6281234567890",
  "active": true,
  "version": 1,
  "createdAt": "2026-11-19T02:15:00.000Z",
  "updatedAt": "2026-11-19T02:15:00.000Z"
}
```

| Field | Rules |
|-------|-------|
| `name` | Required. Free text (see [Input rules](#input-rules)) with at most **100** characters: trimmed, "Wajib diisi." when empty, "Maksimal 100 karakter." when longer, and the customer-number guard. |
| `phone` | Required. Normalised to `+62…` by the shared phone rule ("Nomor telepon tidak valid. Contoh: 0812 3456 7890"). |
| `active` | Set by the server: `true` on create, changed only by deactivate and reactivate. Ignored if sent. |
| `version` | See [Optimistic concurrency](#optimistic-concurrency-version). |

The zod schemas are exported from `@/lib/validation` for inline form checks: `createFundingOfficerInput`, `updateFundingOfficerInput`, `fundingOfficerStatusInput` and `FUNDING_OFFICER_NAME_MAX`.

### `GET /api/funding-officers`

Every Funding Officer: **active ones first, then inactive ones**, each group sorted by name ignoring case. No paging (a team has about 15); at most 200 are returned.

| Status | Body |
|--------|------|
| `200` | `{ "items": [ <record>, … ] }`, possibly empty. |

### `POST /api/funding-officers`

Adds an active Funding Officer. Needs an `Idempotency-Key` header (scope `funding-officer.create`).

```json
{ "name": "Rina Kartika", "phone": "0812 3456 7890" }
```

| Status | Body | When |
|--------|------|------|
| `201` | The record | Created. |
| `200` | The same record, read again | A repeat with the same `Idempotency-Key`. Nothing new is created. |
| `400` | `validation` with `fields.name` / `fields.phone`, `invalid_json`, or `idempotency_key` | Bad input or a missing or malformed key. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `422` | `idempotency_key_reused` | The key was used for a different kind of create. |

### `GET /api/funding-officers/:id`

| Status | Body | When |
|--------|------|------|
| `200` | The record | Found (active or not). |
| `404` | `not_found` | Unknown id. |

### `PATCH /api/funding-officers/:id`

Changes the name and/or the phone. Either may be left out; `version` is required.

```json
{ "name": "Rina Kartika", "phone": "0813 1111 2222", "version": 1 }
```

An inactive Funding Officer can be edited too; this does not reactivate them.

| Status | Body | When |
|--------|------|------|
| `200` | The record, `version` increased by 1 | Saved. |
| `400` | `validation` with `fields.name` / `fields.phone` / `fields.version`, or `invalid_json` | Bad input. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The record changed since the client loaded it. |

### `POST /api/funding-officers/:id/deactivate` and `POST /api/funding-officers/:id/reactivate`

Deactivate sets `active` to `false`: no new work can be assigned to the Funding Officer (see the rule below). Existing Prospects, Pipelines and Activities keep their Funding Officer, and nothing else changes. Reactivate sets `active` back to `true`.

```json
{ "version": 2 }
```

**Idempotent:** when the Funding Officer is already in the requested state (deactivating an inactive one, or reactivating an active one), the answer is `200` with the record unchanged: nothing is written, `version` does not change, and the sent `version` is not checked. So a double tap or a retry is never a conflict.

| Status | Body | When |
|--------|------|------|
| `200` | The record, with `active` changed and `version` increased by 1, or unchanged (see above) | Done. |
| `400` | `validation` with `fields.version`, or `invalid_json` | No valid `version`. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The state has to change, and the record changed since the client loaded it. |

### Rule: only an active Funding Officer can be assigned

Applies to **every create or update that sets a Funding Officer** on a Prospect (E2-S1), a Pipeline (E3-S3) or an Activity (E4-S1). The Funding Officer sent must exist and be active. Otherwise nothing is saved and the response is one of:

| Status | Body | When |
|--------|------|------|
| `422` | `{ "error": { "code": "funding_officer_inactive", "message": "Funding Officer ini sudah nonaktif." } }` | The Funding Officer is deactivated. |
| `422` | `{ "error": { "code": "funding_officer_not_found", "message": "Funding Officer tidak ditemukan." } }` | No Funding Officer has that id (or it is not a UUID). |

Records that already have a Funding Officer who is later deactivated are not affected (EC20). An update that does not change the Funding Officer is not checked against this rule.

Server side: call `assertAssignableFundingOfficer(tx, fundingOfficerId)` from `@/server/funding-officers` inside the transaction that writes the record. It locks the Funding Officer's row `FOR SHARE`, so a deactivation running at the same moment waits for that write to commit.

## Prospects

Implemented in E2-S1. A Prospect is an institution or venue the team works to open accounts at. It is never an account holder (ADR 0001): the only person stored is one Contact Person, and the only number is Potential Accounts. A Prospect is never deleted (EC22): there is no `DELETE` endpoint, and `DELETE` on these paths answers `405`. Instead it is archived, and can be restored.

Every endpoint needs an Admin session (`401 unauthorized` otherwise). Mutations are refused cross-origin (`403 forbidden_origin`). An `:id` that is unknown or not a UUID is `404 not_found`. Responses are sent with `Cache-Control: no-store`.

### The record

```json
{
  "id": "0b7e…",
  "name": "SDN 3 Cibinong",
  "category": "sekolah",
  "address": "Jl. Raya Bogor Km 43",
  "location": { "lat": -6.4817, "lng": 106.854 },
  "contact": { "name": "Ibu Sri Wahyuni", "role": "Kepala Sekolah", "phone": "+6281234567890" },
  "potentialAccounts": 350,
  "fundingOfficer": { "id": "6f1c…", "name": "Rina Kartika", "active": true },
  "note": "Minta brosur tabungan pelajar.",
  "archived": false,
  "archivedAt": null,
  "version": 1,
  "createdAt": "2026-11-19T02:15:00.000Z",
  "updatedAt": "2026-11-19T02:15:00.000Z"
}
```

| Field | Rules |
|-------|-------|
| `name` | Required. Free text with at most **150** characters: trimmed; "Nama Prospect wajib diisi." when missing or blank; "Maksimal 150 karakter." when longer; the customer-number guard. Stored as typed (after trimming). |
| `category` | Optional: one of `sekolah`, `pasar`, `perusahaan`, `instansi`, `komunitas`, `lainnya` (labels Sekolah, Pasar, Perusahaan, Instansi, Komunitas, Lainnya; `PROSPECT_CATEGORIES` and `PROSPECT_CATEGORY_LABELS` in `@/lib/validation`), or `null`. Missing or `null` is stored as `null`, and responses (record and list rows) carry `"category": null`. Any other value, including `""`, is "Isian tidak valid." Only the name and the Funding Officer are required (docs/design/E2-S3.md). |
| `fundingOfficerId` | Required on create (`fundingOfficer` in responses). Must be an active Funding Officer: see [the rule](#rule-only-an-active-funding-officer-can-be-assigned) (`422`). |
| `address` | Optional free text, at most 500 characters; blank or `null` is stored as `null`. |
| `location` | Optional: `{ "lat": number, "lng": number }` or `null`. Both are required in the object (`fields["location.lat"]` / `fields["location.lng"]`: "Wajib diisi.", or "Isian tidak valid." for a non-number). Outside Indonesia's bounding box (latitude −11 to 6, longitude 95 to 141, inclusive): `fields.location` = "Lokasi di luar Indonesia." (EC13). |
| `contact` | Optional: `{ "name", "role", "phone" }`, each optional (missing, `null` or blank is `null`). `name` and `role`: free text, at most 100 characters, with the customer-number guard. `phone`: the shared phone rule, stored as `+62…`. Errors are keyed `contact.name`, `contact.role`, `contact.phone`. Responses always carry the object, with `null` fields when empty. |
| `potentialAccounts` | Optional: an integer from 0 to 100,000, or `null`. A decimal, negative, larger number or a string ("10"): "Potensi rekening harus bilangan bulat 0 sampai 100.000." (EC10). |
| `note` | Optional free text, at most 500 characters, with the customer-number guard. |
| `archived`, `archivedAt` | Set by the server: changed only by archive and restore. |
| `version` | See [Optimistic concurrency](#optimistic-concurrency-version). |

Any other key in the body (for example an account holder's name, NIK or account number) is ignored and never stored. The database also enforces the name length, the Potential Accounts range, and that `lat`/`lng` are both set or both empty and inside the box.

The zod schemas are exported from `@/lib/validation` for inline form checks: `createProspectInput`, `updateProspectInput`, `prospectStatusInput`, `prospectListQuery`, `prospectLocation`, `prospectContact`, `potentialAccounts`, `prospectNameKey`, and the constants `PROSPECT_NAME_MAX`, `POTENTIAL_ACCOUNTS_MAX`, `INDONESIA_BOUNDS` and the messages.

### Matching names (`duplicates`, EC14)

Two names match when they are equal after trimming, collapsing runs of whitespace to one space and lower-casing (`prospectNameKey`): "SDN  3 Cibinong " matches "sdn 3 cibinong". A match never blocks a save, because two branches can share a name. Create and update answer `{ "prospect": <record>, "duplicates": [ { "id", "name" }, … ] }`, where `duplicates` lists the **other, non-archived** Prospects with a matching name, sorted by name, at most 20. The Prospect itself is never listed. The frontend shows the warning after the save; nothing is repeated automatically.

### `GET /api/prospects`

A page of Prospects, **sorted by name** ignoring case and repeated spaces. All filtering is on the server. Query parameters (blank counts as missing):

| Parameter | Meaning |
|-----------|---------|
| `q` | Search: matches anywhere in the name, ignoring case and repeated spaces. `%`, `_` and `\` match themselves. At most 150 characters. |
| `category` | One Category value. Prospects without a Category never match it. |
| `fundingOfficerId` | A Funding Officer's id (a UUID). |
| `archived` | `0` (default): archived Prospects are left out. `1`: archived Prospects are **included** alongside the others, each with `archived: true` (the "Tampilkan arsip" toggle). |
| `noLocation` | `1`: only Prospects without a location. `0` (default): no filter. |
| `page` | 1-based, default `1`. A page past the end answers an empty `items` with the real `total`. |
| `templateId` + `stagePosition` | The Stage filter (E3-S3 #9): only Prospects whose **open or On Hold** Pipeline was started from template `templateId` (a UUID) and is now at Stage `stagePosition` (1 to 30). The two go together: one without the other is `400` with "Wajib diisi." on the missing one. Prospects with only Won or Lost Pipelines never match. |

Each row:

```json
{
  "id": "0b7e…",
  "name": "SDN 3 Cibinong",
  "category": "sekolah",
  "fundingOfficer": { "id": "6f1c…", "name": "Rina Kartika", "active": true },
  "hasLocation": true,
  "potentialAccounts": 350,
  "archived": false,
  "openPipeline": { "stageName": "Presentasi", "stagePosition": 3, "stageCount": 5 }
}
```

`openPipeline` (filled since E3-S3 #9): `{ "stageName": string, "stagePosition": number, "stageCount": number } | null`, the current Stage's name, its 1-based position and the Pipeline's Stage count, of the Prospect's **open or On Hold** Pipeline; `null` when it has none (no Pipeline, or only Won or Lost ones). An On Hold Pipeline shows its Stage too; the list does not say it is On Hold. The Prospect list (E2-S2) renders this shape as the Stage badge (`src/components/prospects/shared.ts`, `OpenPipelineStage`).

| Status | Body | When |
|--------|------|------|
| `200` | `{ "items": [ <row>, … ], "page": 1, "pageSize": 50, "total": 1248 }` | Always 50 per page. |
| `400` | `validation` with `fields.<parameter>` | A parameter is invalid (for example `page=0`, an unknown `category`, a `fundingOfficerId` that is not a UUID, `archived=yes`, `templateId` without `stagePosition`). |

Measured with 2,000 Prospects on local Postgres 16: every query shape answers in a few milliseconds (budget 500 ms, EC6). With 2,000 Pipelines added (E3-S3), the medians are 1 to 6 ms, the Stage filter included.

### `POST /api/prospects`

Adds a Prospect. Needs an `Idempotency-Key` header (scope `prospect.create`).

```json
{
  "name": "SDN 3 Cibinong",
  "category": "sekolah",
  "fundingOfficerId": "6f1c…",
  "address": "Jl. Raya Bogor Km 43",
  "location": { "lat": -6.4817, "lng": 106.854 },
  "contact": { "name": "Ibu Sri Wahyuni", "role": "Kepala Sekolah", "phone": "0812 3456 7890" },
  "potentialAccounts": 350,
  "note": "Minta brosur tabungan pelajar."
}
```

| Status | Body | When |
|--------|------|------|
| `201` | `{ "prospect": <record>, "duplicates": [ … ] }` | Created. |
| `200` | The same shape, read again (duplicates recomputed) | A repeat with the same `Idempotency-Key`. Nothing new is created. |
| `400` | `validation` with `fields`, `invalid_json`, or `idempotency_key` | Bad input or a missing or malformed key. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `422` | `funding_officer_inactive`, `funding_officer_not_found` | The Funding Officer cannot be assigned. The key is not kept, so a corrected retry with it is allowed. |
| `422` | `idempotency_key_reused` | The key was used for a different kind of create. |

### `GET /api/prospects/:id`

| Status | Body | When |
|--------|------|------|
| `200` | The record | Found. **An archived Prospect is returned too**, with `archived: true` and `archivedAt` set (EC40): the detail page opens it read-only with a restore action. |
| `404` | `not_found` | Unknown id. |

### `PATCH /api/prospects/:id`

Changes any subset of the fields; `version` is required. A field left out is unchanged. `null` clears an optional field: `"location": null` removes the location, `"category": null` removes the Category. A `contact` object replaces all three Contact Person fields (a field missing from it becomes `null`); `"contact": null` clears them.

```json
{ "fundingOfficerId": "9a2d…", "location": null, "version": 3 }
```

Changing the Funding Officer changes only the Prospect (EC26): Pipelines and Activities keep theirs. The Funding Officer rule is checked only when `fundingOfficerId` changes, so a Prospect whose Funding Officer was later deactivated can still be edited.

| Status | Body | When |
|--------|------|------|
| `200` | `{ "prospect": <record>, "duplicates": [ … ] }`, `version` increased by 1 | Saved. `duplicates` is computed only when the name changed; otherwise `[]`. |
| `400` | `validation` with `fields`, or `invalid_json` | Bad input. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The record changed since the client loaded it. |
| `422` | `{ "error": { "code": "prospect_archived", "message": "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya." } }` | The Prospect is archived. Restore it first. |
| `422` | `funding_officer_inactive`, `funding_officer_not_found` | The new Funding Officer cannot be assigned. |

### `POST /api/prospects/:id/archive` and `POST /api/prospects/:id/restore`

Archive sets `archivedAt`: the Prospect leaves the default list but can still be opened by id and restored. Restore clears it.

```json
{ "version": 2 }
```

**Idempotent:** when the Prospect is already in the requested state, the answer is `200` with the record unchanged: nothing is written, `version` does not change, and the sent `version` is not checked.

| Status | Body | When |
|--------|------|------|
| `200` | The record (not wrapped), with `archived` changed and `version` increased by 1, or unchanged (see above) | Done. |
| `400` | `validation` with `fields.version`, or `invalid_json` | No valid `version`. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The state has to change, and the record changed since the client loaded it. |
| `422` | `{ "error": { "code": "prospect_has_open_pipeline", "message": "Tutup atau tunda Pipeline dulu." } }` | Archive only: the Prospect has an open **or On Hold** Pipeline (E3-S3 #8, EC19). Close it (Won or Lost) first. Pipelines that are all Won or Lost do not block archiving. |

All rules for archiving run in the one archive transaction, with the Prospect's row locked (the lock starting and reopening a Pipeline also take, so no Pipeline can open meanwhile). E4-S1 adds `GET /api/prospects/:id/archive-preview` (future Activities count) and cancels those Activities on archive.

## Pipeline Templates

Implemented in E3-S1. A Pipeline Template is a name and an ordered list of Stages, each with an ordered checklist of Task names (zero or more). A Pipeline copies its template's Stages and Tasks when it starts (E3-S3), so **editing a template changes only new Pipelines** (EC21). A template that a Pipeline uses can be archived but not deleted; one that no Pipeline uses can be deleted. This is the only `DELETE` in the app.

Every endpoint needs an Admin session (`401 unauthorized` otherwise). Mutations are refused cross-origin (`403 forbidden_origin`). An `:id` that is unknown or not a UUID is `404 not_found`. Responses are sent with `Cache-Control: no-store`.

### The default template

A fresh database has one template, **"Umum"**, seeded by the migration `drizzle/0004_pipeline_template.sql` (so production gets it from `vercel-build`'s `db:migrate` too). It is inserted only when no template exists. Its Stages and starter Tasks (PRD open question 4, approved at the PRD gate on 2026-11-18):

| # | Stage | Tasks |
|---|-------|-------|
| 1 | Identifikasi | Kumpulkan data Prospect; Tentukan Kontak |
| 2 | Pendekatan | Hubungi Kontak; Jadwalkan kunjungan pertama |
| 3 | Presentasi | Siapkan materi; Presentasi ke pengambil keputusan; Kirim proposal |
| 4 | Negosiasi | Bahas jumlah rekening; Sepakati jadwal pembukaan |
| 5 | Pembukaan Rekening | Siapkan formulir; Kumpulkan dokumen pendukung |

It is an ordinary template: it can be edited, archived, restored or deleted under the same rules.

### The record

```json
{
  "id": "3c9e…",
  "name": "Umum",
  "archived": false,
  "archivedAt": null,
  "pipelineCount": 0,
  "version": 1,
  "createdAt": "2026-11-19T02:15:00.000Z",
  "updatedAt": "2026-11-19T02:15:00.000Z",
  "stages": [
    {
      "id": "a1…",
      "position": 1,
      "name": "Identifikasi",
      "tasks": [
        { "id": "b1…", "position": 1, "name": "Kumpulkan data Prospect" },
        { "id": "b2…", "position": 2, "name": "Tentukan Kontak" }
      ]
    }
  ]
}
```

`position` starts at 1 and follows the order sent. **Stage and Task ids change on every save** (`PUT` replaces them all); nothing refers to them, because Pipelines copy Stages and Tasks. `pipelineCount` is the number of Pipelines (open, On Hold, Won or Lost) started from the template (counted since E3-S3). The editor offers "Hapus" only when it is `0`.

| Field | Rules |
|-------|-------|
| `name` | Required. Free text with at most **100** characters: trimmed; "Nama template wajib diisi." when missing or blank; "Maksimal 100 karakter."; the customer-number guard. **Unique among active templates**, ignoring case and repeated spaces (`pipelineTemplateNameKey`): otherwise `409 template_name_taken` (below). An archived template's name can be reused. |
| `stages` | Required: **1 to 30** Stages, in order. Missing, `null` or `[]`: `fields.stages` = "Tambahkan minimal satu Stage." (EC3). More than 30: "Maksimal 30 Tahap." |
| `stages.N.name` | Required. At most **60** characters: "Nama Tahap wajib diisi." when missing or blank; "Maksimal 60 karakter."; the customer-number guard. Two Stages may share a name. |
| `stages.N.tasks` | Optional: **0 to 30** Tasks, in order; missing or `null` is `[]`. More than 30: `fields["stages.N.tasks"]` = "Maksimal 30 Tugas per Tahap." |
| `stages.N.tasks.M.name` | Required. At most **120** characters: "Nama Tugas wajib diisi." when missing or blank; "Maksimal 120 karakter."; the customer-number guard. |
| `archived`, `archivedAt` | Set by the server: changed only by archive and restore. |
| `version` | See [Optimistic concurrency](#optimistic-concurrency-version). |

**Field error keys** are the zod path joined with `.`, with **0-based** indexes into the arrays sent: `name`, `stages`, `stages.2.name`, `stages.1.tasks`, `stages.1.tasks.0.name`. For example:

```json
{ "error": { "code": "validation", "message": "Periksa kembali isian yang ditandai.",
  "fields": { "stages.1.name": "Nama Tahap wajib diisi.", "stages.1.tasks.0.name": "Nama Tugas wajib diisi." } } }
```

Unknown keys (including `id` or `position` on Stages and Tasks) are ignored. The database also enforces the name lengths and unique positions.

The zod schemas are exported from `@/lib/validation` for inline form checks: `createPipelineTemplateInput`, `updatePipelineTemplateInput`, `pipelineTemplateStatusInput`, `templateStageInput`, `templateTaskInput`, `pipelineTemplateNameKey`, the limits `PIPELINE_TEMPLATE_NAME_MAX`, `STAGE_NAME_MAX`, `TASK_NAME_MAX`, `STAGES_MAX`, `TASKS_PER_STAGE_MAX`, and the messages.

### `GET /api/pipeline-templates`

Every template, archived ones included: **active ones first, then archived ones**, each group sorted by name ignoring case. No paging; at most 200.

```json
{ "items": [ { "id": "3c9e…", "name": "Umum", "stageCount": 5, "pipelineCount": 0, "archived": false, "version": 1, "updatedAt": "2026-11-19T02:15:00.000Z" } ] }
```

| Status | Body |
|--------|------|
| `200` | `{ "items": [ <row>, … ] }` |

### `POST /api/pipeline-templates`

Adds a template. Needs an `Idempotency-Key` header (scope `pipeline-template.create`).

```json
{
  "name": "Sekolah",
  "stages": [
    { "name": "Identifikasi", "tasks": [ { "name": "Kumpulkan data Prospect" } ] },
    { "name": "Presentasi" }
  ]
}
```

| Status | Body | When |
|--------|------|------|
| `201` | The record | Created. |
| `200` | The same record, read again | A repeat with the same `Idempotency-Key`. Nothing new is created. |
| `400` | `validation` with `fields`, `invalid_json`, or `idempotency_key` | Bad input or a missing or malformed key. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `409` | `{ "error": { "code": "template_name_taken", "message": "Nama template sudah dipakai.", "fields": { "name": "Nama template sudah dipakai." } } }` | Another active template has the name. The key is not kept. |
| `422` | `idempotency_key_reused` | The key was used for a different kind of create. |

### `GET /api/pipeline-templates/:id`

| Status | Body | When |
|--------|------|------|
| `200` | The record | Found. An archived template is returned too, with `archived: true` (the editor opens it read-only with "Pulihkan"). |
| `404` | `not_found` | Unknown id. |

### `PUT /api/pipeline-templates/:id`

**Saves the whole template**: the body has the same `name` and `stages` as a create, plus `version`. The Stages and Tasks sent replace all of the template's Stages and Tasks, in the order sent. So adding, renaming, reordering and removing Stages and Tasks is all one `PUT` of the edited list.

```json
{ "name": "Sekolah", "stages": [ { "name": "Presentasi", "tasks": [] }, { "name": "Identifikasi" } ], "version": 3 }
```

| Status | Body | When |
|--------|------|------|
| `200` | The record, `version` increased by 1, new Stage and Task ids | Saved. |
| `400` | `validation` with `fields` (including `stages`: "Tambahkan minimal satu Stage." and `version`), or `invalid_json` | Bad input. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The template changed since the client loaded it. |
| `409` | `template_name_taken` (with `fields.name`) | Another active template has the name. |
| `422` | `{ "error": { "code": "template_archived", "message": "Template ini diarsipkan. Pulihkan dulu untuk mengubahnya." } }` | The template is archived. Restore it first. |

### `POST /api/pipeline-templates/:id/archive` and `POST /api/pipeline-templates/:id/restore`

Archive sets `archivedAt`: the template can no longer start a Pipeline (see the rule below), and Pipelines already started from it are unaffected. Restore clears it.

```json
{ "version": 2 }
```

**Idempotent:** when the template is already in the requested state, the answer is `200` with the record unchanged: nothing is written, `version` does not change, and the sent `version` is not checked.

| Status | Body | When |
|--------|------|------|
| `200` | The record, with `archived` changed and `version` increased by 1, or unchanged (see above) | Done. |
| `400` | `validation` with `fields.version`, or `invalid_json` | No valid `version`. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The state has to change, and the template changed since the client loaded it. |
| `409` | `template_name_taken` (with `fields.name`) | Restore only: an active template has taken the name meanwhile. Rename that one first. |
| `422` | `{ "error": { "code": "last_template", "message": "Harus ada minimal satu template aktif." } }` | Archive only: this is the only active template. A new Pipeline always needs one. |

### `DELETE /api/pipeline-templates/:id`

Deletes a template that no Pipeline uses, with its Stages and Tasks. No body. Archived or active templates can be deleted.

| Status | Body | When |
|--------|------|------|
| `204` | None | Deleted. A repeat answers `404`. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `{ "error": { "code": "template_in_use", "message": "Template ini dipakai Pipeline. Arsipkan saja." } }` | A Pipeline (any Outcome) uses it (`pipelineCount` > 0). Archive it instead (EC21). The database backs this: `pipeline.template_id` is `ON DELETE restrict`. |
| `422` | `last_template` ("Harus ada minimal satu template aktif.") | It is active and the only active template. |

### Rule: only an active template can start a Pipeline

For E3-S3. Starting a Pipeline needs a template that exists and is not archived. Otherwise nothing is saved and the response is one of:

| Status | Body | When |
|--------|------|------|
| `422` | `{ "error": { "code": "template_archived_cannot_start", "message": "Template ini diarsipkan dan tidak bisa dipakai untuk Pipeline baru." } }` | The template is archived. |
| `422` | `{ "error": { "code": "template_not_found", "message": "Template tidak ditemukan." } }` | No template has that id (or it is not a UUID). |

Server side, from `@/server/pipeline-templates`, inside the transaction that starts the Pipeline:

- `assertTemplateCanStartPipeline(tx, templateId)` applies the rule above and locks the template's row `FOR SHARE`, so an archive or delete running at the same moment waits for the start to commit.
- `getTemplateForSnapshot(tx, templateId)` returns `{ id, name, stages: [ { position, name, tasks: [ { position, name } ] } ] }`, in order, to copy into `pipeline_stage` and `pipeline_task`.
- `countPipelinesUsingTemplate(db, templateId)` and the list's `pipelineCount` read from one internal function (`pipelineCounts`), a grouped count over `pipeline.template_id` (E3-S3). `pipeline.template_id` is `ON DELETE restrict`, so the database backs the delete rule.

## Pipelines

Implemented in E3-S3. A Pipeline is one acquisition attempt with one Prospect. It is started from a Pipeline Template and **copies the template's Stages and Tasks** at that moment, so later template edits never change it (EC21). It moves through its Stages until it gets an Outcome. A Pipeline is never deleted (EC22): there is no `DELETE /api/pipelines/:id`. A single Task can be removed from one Pipeline.

Every endpoint needs an Admin session (`401 unauthorized` otherwise). Mutations are refused cross-origin (`403 forbidden_origin`). An `:id` that is unknown or not a UUID is `404 not_found`. Responses are sent with `Cache-Control: no-store`.

### States and the Outcome

| State | `outcome` | UI | Can move Stage | Tasks editable | Counts as "open" for EC16 and EC19 |
|-------|-----------|----|----------------|----------------|------------------------------------|
| Open | `null` | (Stage badge) | yes | yes | yes |
| On Hold | `"on_hold"` | Ditunda | no | no (read-only) | yes |
| Won | `"won"` | Berhasil | no | no | no |
| Lost | `"lost"` | Gagal | no | no | no |

`PIPELINE_OUTCOMES` and `PIPELINE_OUTCOME_LABELS` are in `@/lib/validation`.

**Transitions** (`POST /api/pipelines/:id/outcome`, criterion 5, EC24). Every other combination is `422 invalid_transition`:

| From | To (`outcome` sent) | Needs |
|------|---------------------|-------|
| Open | `won` | `accountsOpened`, `wonOn` |
| Open | `lost` | `lostReason` |
| Open | `on_hold` | nothing |
| On Hold | `open` (resume, at the same Stage) | nothing |
| On Hold | `lost` | `lostReason` |
| Won or Lost | Open | Use `POST /api/pipelines/:id/reopen` (below), not this endpoint. |

**One open Pipeline per Prospect (EC16):** a Prospect has at most one Pipeline that is open or On Hold. The database enforces it with a partial unique index.

**WIB dates.** Every date (`wonOn`, `dueOn`) is a calendar day `"YYYY-MM-DD"`, with no time and no zone. "Today" is the calendar day in WIB (Asia/Jakarta, UTC+7), never UTC: at 2026-01-31 17:30 UTC it is already 2026-02-01 in WIB. `wibDate(now?)` in `@/lib/validation` returns it, for forms that set the date picker's maximum.

**Overdue (EC30):** a Task's `overdue` is `true` when its `dueOn` is before today in WIB, it is not ticked, and the Pipeline is **open**. Tasks on an On Hold, Won or Lost Pipeline are never Overdue: they are read-only, and the brief limits Overdue to open Pipelines. A Task due today is not Overdue.

### The record

`GET /api/pipelines/:id` and every mutation answer the whole Pipeline:

```json
{
  "id": "7d2a…",
  "prospect": { "id": "0b7e…", "name": "SDN 3 Cibinong", "archived": false },
  "template": { "id": "3c9e…", "name": "Umum" },
  "fundingOfficer": { "id": "6f1c…", "name": "Rina Kartika", "active": true },
  "outcome": null,
  "accountsOpened": null,
  "wonOn": null,
  "lostReason": null,
  "currentStagePosition": 3,
  "currentStage": { "id": "c3…", "position": 3, "name": "Presentasi" },
  "stageCount": 5,
  "tasksDone": 3,
  "tasksTotal": 11,
  "prospectHasOtherOpenPipeline": false,
  "startedAt": "2026-11-19T02:15:00.000Z",
  "closedAt": null,
  "version": 4,
  "createdAt": "2026-11-19T02:15:00.000Z",
  "updatedAt": "2026-11-19T03:40:00.000Z",
  "stages": [
    {
      "id": "c3…",
      "position": 3,
      "name": "Presentasi",
      "tasksDone": 1,
      "tasksTotal": 3,
      "tasks": [
        { "id": "t1…", "position": 1, "name": "Siapkan materi", "dueOn": null, "done": true, "doneAt": "2026-11-19T03:00:00.000Z", "overdue": false, "version": 2 },
        { "id": "t2…", "position": 2, "name": "Presentasi ke pengambil keputusan", "dueOn": "2026-11-15", "done": false, "doneAt": null, "overdue": true, "version": 2 }
      ]
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `template` | The template it was started from, with the template's **current** name. Its Stages and Tasks are the Pipeline's own copy, in `stages`. |
| `fundingOfficer` | The Pipeline's own Funding Officer: copied from the Prospect at start, changed only by `PATCH /api/pipelines/:id` (EC26). Actual follows it. `active: false` when that Funding Officer was deactivated later. |
| `currentStagePosition`, `currentStage` | The current Stage, by its 1-based position. A Pipeline's Stages are never added or removed, so the position is stable. Kept while On Hold, Won or Lost, so resume and reopen carry on there. |
| `accountsOpened`, `wonOn` | Set only while Won. |
| `lostReason` | Set only while Lost. |
| `closedAt` | When it became Won or Lost; `null` while open or On Hold. |
| `prospectHasOtherOpenPipeline` | The Prospect has another open or On Hold Pipeline, so this one cannot be reopened (EC25). The screen disables "Buka kembali" with "Prospect ini sudah punya Pipeline berjalan." |
| `stages[].tasks[]` | In order. Positions keep their gaps after a Task is removed. Each Task has its **own** `version` (see `PATCH /api/pipeline-tasks/:id`). |
| `version` | The Pipeline's version. Move, Outcome, reopen and Funding Officer changes increase it; Task edits do **not**. |

The zod schemas are exported from `@/lib/validation`: `startPipelineInput`, `movePipelineInput`, `pipelineOutcomeInput`, `pipelineStatusInput`, `changePipelineFundingOfficerInput`, `updatePipelineTaskInput`, `pipelineListQuery`, `calendarDate`, `accountsOpened`, `wibDate`, and the messages `ACCOUNTS_OPENED_MESSAGE`, `WON_ON_FUTURE_MESSAGE` and `DATE_MESSAGE`.

### `GET /api/pipelines?prospectId=`

A Prospect's Pipelines, **newest first** (by `startedAt`), for the Prospect detail (E2-S4): the open or On Hold one, if any, and the closed ones. At most 100. `prospectId` is required and must be a UUID (`400` with `fields.prospectId` otherwise). An unknown Prospect answers `{ "items": [] }`.

```json
{ "items": [ {
  "id": "7d2a…",
  "template": { "id": "3c9e…", "name": "Umum" },
  "fundingOfficer": { "id": "6f1c…", "name": "Rina Kartika", "active": true },
  "outcome": "won",
  "accountsOpened": 350,
  "wonOn": "2026-11-18",
  "lostReason": null,
  "currentStage": { "position": 5, "name": "Pembukaan Rekening" },
  "stageCount": 5,
  "tasksDone": 9,
  "tasksTotal": 11,
  "startedAt": "2026-10-02T02:15:00.000Z",
  "closedAt": "2026-11-18T08:00:00.000Z",
  "version": 9
} ] }
```

### `POST /api/pipelines`

Starts a Pipeline. Needs an `Idempotency-Key` header (scope `pipeline.start`).

```json
{ "prospectId": "0b7e…", "templateId": "3c9e…" }
```

It copies the template's Stages and Tasks, starts at the first Stage, and copies the Prospect's Funding Officer (criterion 1). The checks run in the order of the table, in one transaction with the Prospect's row locked:

| Status | Body | When |
|--------|------|------|
| `201` | The record | Started. |
| `200` | The same record, read again | A repeat with the same `Idempotency-Key`. Nothing new is started. |
| `400` | `validation` (`fields.prospectId`, `fields.templateId`: "Wajib diisi."), `invalid_json`, `idempotency_key` | Bad input or key. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `422` | `{ "error": { "code": "prospect_not_found", "message": "Prospect tidak ditemukan." } }` | No Prospect has that id (or it is not a UUID). |
| `422` | `{ "error": { "code": "prospect_archived", "message": "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya." } }` | The Prospect is archived (EC16). The same code and message as editing an archived Prospect. |
| `409` | `{ "error": { "code": "pipeline_already_open", "message": "Prospect ini masih punya Pipeline yang berjalan." } }` | The Prospect already has an open or On Hold Pipeline (EC16). Two starts at the same moment give one `201` and `409` for the others. |
| `422` | `template_archived_cannot_start`, `template_not_found` | See [the template rule](#rule-only-an-active-template-can-start-a-pipeline). |
| `422` | `funding_officer_inactive`, `funding_officer_not_found` | The **Prospect's** Funding Officer is inactive, so no new work can go to them. Reassign the Prospect first. |
| `422` | `idempotency_key_reused` | The key was used for a different kind of create. |

On any refusal the key is not kept, so a corrected retry with it is allowed.

### `GET /api/pipelines/:id`

| Status | Body | When |
|--------|------|------|
| `200` | The record | Found, in any state. |
| `404` | `not_found` | Unknown id. |

### `POST /api/pipelines/:id/move`

Moves an **open** Pipeline to any of its Stages, forward or back (criterion 3, EC23). The move always happens; the client warns before sending (E3-S4).

```json
{ "stagePosition": 4, "version": 3 }
```

Answer:

```json
{ "pipeline": { "id": "7d2a…", "currentStagePosition": 4, "version": 4 }, "uncheckedTasksLeftBehind": 2 }
```

`pipeline` is the whole record. `uncheckedTasksLeftBehind` counts the unticked Tasks in the Stages a **forward** move leaves behind: from the current Stage up to, but not including, the target. It is `0` for a move back. A move to the current Stage is a no-op: `200`, nothing written, the `version` not checked, `uncheckedTasksLeftBehind: 0`.

| Status | Body | When |
|--------|------|------|
| `200` | As above, `version` increased by 1 | Moved. |
| `400` | `validation`: `fields.stagePosition` ("Tahap ini tidak ada di Pipeline ini." past the last Stage; "Isian tidak valid." for 0, a decimal or a string), `fields.version` | Bad input. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The Pipeline changed since the client loaded it. |
| `422` | `{ "error": { "code": "pipeline_closed", "message": "Pipeline ini sudah selesai atau ditunda. Tahapnya tidak bisa diubah." } }` | It is Won, Lost or On Hold. |

### `POST /api/pipelines/:id/outcome`

Sets the Outcome along the transition table above (criterion 5). One of:

```json
{ "outcome": "won", "accountsOpened": 350, "wonOn": "2026-11-18", "version": 4 }
```

```json
{ "outcome": "lost", "lostReason": "Sudah memakai bank lain.", "version": 4 }
```

```json
{ "outcome": "on_hold", "version": 4 }
```

```json
{ "outcome": "open", "version": 5 }
```

| Field | Rules |
|-------|-------|
| `outcome` | Required: `won`, `lost`, `on_hold`, or `open` (resume an On Hold Pipeline). Missing: "Wajib diisi."; anything else: "Isian tidak valid." |
| `accountsOpened` | Won only, required: an integer from 1 to 100,000. Otherwise (missing, 0, 100001, 1.5, a string): "Rekening dibuka harus bilangan bulat 1 sampai 100.000." (EC10) |
| `wonOn` | Won only, required: `"YYYY-MM-DD"`, a real date ("Tanggal tidak valid." otherwise), **not after today in WIB**: "Tanggal berhasil tidak boleh di masa depan." (EC32). Today and earlier are accepted. |
| `lostReason` | Lost only, required: free text, at most 500 characters, with the customer-number guard (EC42). |

Fields that do not belong to the `outcome` sent are ignored. Won and Lost set `closedAt`. On Hold and resume keep the Stage.

| Status | Body | When |
|--------|------|------|
| `200` | The record, `version` increased by 1 | Done. |
| `400` | `validation` with `fields` (above), or `invalid_json` | Bad input. The future-date check runs after the version and transition checks. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The Pipeline changed since the client loaded it (checked first). |
| `422` | `{ "error": { "code": "invalid_transition", "message": "Hasil Pipeline tidak bisa diubah dari Berhasil ke Gagal." } }` | The transition is not in the table. The message names both states: Berjalan (open), Berhasil, Gagal or Ditunda. |

### `POST /api/pipelines/:id/reopen`

Reopens a **Won or Lost** Pipeline (criterion 6, EC25): clears `outcome`, `accountsOpened`, `wonOn`, `lostReason` and `closedAt`, and the Pipeline carries on at the Stage it was in. Reopening a Won Pipeline lowers Actual for its Won month; the client confirms first (E3-S4).

```json
{ "version": 6 }
```

| Status | Body | When |
|--------|------|------|
| `200` | The record, `version` increased by 1 | Reopened. |
| `400` | `validation` with `fields.version`, or `invalid_json` | No valid `version`. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The Pipeline changed since the client loaded it. |
| `409` | `{ "error": { "code": "pipeline_already_open", "message": "Prospect ini sudah punya Pipeline berjalan." } }` | The Prospect has another open or On Hold Pipeline (`prospectHasOtherOpenPipeline: true`). |
| `422` | `{ "error": { "code": "invalid_transition", "message": "Hanya Pipeline yang berhasil atau gagal yang bisa dibuka kembali." } }` | It is open or On Hold. |
| `422` | `prospect_archived` ("Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.") | Its Prospect is archived. Restore the Prospect first. |

### `PATCH /api/pipelines/:id`

Changes the Pipeline's own Funding Officer (criterion 7, EC26). The Prospect's Funding Officer is unchanged, and changing the Prospect's never changes the Pipeline's.

```json
{ "fundingOfficerId": "9a2d…", "version": 4 }
```

| Status | Body | When |
|--------|------|------|
| `200` | The record, `version` increased by 1 | Saved. |
| `400` | `validation` (`fields.fundingOfficerId`, `fields.version`), or `invalid_json` | Bad input. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown id. |
| `409` | `version_conflict` | The Pipeline changed since the client loaded it. |
| `422` | `funding_officer_inactive`, `funding_officer_not_found` | The new Funding Officer cannot be assigned. Checked only when it changes, so saving an unchanged inactive one is allowed. |
| `422` | `{ "error": { "code": "pipeline_closed", "message": "Pipeline ini sudah selesai. Buka kembali dulu untuk mengubahnya." } }` | It is Won or Lost, so its Actual is settled. Allowed while open or On Hold. |

### `PATCH /api/pipeline-tasks/:id`

Ticks, unticks, or sets or clears the due date of one Task (criterion 4). Answers the whole Pipeline record. For example:

```json
{ "done": true, "version": 1 }
```

```json
{ "dueOn": "2026-12-01", "version": 2 }
```

```json
{ "dueOn": null, "done": false, "version": 3 }
```

| Field | Rules |
|-------|-------|
| `done` | Optional boolean. `true` ticks (sets `doneAt`), `false` unticks. |
| `dueOn` | Optional: `"YYYY-MM-DD"` (a real date, "Tanggal tidak valid." otherwise), or `null` to clear. Any date, past ones included. |
| `version` | Required: the **Task's** `version`. |

**Task versions.** Each Task has its own `version`, so ticking a Task never conflicts with moving the Pipeline or with editing another Task. A request that changes nothing (ticking a ticked Task, sending the same due date) writes nothing, does not check the version and answers `200`, so a double tap is harmless. A request that changes something with a stale version is `409 version_conflict`, so a tick from another tab never silently overwrites a due-date edit, or the other way round; reload and retry.

| Status | Body | When |
|--------|------|------|
| `200` | The Pipeline record; the Task's `version` increased by 1 if it changed | Saved. |
| `400` | `validation` with `fields`, or `invalid_json` | Bad input. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown Task id. |
| `409` | `version_conflict` | The Task changed since the client loaded it. |
| `422` | `{ "error": { "code": "pipeline_closed", "message": "Pipeline ini sudah selesai atau ditunda. Tugasnya tidak bisa diubah." } }` | The Pipeline is Won, Lost or On Hold. Its Tasks are read-only. |

### `DELETE /api/pipeline-tasks/:id`

Removes one Task from its Pipeline (EC22). The template and other Pipelines keep it. No body.

| Status | Body | When |
|--------|------|------|
| `204` | None | Removed. A repeat answers `404`. |
| `403` | `forbidden_origin` | Cross-origin request. |
| `404` | `not_found` | Unknown Task id. |
| `422` | `pipeline_closed` (the Task message above) | The Pipeline is Won, Lost or On Hold. |

### Server-side helpers (for later stories)

From `@/server/pipelines`: `getPipeline(id, { db, now })`, `listPipelinesForProspect(prospectId)`, and `isOpenOrOnHold()` (the Drizzle condition "outcome is null or on_hold"), for E1-S3's open-work counts and the dashboard. Every mutation takes an optional `now`, so tests can fix the clock.

## Health

### `GET /api/health`

Reports whether the app can reach its database. Public: no session needed. Never cached (`Cache-Control: no-store`).

The check runs `select 1` with a 3 second timeout.

| Status | Body | When |
|--------|------|------|
| `200` | `{ "status": "ok", "database": "ok" }` | The database answered. |
| `503` | `{ "status": "error", "database": "error" }` | The database did not answer in time, refused the connection, or `DATABASE_URL` is not set. |

The response never contains connection details (host, database name, user, password or driver error). The cause is logged on the server only, as an error code.
