# BFTM Planner: working agreement

A responsive web app (PWA) that helps a BFTM and their Funding Officers plan field acquisition, run each acquisition through a staged Pipeline, and see schedule and progress on a dashboard and map. It is a prototype hosted outside bank infrastructure.

## How work starts

Run `/develop <feature idea>`. It drives the whole lifecycle through the role skills below, commits to a feature branch, pushes it for a Vercel preview, and records progress in `docs/features/<slug>.md`. Run `/develop` with no argument to resume. If the PRD or glossary does not exist yet, `/develop` writes them with you first.

## Source of truth, in priority order

1. This file's hard rules. Nothing overrides them.
2. `docs/product/prd.md`: the current v1 scope.
3. `GLOSSARY.md`: domain terms. Use them in code, tests, UI copy and commit messages.
4. `docs/adr/`: decisions with lasting consequences. ADR 0001 is binding.
5. `DESIGN.md`: the visual design system, the anti-slop rules and the responsive rules.
6. `docs/product/backlog.md`: what to build now, and each story's status.

If two sources conflict and the PRD does not settle it, stop and ask. Do not guess.

## Hard rules

- **No individual customer data.** Never add a table or field for account holders: no names, NIK, account numbers or balances. Store only institution- or venue-level Prospects, a minimal contact person (name, role, phone) and account counts. ADR 0001 records this rule.
- **v1 is Admin-only.** Do not build BFTM, Funding Officer, Branch Manager or Area Manager permissions until the PRD adds them.
- **No Telegram code in v1.** No bot, webhook, digest or reminder.
- **Online only.** No offline sync.
- **Use the glossary.** Say "Prospect", not customer, lead or client. Say "Pipeline", not deal. Say "Activity", not event.
- **UI text is Bahasa Indonesia.** Code, comments and docs are in English.
- **Do not invent** a role, metric or feature that the PRD does not contain. Ask instead.

## Stack

- Next.js (App Router) with TypeScript, Node 22, npm
- shadcn/ui on Tailwind CSS
- Postgres on Neon (`bftm-planner-db`, Singapore), via the Vercel Marketplace, with Drizzle ORM and the postgres.js driver, which also works against the plain Postgres container in CI.
  - `DATABASE_URL` goes through Neon's connection pooler. The app uses it, and with postgres.js it must pass `{ prepare: false }`.
  - `DATABASE_URL_UNPOOLED` is the direct connection. Migrations and drizzle-kit use it.
  - Get local values with `vercel env pull .env.local`. The current state of each environment is in `docs/ops/deploy.md`.
- Vercel Blob for Check-in photos
- Leaflet with OpenStreetMap (react-leaflet)
- Hosting on Vercel (Hobby plan), deployed through its Git integration
- Vitest for unit and integration tests, Playwright for end-to-end tests at three viewports
- GitHub Actions for CI (`.github/workflows/ci.yml`)

## Commands

The app was scaffolded during project setup on 2026-11-18: Next.js 16, React 19, Tailwind 4 and shadcn/ui. CI calls these npm scripts by name, so do not rename them:

