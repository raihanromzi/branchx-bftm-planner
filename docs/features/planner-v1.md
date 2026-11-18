---
feature: planner-v1
title: BFTM Planner v1
phase: design
branch: feature/planner-v1
started: 2026-11-18
updated: 2026-11-18
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
- Designs:
- QA reports:
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

## Blocked on

(none)
