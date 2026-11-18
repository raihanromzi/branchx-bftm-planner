# BFTM Planner: product requirements (v1)

Status: **approved** 2026-11-18. Owner: product-owner. Last updated 2026-11-18.

## Summary

BFTM Planner is a responsive web app (PWA) that a BFTM uses to plan field acquisition for their team of Funding Officers. The BFTM keeps one list of institution- and venue-level Prospects, runs each acquisition through a staged Pipeline built from a Pipeline Template, schedules field Activities per Funding Officer, records Check-ins as proof of visits, and sees monthly progress against Target on a dashboard and a map.

It is a prototype hosted outside bank infrastructure. It stores no individual customer data (ADR 0001).

## Goals and success measures

Measures marked _(proposal)_ are defaults to confirm at the PRD gate.

| # | Goal | Success measure |
|---|------|-----------------|
| G1 | One list of Prospects replaces scattered spreadsheets and chat notes. | Within 2 weeks of release, every Prospect the BFTM is actively working is in the app, and the BFTM no longer keeps a separate Prospect spreadsheet. _(proposal)_ |
| G2 | The BFTM knows the Stage of every acquisition and what is stuck or overdue. | Every open Pipeline shows its current Stage, and overdue Tasks and Activities are listed on the dashboard, with no other source needed. A Pipeline's Stage can be found in under 3 taps from the dashboard. _(proposal)_ |
| G3 | Field work is planned and proven. | The BFTM can plan a week of Activities for the whole team in under 10 minutes. Every completed Activity has a Check-in with a photo. _(proposal)_ |
| G4 | Progress against Target is visible. | The dashboard shows this month's Target and Actual for each Funding Officer and for the team, computed from Won Pipelines, with no manual totals. |

## Users and roles

- **Admin:** the only role in v1, and the only person who signs in. In practice the Admin is the **BFTM**. The BFTM plans and records work for their Funding Officers.
- **Funding Officer:** a member of the BFTM's team. In v1, a Funding Officer is a record (a name and a phone number) that Prospects, Pipelines and Activities are assigned to. Funding Officers do not sign in.
- Not in v1: Funding Officer, Branch Manager or Area Manager logins and permissions.

Usage: mostly on a phone in the field, sometimes on a laptop at the branch. Online only.

## v1 scope