| Script | Does |
|--------|------|
| `npm run dev` | Start the dev server on port 3000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm test` | Vitest, for `tests/unit/`. Needs the test database: `npm run db:up` locally (it uses `TEST_DATABASE_URL`, default `bftm_test` on localhost), the service container in CI. |
| `npm run test:e2e` | Playwright, for `tests/e2e/`, at the `mobile`, `tablet` and `desktop` viewports. It starts the dev server itself. Its global setup seeds a synthetic Admin (`admin.e2e@contoh.id`) into the dev server's `DATABASE_URL` (refusing neon.tech), so run `npm run db:migrate` first. First time on a machine: `npx playwright install chromium`. |
| `npm run db:generate` | Generate a Drizzle migration from `src/db/schema.ts` into `drizzle/` |
| `npm run db:up` | Start the local Postgres 16 container (`docker-compose.yml`, ADR 0005) with the databases `bftm_dev` and `bftm_test`, and wait until it is healthy. |
| `npm run db:migrate` | Apply the migrations in `drizzle/` to `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL` (`scripts/migrate.mts`). Running it again is a no-op. |
| `npm run admin:seed -- <email>` | Create or update the Admin (`scripts/seed-admin.mts`, ADR 0002). The password comes from `ADMIN_PASSWORD` or a hidden prompt, never from the arguments. Rerun it to reset a password; that also ends the Admin's sessions. Uses `DATABASE_URL_UNPOOLED` or `DATABASE_URL`. |
| `npm run build` | Production build. It needs no runtime secrets. |
| `npm run vercel-build` | Vercel runs this script on deploy, instead of `build`. It runs `db:migrate` first only when `RUN_MIGRATIONS=true`. Set that in Vercel for Production, and for Preview only when previews have their own Neon branch, so a preview never migrates the production database. |

Environment variables are listed in `.env.example`. Put local values in `.env.local`, which git ignores.

**Next.js 16 differs from older versions.** Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`. See @AGENTS.md.

## Delivery lifecycle

Each role is a skill in `.claude/skills/`, one folder per role. `/develop` (`.claude/skills/develop/`) runs them in this order:

```
/develop <idea>                       git: branch feature/<slug> from main
  0 bootstrap      product-owner         prd.md, GLOSSARY.md (only if missing)   [gate: approve PRD]
  1 brief          product-owner         deep discovery and edge cases           [gate: approve brief]
  2 backlog        product-manager       stories, every edge case traced         [gate: approve stories]
  3 architecture   software-architecture docs/adr/, docs/architecture.md         [gate: pick each decision]
  4 design         ui-designer           docs/design/<story-id>.md, DESIGN.md
  5 build in dependency waves:
                   backend | frontend -> targeted check -> mark Done
                   after all stories: one batch review -> one tester pass -> one commit/push/CI
                   a failing final check files BUG-<n>; fixes stay in the same batch
  6 release        devops                CI green, pull request, preview checked [gate: confirm production]
                                         merge to main -> Vercel production deploy
  7 done           backlog and feature file marked Released, final report
```

Everything between gates runs without asking. Each skill can also be run on its own.

- **Story IDs:** `E<epic>-S<n>`. `E0` is Foundation: scaffold and CI, database, and Admin sign-in. Bugs are `BUG-<n>`.
- **Statuses:** `Todo` → `In progress` → `Done` → `Verified` → `Released`, plus `Blocked` with a reason. Only the final tester pass sets `Verified`. Only devops sets `Released`.
- Build backend stories before the frontend stories that depend on them. A dependency at `Done` is sufficient during an active MVP batch; all become `Verified` together after final testing.

## Definition of Done

Stories are marked `Done` after implementation and a targeted smoke check. After every story in the active MVP batch is `Done`, one final verification pass marks them `Verified` only when all of these hold:

1. Every acceptance criterion has a test that ran and passed, including criteria from edge cases.
2. Lint, typecheck, unit tests and end-to-end tests pass locally once for the batch.
3. One batch code review has no open correctness findings. Run a security review only when the batch changes authentication, authorization, uploads, secrets, or trust-boundary validation.
4. **Frontend stories:** each main flow works at 360, 768 and 1280 px. Review screenshots once per screen, normal state first; capture extra states only when visually distinct or risky.
5. The backlog and `docs/product/api.md` are up to date. Write one batch QA report; no per-story QA reports.

## Git and release rules

The user has authorized `/develop` to commit and push feature branches automatically. These rules bound that authorization:

- One feature, one branch: `feature/<slug>`, created from an up-to-date `main`.
- Never commit to `main` directly, with two exceptions: the very first `chore: project setup` commit in an empty repository, and the docs-only `docs(<slug>): release record` commit after a confirmed release. Otherwise `main` changes only by merging a feature's pull request, and only after the user confirms the production release in the conversation.
- Vercel and CI skip docs-only commits (`vercel.json` `ignoreCommand`, and `paths-ignore` in CI).
- Commit messages follow Conventional Commits and name the story: `feat(E3-S1): ...`, `fix(BUG-4): ...`, `test(E3-S1): ...`, `docs(prospect-map): ...`, `chore(E0-S1): ...`. End every commit with the attribution trailer that Claude Code supplies.
- Commit after each gate. During build, commit once after the active MVP batch is `Verified`; code, tests and status changes travel together.
- Push once after the batch commit. CI and Vercel preview run once for the batch.
- Stage files by path. Never stage `.env*` files, secrets, `test-results/` or `playwright-report/`. Check `git status` before every commit.
- Never force-push, rewrite published history, or skip hooks or CI.
- Outside `/develop`, commit or push only when the user asks.

## Plugins

`.claude/settings.json` enables frontend-design and code-review from the official marketplace. MVP mode leaves superpowers and security-guidance disabled to reduce automatic process overhead. Role skills and this file own the lifecycle. Use a focused security review only for authentication, authorization, uploads, secrets, or trust-boundary validation.

## Working rules for Claude

- Read the story and its acceptance criteria before writing code.
- Keep each change scoped to one story.
- Do not mark a story Done while its targeted smoke check is failing. Full checks run once after the active batch is built.
- Do not change production code to make a test pass. Report the failure instead.
- Record open questions in the brief or the backlog. Do not resolve them by guessing.

## Prerequisites on the machine

Node 22 with npm, git with access to `origin`, and the GitHub CLI (`gh`, logged in) for pull requests and CI status. Story `E0-S2` sets up a development database (a Neon branch, or local Postgres) in `.env.local`, which the local tests need. The Vercel CLI is needed only for the first-time project setup, which happens at the first release. Until then, pushes run CI but produce no Vercel preview. If `gh` is missing, `/develop` pushes with plain git and gives you the links to open the pull request and see CI.

## Folder map

```
CLAUDE.md                 this file
DESIGN.md                 visual design system, anti-slop and responsive rules (ui-designer)
GLOSSARY.md               domain terms (product-owner)
.claude/skills/           one skill per role, plus develop/
.claude/settings.json     shared plugin setup (committed)
.github/workflows/ci.yml  CI: lint, typecheck, tests at three viewports, build
vercel.json               Vercel settings; skips builds for docs-only commits
AGENTS.md                 Next.js 16 agent notes (generated by Next.js; keep it)
.env.example              environment variable names, no values
src/app/                  Next.js App Router pages and layouts
src/components/ui/        shadcn/ui components
src/db/schema.ts          Drizzle schema; drizzle/ holds the generated migrations
scripts/migrate.mts       applies migrations (db:migrate)
docker-compose.yml        local Postgres 16 for development and tests (db:up, ADR 0005)
src/server/               server-only modules: db/ client, health/, and one folder per domain module
playwright.config.ts      the three viewport projects
vitest.config.ts          unit test config
docs/product/prd.md       current v1 scope (product-owner)
docs/product/briefs/      one brief per feature, with its edge cases (product-owner)
docs/product/backlog.md   epics, stories, bugs and their status (product-manager, tester, devops)
docs/product/api.md       backend contract, for frontend work (backend)
docs/product/qa/          QA reports, one per story run (tester)
docs/adr/                 architecture decision records (software-architecture)
docs/architecture.md      module map, data model, API shape, deployment shape
docs/design/              screen designs, one file per frontend story (ui-designer)
docs/ops/deploy.md        deployment record and rollback notes (devops)
docs/features/            per-feature lifecycle state for /develop
tests/unit/, tests/e2e/   Vitest and Playwright tests, one file per story (tester)
tests/e2e/support/        shared helpers, such as the responsive checks
```
