---
name: product-manager
description: Use when an approved BFTM Planner brief or PRD needs breaking into epics and user stories with story points, tagged frontend or backend, with every edge case traced to an acceptance criterion, in docs/product/backlog.md.
---

# Product Manager

Turn an approved brief into estimated stories in the backlog. Each story is tagged for the role that builds it, and every edge case in the brief becomes a criterion that the tester can check.

## Before you start

Read `CLAUDE.md`, the brief in `docs/product/briefs/<feature-slug>.md` (or `docs/product/prd.md` if no brief exists), `GLOSSARY.md` and `docs/product/backlog.md`. Read the open questions. If one blocks a story, ask the user to settle it first.

## Steps

1. **Check the foundation.** If the backlog has no epic `E0 Foundation`, add it first:
   - `E0-S1` (backend) Scaffold the app with the stack in `CLAUDE.md`. Its criteria: the npm scripts in the Commands table exist with exactly those names; Playwright has `mobile` (360 × 800), `tablet` (768 × 1024) and `desktop` (1280 × 800) projects; `.env.example` lists every variable name; `npm run build` works without secrets; the CI workflow passes on a pushed branch.
   - `E0-S2` (backend) Connect Postgres with Drizzle, using a driver that also works against plain Postgres, with a first migration and a health check route. Include a database for local development and tests: a Neon development branch, or local Postgres if it is installed. Its `DATABASE_URL` goes in `.env.local`, and the setup steps go in `CLAUDE.md`.
   - `E0-S3` (backend) Admin sign-in, as decided in ADR 0002. It depends on that ADR.
   - `E0-S4` (frontend) The app shell from `DESIGN.md`: bottom navigation on mobile, sidebar on desktop, and the chosen tokens and font. It depends on `E0-S1`.
   Every other story depends on `E0-S1`.
2. **Define epics.** Use one epic per user-facing capability, and give each one sentence describing its outcome. Number them after the last epic in the backlog: `E1`, `E2` and so on. Never renumber existing epics.
3. **Write user stories** with IDs `E<epic>-S<n>`, in this form:
   - As a <role>, I want <capability>, so that <benefit>.
   - Acceptance criteria: three to eight testable statements, each one something the tester can check. Write them as observable behaviour ("The list shows ...", "Saving without a name shows the error ..."), not as implementation.
4. **Trace every edge case.** Every row in the brief's Edge cases table must become an acceptance criterion in at least one story. Add a trace table to the epic (format below). An edge case with no criterion is a gap, so fix it before you show the backlog.
5. **Estimate story points** on the Fibonacci scale: 1, 2, 3, 5, 8, 13. Split any story estimated at 13 or more. Do not estimate in hours.
6. **Tag each story** `frontend` or `backend`. Split any story that needs both into a backend story and a frontend story in the same epic. Put the backend story first when the frontend depends on its API, and record that under "Depends on". The Definition of Done in `CLAUDE.md` applies to every story, so do not repeat its checks as criteria. Responsiveness and the design review are already part of it.
7. **Append to `docs/product/backlog.md`.** Do not rewrite stories that already exist. Use the format below. Every new story starts at `Todo`.
8. **Confirm the stories** with the user. Show the epics, the stories, their points, and the trace table. Then, if `/develop` is running, return to it. Otherwise tell the user the next step: software-architecture, then ui-designer, then backend, then frontend, then tester.

## Backlog format

```markdown
## E3 Prospect map (feature: prospect-map)

Outcome: one sentence.
Release: (devops fills this in: date, commit, preview URL, production URL)

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E3-S1 | As an Admin, I want ... | 3 | backend | E0-S2 | Todo |

### E3-S1 acceptance criteria
- ...

### E3 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| GPS denied | E3-S2 | 4 |
```

Put the acceptance criteria under each story's heading, not in the table. The backlog ends with a single Bugs table, which the tester fills in:

```markdown
## Bugs

| ID | Story | Criterion | Owner | Status | Report |
|----|-------|-----------|-------|--------|--------|
```

Statuses are `Todo` → `In progress` → `Done` → `Verified` → `Released`, plus `Blocked` with a reason. Only the tester sets `Verified`. Only devops sets `Released`.

## Rules

- Every story must trace to a goal in the brief or PRD. Flag any story that does not.
- Keep to v1 scope: Admin-only, no Telegram, online only.
- Do not write code in this skill.
