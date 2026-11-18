# Brief: BFTM Planner v1

Status: **approved** 2026-11-18. Feature slug: `planner-v1`. Source: `docs/product/prd.md` (approved 2026-11-18).

## Problem

A BFTM plans field acquisition for a team of Funding Officers across spreadsheets, chat messages and memory. There is no single list of Prospects and no shared view of where each acquisition stands. Visits cannot be proven, and progress against the monthly Target is added up by hand. Work gets stuck unnoticed, visits are double-booked or forgotten, and the team learns it is behind Target too late.

## Context

- **Who:** one BFTM, the only person who signs in (Admin). Up to 15 Funding Officers, who are records only.
- **Where and how:** mostly on a phone in the field or between visits, on a mobile connection that can be weak. Sometimes on a laptop at the branch, for planning and reviewing the month.
- **Volumes:** up to 2,000 Prospects, a few hundred open Pipelines, and about 100 Activities a week across the team.
- **Today:** the Prospect list lives in a spreadsheet. The Stage is remembered or kept in chat. Visit proof is a photo sent in chat. Monthly totals are added up by hand.
- **Before and after:** before, the BFTM receives Targets for the month and decides where the team goes. After, the BFTM reports progress upward. Reporting is outside the app in v1.

## Challenge

- **Smallest version that solves it:** the Prospect list plus Pipeline Stage tracking, and Target vs Actual. The Activities, Check-ins and map make the planning real. All four are in the approved PRD, so all stay in scope.
- **What would make it fail even if built as specified:**
  - If data entry is slow on a phone, the BFTM stops using it. Forms are short, with only the name required for a Prospect, and a location picker that uses GPS in one tap.
  - If the BFTM must record every Check-in for the whole team, it becomes a chore. A Check-in is a photo plus one tap, and the photo can come from the gallery (sent by the Funding Officer). That makes it Off-site, which is honest.
- **Simpler alternative considered:** a shared spreadsheet template. It is rejected because it has no map, no proof of visits and no automatic Target vs Actual.

## Users and roles

- **Admin (the BFTM):** full access to everything.
- **Funding Officer:** assigned to Prospects, Pipelines and Activities. No login.

## Goals

| # | Goal | Success measure |
|---|------|-----------------|
| G1 | One list of Prospects | Within 2 weeks of release, every Prospect the BFTM is actively working is in the app, and no separate spreadsheet is kept. |
| G2 | The Stage of every acquisition is known, and stuck work is visible | Every open Pipeline shows its Stage. Overdue Tasks and Activities appear on the dashboard. A Pipeline is reachable in 3 taps or fewer from the dashboard. |
| G3 | Field work is planned and proven | A week of Activities for the team is planned in under 10 minutes. 100% of Done Activities have a Check-in with a photo. |
| G4 | Progress against Target is visible | The dashboard shows the month's Target and Actual for each Funding Officer and the team, computed from Won Pipelines, with no manual totals. |

## Non-goals

Everything under "Out of scope" in the PRD. Also not in v1: bulk edit, a calendar sync (Google or Outlook), an audit log UI, and editing a Check-in after it is saved.

## User flow (main path)

1. The BFTM signs in on their phone.
2. **Setup, once:** add the Funding Officers, check the default Pipeline Template, and set this month's Target for each Funding Officer.
3. **Add a Prospect:** name, Category, location (GPS or a tap on the map), Contact Person, Potential Accounts, and a Funding Officer.
4. **Start a Pipeline** on the Prospect from a template. It starts at the first Stage and copies the Prospect's Funding Officer.
5. **Plan the week in Jadwal:** add Activities, each with a Prospect, a Funding Officer, a date and time, a purpose, and optionally a linked Pipeline.
6. **In the field:** open today's Activity, then Check-in with a photo and GPS. The Check-in is marked On-site or Off-site, and the Activity becomes Done.
7. **After the visit:** tick Tasks on the Pipeline and move it to the next Stage.
8. **Close:** set the Outcome to Won with the Accounts Opened and the date, or to Lost with a reason, or to On Hold.
9. **Dashboard:** see Target vs Actual for the month, what is overdue, and what is coming up. Peta shows where the Prospects are and their Stage.

## Edge cases

Decided by: `user` means the user chose it in discovery. `proposal` means the product-owner proposes it and the user approves it with this brief.

