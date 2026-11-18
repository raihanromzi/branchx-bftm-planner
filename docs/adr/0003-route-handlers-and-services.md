---
status: accepted
date: 2026-11-18
---

# ADR 0003: JSON Route Handlers over a service layer

## Context

Stories are split into backend and frontend, and the backend writes its contract to `docs/product/api.md` for the frontend to build against. The rules shared by every form (E0-S6: validation shape, idempotent creates, version checks) need one place to live. Next.js 16 offers Route Handlers and Server Actions for mutations. Server Actions have no HTTP contract to document, and they blur the split between backend and frontend stories.

## Decision

- **Services:** domain logic lives in `src/server/<module>/` as plain TypeScript functions that take validated input and a database handle. Services never import from `src/app/` or from React.
- **Mutations** go through JSON Route Handlers under `src/app/api/`. A handler only does four things: `requireAdmin()`, parse and validate with the module's zod schema, call the service, and map the result to HTTP. Client components call them with a small typed `fetch` wrapper in `src/lib/api-client.ts`.
- **Reads:** Server Components may call services directly (after `requireAdmin()`) for the first render. Client-side reads, such as search-as-you-type, list paging and the map, use `GET` Route Handlers.
- **Shared HTTP conventions,** documented once in `api.md`:
  - Errors are `{ "error": { "code", "message", "fields"?: { [field]: message } } }`. Status codes: 400 validation, 401 signed out, 404 missing, 409 version conflict or rule conflict, 422 forbidden state transition.
  - Every create takes an `Idempotency-Key` header (a client UUID). It is stored for 24 hours with the created record's ID.
  - Every update takes the `version` the client loaded. The service updates `WHERE id = $1 AND version = $2` and increments it. Zero rows updated means 409.
- **Validation:** zod schemas live next to each service and are reused by the frontend for inline checks. The server always validates again.

## Consequences

- Backend stories are tested over HTTP and at the service level. Frontend stories build against `api.md`.
- There is more client `fetch` code than Server Actions would need. The typed wrapper keeps it small.
- The Route Handlers are a stable surface for later clients, such as Funding Officer logins or a Telegram bot, if the PRD ever adds them.
