---
status: accepted
date: 2026-11-18
---

# ADR 0005: Local development and tests use Postgres in Docker

## Context

Production, Preview and Development all point at one Neon database today (`docs/ops/deploy.md`). Integration and end-to-end tests create and reset data, so running them against that database would write to production. CI already uses a `postgres:16` service container. Docker is available on the development machine.

## Decision

- `docker-compose.yml` runs `postgres:16` on port 5432 with the database `bftm_dev`. A second database, `bftm_test`, is created by an init script for tests.
- `.env.local` sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to the local container. It no longer uses the Neon values pulled by `vercel env pull`.
- Tests read `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/bftm_test`), migrate it, and truncate tables between test files. In CI it is the service container's database.
- A guard in the test setup refuses to run when the database host ends in `neon.tech`.
- The postgres.js client keeps `prepare: false` everywhere, so the same code runs against Neon's pooler and plain Postgres.

## Consequences

- Tests are fast and can never touch production data.
- The local database is Postgres 16, while Neon runs 18. Code avoids version-specific features. A drift would show up on the preview deploy.
- Giving Preview its own Neon branch stays an open devops item, to close before real data goes in (`docs/ops/deploy.md`).