| # | Case | Expected behaviour | Decided by |
|---|------|--------------------|------------|
| **Empty and first use** ||||
| EC1 | First sign-in with no data | The dashboard shows an empty state with the next setup steps, in order: add Funding Officers, set the Target, add a Prospect. No zeros without context. | proposal |
| EC2 | No Funding Officers yet | Prospect, Pipeline and Activity forms say that a Funding Officer must be added first, and link to Pengaturan: Funding Officer. | proposal |
| EC3 | A Pipeline Template with no Stages | It cannot be saved. It needs at least one Stage. A Stage with no Tasks is allowed. | proposal |
| EC4 | No Target set for a month | The dashboard shows Actual with "Target belum diatur" and a link to set it, not a 0 % bar. | proposal |
| EC5 | Map with no located Prospects | The map shows the default area with a note that no Prospect has a location yet, and a link to add one. | proposal |
| **Volume** ||||
| EC6 | 2,000 Prospects | The list is paged at 50 rows, with search and filters on the server. The map clusters markers. Tests run with 1,000+ Prospects. | user |
| EC7 | A long Prospect name (up to 150 characters) | It wraps on mobile and truncates with a full-name tooltip in table cells. Over 150 characters is rejected. | proposal |
| EC8 | Many Activities on one day | Jadwal lists them in time order, grouped by Funding Officer, without a fixed height. | proposal |
| **Invalid input** ||||
| EC9 | Missing Prospect name | Inline error "Nama Prospect wajib diisi". Nothing is saved. | proposal |
| EC10 | Potential Accounts, Accounts Opened or Target negative, a decimal or huge | Integers only: Potential Accounts and Target from 0 to 100,000, and Accounts Opened from 1 to 100,000. Otherwise an inline error. | proposal |
| EC11 | Phone in a different format (08…, 628…, +62…, with spaces or dashes) | Normalised to `+62…`. Anything that is not 9 to 13 digits after the country code is rejected with an example of a valid number. | proposal |
| EC12 | Free-text over 500 characters | A counter is shown, and the input stops at 500. The server also rejects over 500. | proposal |
| EC13 | Location outside Indonesia's bounding box | Rejected with "Lokasi di luar Indonesia". | proposal |
| **Duplicates** ||||
| EC14 | The same Prospect entered twice | On save, if a Prospect with the same name (ignoring case and spaces) exists, a warning lists it with a link. The Admin can still save, because two branches of a school chain can share a name. | proposal |
| EC15 | A double-tapped submit | The button is disabled while saving. Creating a record is idempotent per form submission, so a double tap makes one record. | proposal |
| EC16 | Starting a second Pipeline on a Prospect with an open one | Not allowed. The action is hidden, and the server rejects it with "Prospect ini masih punya Pipeline yang berjalan". | user |
| EC17 | Two Targets for the same Funding Officer and month | Not possible. Setting a Target again updates the existing one. | proposal |
| **Concurrency** ||||
| EC18 | The same record edited in two tabs | Saving a record that changed since it was loaded is rejected with "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru." Nothing is overwritten silently. | proposal |
| **Deletion and references** ||||
| EC19 | Archiving a Prospect with an open Pipeline | Blocked: "Tutup atau tunda Pipeline dulu." Archiving a Prospect also cancels its future Scheduled Activities, after a confirmation that shows how many. | proposal |
| EC20 | Deactivating a Funding Officer with open work | Allowed after a confirmation that shows the counts of open Pipelines, Prospects and future Activities. Those keep the Funding Officer and are flagged "Funding Officer nonaktif" so the Admin can reassign them. Past credit is unchanged. | proposal |
| EC21 | Editing or archiving a Pipeline Template that Pipelines use | A Pipeline copies the template's Stages and Tasks when it starts, so later template edits affect only new Pipelines. A template in use can be archived but not deleted. An archived template cannot start new Pipelines. | proposal |
| EC22 | Deleting any record | v1 has no hard delete for Prospects, Funding Officers, Pipelines or Templates. An Activity can be Cancelled. A Task can be removed from one Pipeline. | proposal |
| **State transitions** ||||
| EC23 | Moving between Stages | Any Stage, forward or back. Moving forward with unticked Tasks shows a warning with the count, and the move is allowed. Not possible on a closed or On Hold Pipeline. | user |
| EC24 | Setting the Outcome | Open → Won (requires Accounts Opened and a Won date that is not in the future), Open → Lost (requires a reason), Open → On Hold. On Hold → Open (resume at the same Stage), On Hold → Lost. | proposal |
| EC25 | Reopening a Won or Lost Pipeline | The Admin confirms. The Outcome and Accounts Opened are cleared, so Actual for that month goes down, and the confirmation says so. Not allowed if the Prospect already has another open Pipeline. | proposal |
| EC26 | Reassigning a Prospect to another Funding Officer | Changes only the Prospect. The open Pipeline's Funding Officer is changed separately. Actual follows the Pipeline's Funding Officer. | user |
| EC27 | An Activity status change | Scheduled → Done (only through a Check-in), Scheduled → Cancelled. Done and Cancelled are final. A cancelled visit is re-planned as a new Activity. | proposal |
| **Time** ||||
| EC28 | An Activity in the past | It can be created (to record a visit after the fact) and is immediately Overdue until it is checked in. | proposal |
| EC29 | A Check-in before the Activity's day | Not allowed. The Check-in button is hidden until the Activity's date in WIB. | proposal |
| EC30 | Overdue | A Task is Overdue when its due date (WIB) has passed and it is unticked on an open Pipeline. An Activity is Overdue when its time has passed and it is still Scheduled. Both appear on the dashboard. | proposal |
| EC31 | Month boundaries | Won on 31 January at 23:30 WIB counts in January. The month is computed in WIB, not UTC. | proposal |
| EC32 | A Won date in the future | Rejected. | proposal |
| **Location** ||||
| EC33 | GPS denied, slow (over 15 s) or inaccurate (accuracy worse than 200 m) | The Check-in still saves without GPS, as Off-site, with the reason shown ("GPS tidak tersedia"). The Prospect form falls back to picking on the map. | user |
| EC34 | A Prospect with no location | It does not appear on the map. The list marks it "Belum ada lokasi". A Check-in for it is Off-site. | proposal |
| EC35 | A Check-in within or outside 200 m | Distance by haversine from the Prospect location. ≤ 200 m is On-site, otherwise Off-site, and the distance is shown. | user |
| **Network and files** ||||
| EC36 | A save fails midway | The form keeps the input and shows "Gagal menyimpan. Periksa koneksi lalu coba lagi." with a retry. No partial records are kept. | proposal |
| EC37 | A large photo, or one in the wrong format | Resized on the device to 1600 px on the long edge as JPEG. Only images are accepted (JPEG, PNG, WebP, and HEIC if the browser can decode it). More than 5 MB after resizing is rejected with a clear message. | user |
| EC38 | A slow upload | A progress indicator is shown. The Check-in record is saved only after the photo is stored, so there is never a Check-in without a photo. | proposal |
| **Permissions** ||||
| EC39 | Signed out, or session expired | Every page and API redirects to or answers with sign-in. After sign-in, the Admin returns to the page they asked for. | proposal |
| EC40 | Direct URL to a missing or archived record | A "not found" page with a link back to the list. Archived records still open read-only, with a restore action. | proposal |
| EC41 | Repeated wrong passwords | After 5 failures in 15 minutes for an email, sign-in is refused for 15 minutes. The message does not reveal whether the email exists. | proposal |
| **Data protection (ADR 0001)** ||||
| EC42 | Someone types an account holder's name, NIK or account number into free text | Every free-text field shows a hint: "Jangan tulis nama, NIK, atau nomor rekening nasabah." A 16-digit number (NIK pattern) or a 10+-digit number that is not a phone number blocks the save with a specific message. | proposal |
| EC43 | A photo of an identity document | The Check-in screen says the photo must show the place or the activity, not a KTP or a passbook. It cannot be enforced automatically. | proposal |
| **Language and format** ||||
| EC44 | Numbers, dates and plurals | Numbers use `id-ID` grouping (1.250). Dates use "18 Nov 2026" and times "14.30 WIB". There is no plural suffix ("3 Prospect", "1 Kegiatan"). | proposal |
| EC45 | Long Indonesian words in narrow layouts | Labels wrap rather than overflow at 360 px. Badges have a minimum width and do not truncate the Stage name below 12 characters. | proposal |

## Constraints

- The hard rules in `CLAUDE.md`: Admin only, no Telegram, online only, no individual customer data, and UI in Bahasa Indonesia.
- Vercel Hobby plan, Neon Postgres in Singapore, Vercel Blob for photos.
- No deadline was given.

## Glossary terms used

Admin, BFTM, Funding Officer, Prospect, Category, Contact Person, Potential Accounts, Pipeline, Pipeline Template, Stage, Task, Outcome, Accounts Opened, Activity, Overdue, Check-in, On-site / Off-site, On-site Radius, Target, Actual. No new terms.

## Open questions

None blocking. The PRD's open questions were settled at the PRD gate (On-site Radius 200 m, 5 MB photos, WIB only, default Stages, fixed Categories).
