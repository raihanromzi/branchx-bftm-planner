# Deployment record

Owned by the devops skill. Resource names only; credentials live in Vercel.

## First-time setup

| Step | Status | Notes |
|------|--------|-------|
| Vercel project | Done 2026-11-18 | `raihan-romzi-rs-projects/branchx-bftm-planner`, Hobby plan. Linked locally through `.vercel/` (git-ignored). |
| GitHub connection | Done 2026-11-18 | Connected through the dashboard (the CLI connect failed). Production branch: `main`. |
| Node.js version | Done 2026-11-18 | Project set to 22.x, to match `package.json` engines (it defaulted to 26.x). |
| Database | Done 2026-11-18 | Neon `bftm-planner-db` through the Vercel Marketplace, region `ap-southeast-1` (Singapore), PostgreSQL 18. Its variables are set for Production, Preview and Development. |
| Function region | Done 2026-11-18 | `sin1` (Singapore) in `vercel.json`, next to the database. |
| `RUN_MIGRATIONS` | Done 2026-11-18 | `true` for Production only. |
| Separate dev and preview database | **Open** | Production, Preview and Development all point at the same Neon database for now. Before real data goes in, give Preview and Development their own Neon branch (Vercel → Storage → `bftm-planner-db` → settings, or the Neon console), then set `RUN_MIGRATIONS=true` for Preview. |
| Shared Neon database migrated early | Done 2026-11-19 | At the user's request, migrations 0000–0005 from `feature/planner-v1` were applied to `bftm-planner-db` (shared by Production and Preview) before the release, so a test Admin could be added. The release deploy will see them as applied and skip them. **Never edit these migration files from now on.** |
| Test Admin in the shared database | **Open: remove before real data** | `admin@contoh.id`, created 2026-11-19 at the user's request for testing. Its password is a known weak test password and the repository is public, so anyone with the password can sign in on the preview or production URL. Before any real Prospect goes in, delete it or reset its password (`npm run admin:seed -- admin@contoh.id` against the Neon URL), and create the real Admin. |
| Vercel Blob | Done 2026-11-20 | Private store `bftm-planner-checkins` (`store_qJR2PZWwlkrXJra8`), region `sin1`, connected to Production, Preview and Development. `BLOB_READ_WRITE_TOKEN` is set in Vercel (ADR 0004). Tests use the in-memory store, so CI needs no token. |
| Branch protection on `main` | Not started | Optional: require the CI check before merging. |

## Local development

Run `vercel env pull .env.local` to fetch the Development variables. `.env.local` is git-ignored.

## Releases

### 2026-11-19: BUG-4 promoted

- The preview at `8067f2f` (CI run 44518940201 green) was promoted with `vercel promote`. This created production deployment `branchx-bftm-planner-a9jp5v8cf`. There was no new migration. `/api/health` gives ok.
- Rollback: `vercel rollback` to `branchx-bftm-planner-26ufront9`.

### 2026-11-19: E6-S1 promoted

- The preview of `feature/planner-v1` at `ba249de` (CI run 44517123412 green) was promoted with `vercel promote`. This created production deployment `branchx-bftm-planner-26ufront9`. There was no new migration.
- Checked:
  - `/api/health` gives ok;
  - signed-out `/api/map/prospects` gives 401.
- Rollback: `vercel rollback` to `branchx-bftm-planner-ak258wd8d`.

### 2026-11-19: E1-S3 promoted

- The preview of `feature/planner-v1` at `6746ff6` (CI run 44459976222 green) was promoted with `vercel promote`. This created production deployment `branchx-bftm-planner-ak258wd8d`. There was no new migration.
- Checked:
  - `/api/health` gives ok;
  - signed-out `/api/funding-officers/:id/deactivation-preview` gives 401.
- Rollback: `vercel rollback` to `branchx-bftm-planner-1w9mcadg1`.

### 2026-11-19: E5-S1 promoted

- The preview of `feature/planner-v1` at `8d99eec` (CI run 44458705500 green) was promoted with `vercel promote`. This created production deployment `branchx-bftm-planner-1w9mcadg1`.
- Migration `0007_target` (a new `target` table, additive only) was applied to the shared Neon database by the build; its log says "Migrations applied."
- Checked:
  - `/api/health` gives ok with the database ok;
  - signed-out `/api/dashboard` and `/api/targets` give 401.
- Rollback: `vercel rollback` to `branchx-bftm-planner-4ud14d6j2`. The new table can stay, because the older code does not read it.

### 2026-11-19: E4-S1 promoted

- The preview of `feature/planner-v1` at `5ea14c8` (CI run 44454699622 green) was promoted with `vercel promote`. This created production deployment `branchx-bftm-planner-4ud14d6j2`.
- Migration `0006_activity` (a new `activity` table and the `activity_status` enum, additive only) was applied to the shared Neon database by the build; its log says "Migrations applied."
- Checked:
  - `/api/health` gives ok with the database ok;
  - signed-out `/api/activities` gives 401.
- Rollback: `vercel rollback` to `branchx-bftm-planner-b2hhado1x`. The new table can stay, because the older code does not read it.

### 2026-11-19: E3-S2 and BUG-3 promoted

- The preview of `feature/planner-v1` at `37417f5` (CI run 44451208848 green) was promoted with `vercel promote`. This created production deployment `branchx-bftm-planner-b2hhado1x`. There was no new migration.
- Checked:
  - `/api/health` gives ok with the database ok;
  - signed-out `/pengaturan/template-pipeline` redirects to `/masuk`;
  - signed-out `/api/pipeline-templates` gives 401.
- Rollback: `vercel rollback` to `branchx-bftm-planner-nujm727zw`.

### 2026-11-19: work-in-progress build on production (user request, before the release gate)

- At the user's request ("make sure the data is on the production"), the preview of `feature/planner-v1` at commit `e2c948b` was promoted with `vercel promote`. That created production deployment `branchx-bftm-planner-nujm727zw`. `main` was not merged.
- Contents: E0 Foundation, E1-S1 and E1-S2, E2-S1 to E2-S3, E3-S1 and E3-S3, plus BUG-1 and BUG-2. Screens not built yet show a "sedang disiapkan" placeholder.
- Database: the shared Neon database (migrations 0000–0005, applied 2026-11-19; see First-time setup).
- Checked:
  - `/api/health` gives ok with the database ok;
  - sign-in as the test Admin gives 200;
  - signed-out `/prospect` redirects to `/masuk?next=%2Fprospect`;
  - signed in, `/`, `/prospect`, `/pengaturan/funding-officer` and `/prospect/baru` give 200;
  - `/api/pipeline-templates` returns "Umum".
- Until the release: after each Verified story, promote that story's green preview the same way, so production follows the branch. The final release still merges the pull request into `main` after the user confirms at the release gate.
- Rollback: `vercel rollback` to the previous production deployment (`branchx-bftm-planner-6q2gze7uz`, the setup placeholder).

### 2026-11-18: setup check (unplanned production deploy)

- Deployment `dpl_CWX17d5m8Pun6KpmfnNA1PUwnY7M`, made with `vercel deploy` from the working tree, meant as a preview. Vercel assigns a project's first deployment to production, so it went live at https://branchx-bftm-planner.vercel.app without a release gate.
- Content: the placeholder page from commit `046d7ef`, plus the uncommitted database and region config. No feature code, no data.
- Migrations: `RUN_MIGRATIONS=true` ran `db:migrate`, which found no migrations and changed nothing.
- Rollback: none needed. The next merge to `main` replaces it. Lesson: when checking a new project, use `vercel deploy --target preview`.
