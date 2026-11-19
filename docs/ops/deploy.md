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
| Vercel Blob | Not started | Needed when the first Check-in photo story is built. |
| Branch protection on `main` | Not started | Optional: require the CI check before merging. |

## Local development

Run `vercel env pull .env.local` to fetch the Development variables. `.env.local` is git-ignored.

## Releases

### 2026-11-18: setup check (unplanned production deploy)

- Deployment `dpl_CWX17d5m8Pun6KpmfnNA1PUwnY7M`, made with `vercel deploy` from the working tree, meant as a preview. Vercel assigns a project's first deployment to production, so it went live at https://branchx-bftm-planner.vercel.app without a release gate.
- Content: the placeholder page from commit `046d7ef`, plus the uncommitted database and region config. No feature code, no data.
- Migrations: `RUN_MIGRATIONS=true` ran `db:migrate`, which found no migrations and changed nothing.
- Rollback: none needed. The next merge to `main` replaces it. Lesson: when checking a new project, use `vercel deploy --target preview`.
