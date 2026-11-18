---
name: devops
description: Use when BFTM Planner needs its CI/CD set up or a feature released: GitHub Actions CI, the Vercel Git integration, Neon Postgres, Vercel Blob, environment variables, Vercel Cron, pull requests, preview and production checks, release records and rollback.
---

# DevOps

Keep BFTM Planner deployable, and release each feature. The target is a Vercel project on the personal Hobby account, deployed through its Git integration: every pushed branch gets a preview, and `main` is production. CI runs in GitHub Actions (`.github/workflows/ci.yml`).

## Before you start

Read `CLAUDE.md` (the git and release rules), `docs/architecture.md`, `docs/adr/` and `docs/ops/deploy.md` (if it exists). Release only stories the tester has marked `Verified`.

## First-time setup

Do these once, and record them in `docs/ops/deploy.md`. Skip them when that file shows they are done. Each step that changes something outside the repo needs the user's go-ahead.

1. **Create the Vercel project** and connect it to the GitHub repository (`origin`) through the Vercel Git integration. Use the dashboard or `vercel link` followed by `vercel git connect`. Confirm the project name with the user. Production branch: `main`.
2. **Provision the services** through the Vercel Marketplace: Neon Postgres, with a database branch for each preview deployment if the integration offers it, and Vercel Blob. Record each resource's name, not its credentials.
3. **Set environment variables** in Vercel for Preview and Production separately. Never write a secret into the repo, `CLAUDE.md` or a committed `.env` file. Keep `.env.example` current, with names only.
4. **Set `RUN_MIGRATIONS`.** Vercel runs `npm run vercel-build` automatically, and it migrates only when `RUN_MIGRATIONS=true`. Set it for Production. Set it for Preview only if each preview has its own Neon branch. If previews share the production `DATABASE_URL`, leave it unset there, or an unmerged branch could change the production schema.
5. **Check `vercel.json`.** It skips Vercel builds for docs-only commits. Keep that `ignoreCommand` when you add other settings, such as Cron.
6. **Protect `main` on GitHub**, if the user agrees: require the CI check to pass before merging.

## Every release

1. **Check CI** on the feature branch. With `gh`, look at the latest run. Stop if it is not green, and report which step failed.
2. **Open the pull request** into `main` with `gh pr create`. In the body, list the stories with their IDs and links to the QA reports, plus the preview URL and any migrations. Without `gh`, give the user the GitHub compare link.
3. **Check the preview.** Find the branch's preview URL (from the PR's Vercel check, or with `vercel ls`). Check that the pages load, sign-in works, and the feature's main flow works at a mobile width and a desktop width.
4. **Configure scheduled jobs** if the feature added any. Put Vercel Cron in `vercel.json`. The Hobby plan allows one run per day, so use an external free cron for anything more frequent.
5. **Ask the user** whether to release to production. Show the PR link, the preview URL and the check results. Stop until they answer.
6. **Merge.** On a clear yes: `gh pr merge --merge --delete-branch`. Vercel then builds `main`, and `vercel-build` runs the production migrations.
7. **Check production** the same way as the preview.
8. **Record the release.** Set the feature's stories to `Released` in the backlog, and fill in the epic's Release line (date, merge commit, preview URL, production URL). Add an entry to `docs/ops/deploy.md`: date, feature, merge commit, URLs, migrations run, and any manual steps. Set the feature file's phase to `done`. Then switch to `main`, pull, commit only these docs as `docs(<slug>): release record`, and push.
9. **Plan the rollback.** Note in `docs/ops/deploy.md` how to roll back: promote the previous deployment in Vercel, and revert the migration if one ran.
10. **Report.** If `/develop` is running, return to it.

## When a production check fails

Roll back right away by promoting the previous production deployment in Vercel. Record the rollback in `docs/ops/deploy.md`, then report the failure as a bug against the story that caused it. Do not try to fix forward on production.

## Companion skills

Use these if they are installed.

- `security-review`: before the first production release, and before any release that changes sign-in, uploads or environment variables.
- `superpowers:verification-before-completion`: check the preview and production URLs and the command output before reporting a release as working.
- `vercel:vercel-cli`, `vercel:env-vars`, `vercel:vercel-storage` and `vercel:deployments-cicd`: for the Vercel CLI, environment variables, Neon and Blob, and the deployment flow.

## Rules

- Never run `vercel deploy` without `--target preview` (or `--prod` after the release gate). Vercel sends a project's first deployment to production by default.

- Never release to production without the user's explicit confirmation in this conversation.
- Never push to `main` except for the merge of a confirmed release and its docs-only release record.
- Never print, log or commit secret values.
- Never skip CI, the build or the tests.
- Keep deployment configuration in the repo. Keep credentials in Vercel.
- Stay within the Hobby plan limits, and report any limit a feature would exceed.
