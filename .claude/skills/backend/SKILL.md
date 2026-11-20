---
name: backend
description: Use when implementing backend stories or backend bugs from docs/product/backlog.md for BFTM Planner, including the E0 scaffold: API routes, the Postgres schema with Drizzle, Vercel Blob uploads, and scheduled endpoints.
---

# Backend

Implement the backend stories in `docs/product/backlog.md`. Work one story at a time, and finish the backend stories that frontend stories depend on first.

## Before you start

Read `CLAUDE.md`, `docs/product/prd.md`, `GLOSSARY.md`, `docs/architecture.md` and `docs/adr/`. ADR 0001 forbids individual customer data. Do not add tables or fields for account holders.

## Steps

1. **Pick the work.** Take the story you were given. Otherwise, take an open backend bug from the Bugs table first, then a backend story at `Todo` whose dependencies are all `Verified` or `Released`. Set it to `In progress`.
2. **Read the project's conventions** first: routing, validation, error format, database access and auth. Match them. The app was already scaffolded during project setup (see Commands in `CLAUDE.md`). So `E0-S1` is mostly done: check each of its criteria against the repo, fill any gap, and confirm that CI passes on the pushed branch. Never re-run `create-next-app` over the repo. For Next.js code, read the matching guide in `node_modules/next/dist/docs/` first, because Next.js 16 differs from older versions.
3. **Build the story:**
   - Restate its acceptance criteria.
   - Change the schema first, with a Drizzle migration. Then write the route or service logic.
   - Validate all input at the boundary. Check authorization on every route. Only the Admin role exists in v1.
   - Write tests for each acceptance criterion, but run only this story's new test file as a smoke check before moving on. The full suite runs once at the end of the batch, in the tester's final pass.
4. **Publish the contract.** Add each endpoint to `docs/product/api.md` (method, path, request, response, errors) so the frontend skill can use it.
5. **Keep the commands current.** Do not rename the scripts CI calls. If you add a new command, add it to the Commands table in `CLAUDE.md`. If a story needs a new environment variable, add its name to `.env.example` and note it for devops.
6. **Mark the work `Done`** in the backlog once its own test file, `npm run lint` and `npm run typecheck` pass. For a bug, set its row in the Bugs table to `Done`. The tester verifies the whole batch at the end.
7. **Report** the stories completed, the stories blocked, and any criterion you could not check. If `/develop` is running, return to it.

## Stack

- Next.js route handlers with TypeScript
- Postgres on Neon with Drizzle ORM
- Vercel Blob for uploaded files
- Scheduled jobs through Vercel Cron (once a day on the Hobby plan), plus an external cron if more frequent runs are needed

## Companion skills

Use these if they are installed. This skill's steps and `CLAUDE.md` win where they disagree.

- `security-review`: run once, on the batch diff, when any story in it touches sign-in, uploads to Vercel Blob, secrets, or a trust-boundary validation change.

## Rules

- Do not store data the PRD rules out.
- Never send secrets to the client. Keep them in environment variables.
- Keep changes scoped to the story. Do not change production code to make a test pass.
- If the story needs an architecture decision that is not in `docs/adr/`, stop and set the story to `Blocked`.
