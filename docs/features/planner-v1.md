---
feature: planner-v1
title: BFTM Planner v1
phase: build
branch: feature/planner-v1
started: 2026-11-18
updated: 2026-11-19
---

# BFTM Planner v1

## Request

read the PRD in @CLAUDE.md and develop the feature version 1

## Artifacts

- PRD: docs/product/prd.md (approved)
- Glossary: GLOSSARY.md (approved)
- Brief: docs/product/briefs/planner-v1.md (approved)
- Epic and stories: docs/product/backlog.md, E0 to E6 (approved)
- ADRs: docs/adr/0001 to 0005; docs/architecture.md
- Designs: docs/design/ (14 screens); DESIGN.md confirmed
- QA reports: docs/product/qa/ (one per story)
- Pull request:
- Preview URL:
- Production release:

## Log

- 2026-11-18 bootstrap: `docs/product/prd.md` and `GLOSSARY.md` did not exist, so phase 0 started. Branch `feature/planner-v1` created from `main` (345cd81).
- 2026-11-18 bootstrap: decisions made with the user: the BFTM is the only Admin, and Funding Officers are records without a login. All four goals are in v1 (Prospect list, Pipeline Stages, field schedule with Check-ins, Target vs Actual). Pipeline Templates are editable. Targets are monthly per Funding Officer. The BFTM records Check-ins with optional GPS (On-site or Off-site). Accounts Opened is entered when a Pipeline is Won, and a Prospect has one open Pipeline at a time. Sign-in uses a seeded email and password. The PRD and glossary are drafted and waiting for approval.
- 2026-11-18 bootstrap gate: the user approved the PRD and glossary, including the proposed defaults for open questions 1 to 5 (200 m On-site Radius, 5 MB photos, WIB only, the default Stages, a fixed Category list).
- 2026-11-18 brief: user decisions: a Pipeline has its own Funding Officer, who gets the Actual credit; Stage moves are free, with a warning for unticked Tasks; volume is up to 15 Funding Officers and 2,000 Prospects (paged lists, clustered map). Brief written with 45 edge cases and waiting for approval.
- 2026-11-18 brief gate: the user approved the brief, including all proposed edge-case behaviours.
- 2026-11-18 backlog: 7 epics (E0 to E6), 27 stories, 119 points. All 45 edge cases traced. E0-S1 is mostly in place from project setup. Waiting for approval.
- 2026-11-18 backlog gate: the user approved the stories as written.
- 2026-11-18 architecture: ADR 0001 (no customer data) was written from the hard rule. The user picked the recommended option for each decision: ADR 0002, sign-in with scrypt and database sessions, no auth library; ADR 0003, JSON Route Handlers over a service layer; ADR 0004, private Vercel Blob uploaded through the server; ADR 0005, Postgres in Docker for local development and tests. docs/architecture.md written.
- 2026-11-18 design: the user chose the deep teal accent (#0E6E73), Plus Jakarta Sans, a 6 px radius and the 14/16/20/28 type scale. DESIGN.md is confirmed, with colour tokens, a Stage colour ramp with dot marks, map markers numbered by Stage position, and UI labels. 14 screen designs written. Two open questions added to the backlog (a Stage filter on the Prospect list, and grouping Pipelines by Stage across templates). The backlog copy for E3-S4 #3 now uses "Tugas". Waiting for design approval.
- 2026-11-18 design gate: the user approved DESIGN.md, the 14 screen designs and both proposals, now in E2-S1 #4 and E5-S1 #6.
- 2026-11-19 build: the E0 Foundation is Verified, with CI green on each push.
  - E0-S1 `6577b0b`
  - E0-S2 `fe011d7`: Docker Postgres for local and tests; `.env.local` now points at it, with the Neon values backed up in `.env.neon.local`.
  - E0-S6 `24a8f9d`: review fix, the customer-number guard no longer rejects dates in notes.
  - E0-S3 `9bedd8c`: security review clean; sign-out without a session answers 401, per ADR 0002.
  - E0-S4 `74aa7f2`
  - E0-S5 `060e08a`: an open-redirect guard on `next`.
  - Follow-up recorded: the focus ring on shared Input and Button, to fix in E1-S2.

- 2026-11-19 build: more stories Verified with CI green:
  - E1-S1 `30fb8eb`, E1-S2 `d179c9d`;
  - E2-S1 `c0c3a9c`, after a review fix that made Category optional;
  - E2-S2 `fb0e004`;
  - E2-S3 `cd61e27`, with BUG-2 (focus lost after a server error, found by CI) fixed in `4699377`;
  - E3-S1 `5017255`;
  - E3-S3 `f842ae8`.
  The Stage filter moved from E2-S1 to E3-S3 #9 (sequencing only).
- 2026-11-19 user decision: archiving a Prospect is blocked only by an open Pipeline, not On Hold (the brief's EC19 over E3-S3 #8); fixed in `e2c948b`.
- 2026-11-19 user requests:
  - A dummy Admin `admin@contoh.id` in the local database, then in the shared Neon database. Migrations 0000–0005 were applied to Neon early, and the user chose to keep the weak test password.
  - "Make sure the data is on the production": the e2c948b preview was promoted to production without merging `main`. From now on, promote each Verified story's preview to production. Recorded in docs/ops/deploy.md.
- 2026-11-19 build: E3-S2 `3f15d2b` Verified; BUG-3, found by CI, fixed in `37417f5`, and CI is green. Promoted to production as `b2hhado1x`.
- 2026-11-19 build: E4-S1 `5ea14c8` Verified, with CI green. Promoted to production as `4ud14d6j2`, and migration 0006 was applied to Neon. The ESLint ignores now cover `playwright-report/` and `test-results/`.
- 2026-11-19 build: E5-S1 `8d99eec` Verified, with CI green. Promoted to production as `1w9mcadg1`, and migration 0007 was applied to Neon. E1-S3 `6746ff6` Verified. Two follow-ups added to the backlog: the inactive Funding Officer filter for E1-S4, and what "open" means across the API.
- 2026-11-19 build: E6-S1 `ba249de` Verified and promoted as `26ufront9`. The local unit tests had been stalling at random; restarting Docker Desktop fixed it, and the user chose that fix (option 1) over relying on CI. The user confirmed the map's latest-Pipeline rule and asked to build every remaining story. BUG-4 (`8067f2f`): `GET /api/activities` gained `prospectId`, for E2-S4.

## Blocked on

(none)
