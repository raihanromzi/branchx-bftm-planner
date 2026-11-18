# Architecture

Owned by the software-architecture skill. Decisions with lasting consequences are in `docs/adr/`. Exact request and response bodies are in `docs/product/api.md`, which the backend skill maintains.

## Module map

```
src/app/                    pages (Server Components) and api/ Route Handlers  ── UI and HTTP only
  (app)/                    signed-in screens inside the app shell
  masuk/                    sign-in
  api/<module>/...          JSON Route Handlers (ADR 0003)
src/components/             UI components; ui/ is shadcn
src/lib/                    client-safe helpers: api-client, format (id-ID, WIB), geo (haversine)
  validation/               shared zod rules (phone, free text, version), reused by forms; server/validation re-exports them
src/server/                 server-only; never imported by client components
  db/                       postgres.js + Drizzle client (prepare: false)
  http/                     shared Route Handler plumbing: error shape, idempotency, version check, Origin check
  validation/               shared rules: phone (+62), free-text guard (ADR 0001), id-ID numbers
  auth/                     sessions, scrypt, lockout, requireAdmin()          (ADR 0002)
  funding-officers/         Funding Officers, deactivation preview
  prospects/                Prospects, search, duplicate check, archive
  pipeline-templates/       Templates, Stages, Tasks, default seed
  pipelines/                Pipelines, Stage moves, Tasks, Outcomes
  activities/               Activities, Check-ins
  storage/                  photo storage interface: Vercel Blob, in-memory  (ADR 0004)
  dashboard/                Targets, monthly summary, overdue, map data
src/db/schema.ts            Drizzle schema (all tables)
proxy.ts                    optimistic cookie check and redirect (ADR 0002)
```

**Dependency direction:** `app` → `server/<module>` → `server/db`, `server/validation`. `components` → `lib`. Between modules:

```
dashboard ──► pipelines ──► pipeline-templates
    │             │
    ▼             ▼
activities ──► prospects ──► funding-officers
```

`prospects` reads open-Pipeline and future-Activity counts through queries on those tables, not by importing their modules, so there is no cycle.

## Data model

Every table has `id uuid` (default random) and `created_at`, `updated_at timestamptz`. Tables that the Admin edits have `version int`. Times are stored as `timestamptz` in UTC. Months and days are computed in `Asia/Jakarta` (WIB) in SQL. No table holds account-holder data (ADR 0001).

```
admin (email unique, password_hash)
session (admin_id → admin, token_hash unique, expires_at)
sign_in_attempt (email, attempted_at)
idempotency_key (key pk, scope, result_id, created_at)        purged after 24 h

funding_officer (name, phone, active)
prospect (name, name_key, category enum, address, lat, lng, contact_name, contact_role,
          contact_phone, potential_accounts, funding_officer_id → funding_officer,
          note, archived_at)
          index: name_key (lower, collapsed spaces) for duplicate check and search;
          trigram index on name for search

pipeline_template (name, name_key, archived_at)   unique name_key among active (archived_at null); default "Umum" seeded by migration 0004
template_stage (template_id → pipeline_template, position, name)
template_task (stage_id → template_stage, position, name)

pipeline (prospect_id → prospect, template_id → pipeline_template, funding_officer_id → funding_officer,
          all ON DELETE restrict; current_stage_position, outcome enum null|won|lost|on_hold,
          accounts_opened, won_on date, lost_reason, closed_at, started_at)
          partial unique index: one row per prospect where outcome is null or on_hold
          checks: won ⇔ accounts_opened (1..100000) and won_on; lost ⇔ lost_reason; won/lost ⇔ closed_at
          the current Stage is stored by position, not by id: Stages are copied once and never added or
          removed, so the position is stable and the row needs no circular foreign key (E3-S3)
pipeline_stage (pipeline_id → pipeline cascade, position, name)   copied from the template at start
pipeline_task (stage_id → pipeline_stage cascade, position, name, due_on date, done_at, version)
          each Task has its own version, so Task edits never conflict with moving the Pipeline

activity (prospect_id → prospect, funding_officer_id → funding_officer, pipeline_id → pipeline null,
          starts_at, purpose, status enum scheduled|done|cancelled)
check_in (activity_id → activity unique, photo_key, lat, lng, accuracy_m, distance_m,
          site enum on_site|off_site, site_reason, note, checked_in_at)

target (funding_officer_id → funding_officer, month date (first day), accounts)
          unique (funding_officer_id, month)
```

Rules enforced in the database, not only in code: one open or On Hold Pipeline per Prospect (partial unique index), one Target per Funding Officer and month, one Check-in per Activity, and check constraints on count ranges.

## API shape

Resources and operations. The bodies are in `api.md`, and the conventions are in ADR 0003.

| Resource | Operations |
|----------|------------|
| `/api/auth` | `POST sign-in`, `POST sign-out` |
| `/api/health` | `GET` |
| `/api/funding-officers` | list, create, `PATCH :id`, `POST :id/deactivate`, `POST :id/reactivate`, `GET :id/deactivation-preview` |
| `/api/prospects` | list (page, q, filters), create, `GET :id`, `PATCH :id`, `GET :id/archive-preview`, `POST :id/archive`, `POST :id/restore` |
| `/api/pipeline-templates` | list, create, `GET :id`, `PUT :id` (whole template), `POST :id/archive`, `POST :id/restore`, `DELETE :id` (only if unused) |
| `/api/pipelines` | `GET ?prospectId=` (a Prospect's Pipelines), `POST` (start for a Prospect), `GET :id`, `POST :id/move`, `PATCH :id` (Funding Officer), `POST :id/outcome`, `POST :id/reopen`, `PATCH /api/pipeline-tasks/:id`, `DELETE /api/pipeline-tasks/:id` |
| `/api/activities` | list (from, to, Funding Officer), create, `GET :id`, `POST :id/cancel`, `POST :id/check-in` (multipart) |
| `/api/check-ins/:id/photo` | `GET` (authenticated stream) |
| `/api/targets` | `GET ?month=`, `PUT` (upsert one Funding Officer's month) |
| `/api/dashboard` | `GET ?month=` (Target vs Actual, previous month, overdue, upcoming, Pipelines by Stage) |
| `/api/map/prospects` | `GET ?fundingOfficerId=&stage=` (compact rows) |

## Deployment shape

```
Browser (PWA, online only)
   │ HTTPS
   ▼
Vercel (Hobby, region sin1)  ── proxy.ts ── Next.js pages + Route Handlers (Fluid Compute, Node 22)
   │                    │
   ▼                    ▼
Neon Postgres        Vercel Blob (private store)
(ap-southeast-1,     Check-in photos
 pooled DATABASE_URL)
```

- **Production:** `main`, with migrations run by `vercel-build` when `RUN_MIGRATIONS=true`.
- **Preview:** every pushed branch. It shares the Neon database until devops gives Preview its own branch, so `RUN_MIGRATIONS` stays off for Preview (`docs/ops/deploy.md`).
- **Local and CI:** Postgres 16 in Docker or a CI service container (ADR 0005). Photos use the in-memory storage in tests.
- **New environment variables:**
  - `BLOB_READ_WRITE_TOKEN` (ADR 0004)
  - `TEST_DATABASE_URL` (ADR 0005)
  - `ADMIN_PASSWORD`, used only by the seed script (ADR 0002)