1. **Admin sign-in.** Email and password. Admin accounts are created by a seed script. There is no public sign-up. Sessions use an httpOnly cookie and last 30 days. Sign-out is available.
2. **Funding Officers.** Add, edit and deactivate (name, phone). A deactivated Funding Officer stays on past records but cannot be assigned new work.
3. **Prospects.** Create, edit, archive and restore. Fields: name (required), Category, address, location (latitude and longitude, set on the map or from the device's GPS, optional), one Contact Person (name, role, phone), Potential Accounts (an integer of 0 or more), the assigned Funding Officer, and a short note. List with search and filters (Category, Funding Officer, archived).
4. **Pipeline Templates.** Create and edit templates with ordered Stages. Each Stage has a checklist of Task names. The app ships with one default template. A template that is in use cannot be deleted, but it can be archived.
5. **Pipelines.** Start a Pipeline for a Prospect from a Pipeline Template. A Prospect has at most one open Pipeline at a time, and any number of closed ones. Move the Pipeline between Stages, tick off Tasks (each Task can have a due date), and close it with an Outcome:
   - **Won:** requires Accounts Opened (an integer of 1 or more) and a Won date.
   - **Lost:** requires a short reason.
   - **On Hold:** pauses the Pipeline. It can be resumed.
   - A Won or Lost Pipeline can be reopened by the Admin, which clears the Outcome.
6. **Activities.** Schedule an Activity (a field visit or meeting) with a Prospect: date and time, the Funding Officer, an optional linked Pipeline, and a purpose. Statuses: Scheduled, Done, Cancelled. An Activity whose time has passed while it is still Scheduled is overdue.
7. **Check-ins.** On an Activity, the Admin records a Check-in: a photo (required, stored in Vercel Blob), the device's GPS if available, and a note. The Check-in is marked **On-site** when its GPS is within the On-site Radius of the Prospect's location, and **Off-site** when it is outside it or when GPS or the Prospect's location is missing. Recording a Check-in marks the Activity Done.
8. **Targets.** The Admin sets a monthly Target (new accounts) for each Funding Officer. The team Target is their sum.
9. **Dashboard.** For a chosen month (default: the current month): Target vs Actual for the team and for each Funding Officer, overdue Tasks and Activities, today's and the next 7 days' Activities, and open Pipelines by Stage.
10. **Map.** Prospects with a location, on OpenStreetMap through Leaflet, coloured and labelled by the Stage of their open Pipeline. Filter by Funding Officer and Stage. On mobile, a toggle switches between map and list.
11. **PWA.** Installable to the home screen, with a manifest and icons. No offline data.

## Out of scope

- Logins or permissions for anyone other than the Admin.
- Telegram: bot, webhook, digest or reminder. No email or push notifications either.
- Offline use or sync.
- Any individual customer data: account holders' names, NIK, account numbers or balances.
- Incremental account openings over time. In v1, accounts are counted once, when the Pipeline is Won.
- Multiple branches or areas, and cross-team reporting.
- Import from or export to spreadsheets.
- Route planning or turn-by-turn navigation.

## Screens

UI text is Bahasa Indonesia. The screen names below are working names.

| Screen | Purpose |
|--------|---------|
| Masuk | Admin sign-in |
| Dashboard | Month picker, Target vs Actual (team and per Funding Officer), overdue items, upcoming Activities, open Pipelines by Stage |
| Prospect: list | Search, filter, add. Each row shows its Stage and Funding Officer. |
| Prospect: detail | Data, Contact Person, open Pipeline, Pipeline history, Activities |
| Prospect: form | Create and edit, with a map location picker |
| Pipeline: detail | Stages with Tasks, move Stage, set Outcome, reopen |
| Jadwal | Activities by day and week, filtered by Funding Officer. Add an Activity. |
| Activity: detail | Status, Check-in, cancel |
| Check-in | Photo, GPS, note |
| Peta | Prospect map with filters, and a list toggle on mobile |
| Pengaturan: Funding Officer | List, add, edit, deactivate |
| Pengaturan: Pipeline Template | List, edit Stages and Tasks, archive |
| Pengaturan: Target | Monthly Target per Funding Officer |

## Data rules

- **ADR 0001, no individual customer data.** Only institution- and venue-level Prospects, one minimal Contact Person (name, role, phone), and account counts. Free-text fields (Prospect note, Activity purpose, Check-in note, Lost reason) show a warning not to enter an account holder's name, NIK or account number, and are limited to 500 characters.
- Check-in photos are of the venue or the activity, not of identity documents. The Check-in screen says so.
- Archive instead of delete for Prospects, Funding Officers and Pipeline Templates that other records point to.
- Phone numbers are Indonesian numbers, stored normalised as `+62…`.
- Times are stored in UTC and shown in WIB (Asia/Jakarta). _(proposal)_
- The month for Target and Actual is the WIB calendar month of the Won date.

## Stack

As in `CLAUDE.md`: Next.js (App Router) and TypeScript on Vercel, shadcn/ui on Tailwind, Postgres on Neon with Drizzle and postgres.js, Vercel Blob for Check-in photos, Leaflet with OpenStreetMap, Vitest and Playwright, and GitHub Actions CI.

## Open questions

1. On-site Radius: proposed 200 m. Confirm or change.
2. Check-in photo limits: proposed JPEG, PNG or WebP, at most 5 MB after resizing on the device to 1600 px on the long edge.
3. Time zone: proposed WIB only. Does the team work in WITA or WIT?
4. The default Pipeline Template's Stages and Tasks: proposed Identifikasi → Pendekatan → Presentasi → Negosiasi → Pembukaan Rekening. The BFTM should confirm the real Stages.
5. Prospect Categories: proposed Sekolah, Pasar, Perusahaan, Instansi, Komunitas and Lainnya. Is a fixed list right, or should the Admin be able to edit it?
