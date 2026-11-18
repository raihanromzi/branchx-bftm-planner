# Backlog

Owned by the product-manager. The tester sets `Verified`, and devops sets `Released`. Statuses: `Todo` → `In progress` → `Done` → `Verified` → `Released`, plus `Blocked` with a reason.

The Definition of Done in `CLAUDE.md` applies to every story and is not repeated in the criteria.

## E0 Foundation (feature: planner-v1)

Outcome: the app builds, deploys, talks to Postgres, and only a signed-in Admin can reach it, inside the app shell from `DESIGN.md`.
Release:

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E0-S1 | As an Admin, I want the app scaffolded on the agreed stack, so that every later story builds on a working, tested base. | 2 | backend | none | Verified |
| E0-S2 | As an Admin, I want the app connected to Postgres with migrations and a health check, so that data is stored safely and its state can be checked. | 3 | backend | E0-S1 | Verified |
| E0-S3 | As an Admin, I want to sign in with my email and password, so that only I can see and change the team's data. | 5 | backend | E0-S2, ADR 0002 | Verified |
| E0-S4 | As an Admin, I want an app shell with navigation that fits my phone and my laptop, and that I can install, so that I can reach every screen quickly. | 5 | frontend | E0-S1 | Verified |
| E0-S5 | As an Admin, I want a sign-in screen, so that I can get into the app and return to the page I asked for. | 3 | frontend | E0-S3, E0-S4 | Verified |
| E0-S6 | As an Admin, I want every form to apply the same input rules, so that phone numbers are consistent, customer data is kept out, and nothing is saved twice or overwritten silently. | 5 | backend | E0-S2 | Verified |

### E0-S1 acceptance criteria
1. The npm scripts `dev`, `lint`, `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `build` and `vercel-build` exist with exactly these names.
2. Playwright has the projects `mobile` (360 × 800), `tablet` (768 × 1024) and `desktop` (1280 × 800).
3. `.env.example` lists every environment variable the app reads, with no values.
4. `npm run build` succeeds with no environment variables set.
5. The CI workflow passes on a pushed branch.

### E0-S2 acceptance criteria
1. The app's database client uses `DATABASE_URL` with `prepare: false`. Migrations use `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL`.
2. The same client works against plain Postgres in CI.
3. A first migration exists in `drizzle/`, and `npm run db:migrate` applies it to an empty database and is a no-op when run again.
4. `GET /api/health` returns 200 with `{ "status": "ok", "database": "ok" }` when the database answers, and 503 with `"database": "error"` when it does not, without exposing connection details.

### E0-S3 acceptance criteria
1. A seed script creates or updates an Admin from an email and a password given on the command line. The password is stored only as a strong hash.
2. Signing in with the right email and password sets an httpOnly, Secure (in production), SameSite=Lax session cookie that lasts 30 days.
3. Signing in with a wrong email or a wrong password gives the same error, which does not reveal whether the email exists.
4. After 5 failed sign-ins for an email within 15 minutes, further attempts for that email are refused for 15 minutes, even with the right password. (EC41)
5. Every API route except sign-in and the health check answers 401 without a valid session. (EC39)
6. Signing out ends the session on the server, so the old cookie no longer works.

### E0-S4 acceptance criteria
1. On mobile and tablet, a bottom navigation shows Dashboard, Prospect, Jadwal, Peta and Lainnya. On desktop, a sidebar shows the same destinations plus Pengaturan.
2. The current destination is marked by more than colour alone (weight, an indicator or an icon fill).
3. The tokens, font and radius chosen in `DESIGN.md` are applied, and no screen shows the untouched shadcn default look.
4. A web app manifest with name, icons (192 and 512 px) and theme colour makes the app installable. No service worker caches data (online only).
5. Shared format helpers render numbers as `1.250`, dates as `18 Nov 2026` and times as `14.30 WIB`, in WIB, with no plural suffix on nouns. (EC44)
6. A sign-out action is reachable from the navigation.

### E0-S5 acceptance criteria
1. Visiting any page while signed out redirects to the sign-in screen. After signing in, the Admin lands on the page they asked for, or on the dashboard if there was none. (EC39)
2. A wrong email or password shows "Email atau kata sandi salah." without clearing the email field.
3. A locked-out email shows "Terlalu banyak percobaan. Coba lagi dalam 15 menit." (EC41)
4. The submit button is disabled while signing in.
5. A signed-in Admin who opens the sign-in screen is sent to the dashboard.

### E0-S6 acceptance criteria
1. A phone number given as `08…`, `628…` or `+62…`, with or without spaces or dashes, is stored as `+62…`. A number without 9 to 13 digits after the country code is rejected with the message "Nomor telepon tidak valid. Contoh: 0812 3456 7890". (EC11)
2. Every free-text field rejects more than 500 characters on the server. (EC12)
3. Free text containing a run of 16 digits (a NIK pattern), or a run of 10 or more digits that is not a valid phone number, is rejected with "Jangan tulis NIK atau nomor rekening nasabah." Spaces, dots and dashes between digits do not hide the run. (EC42)
4. Every create request carries a client-generated key. Repeating a create with the same key returns the first result and creates nothing new. (EC15)
5. Every update carries the version the client loaded. An update to a record that changed since then is rejected with 409 and "Data ini sudah diubah. Muat ulang untuk melihat versi terbaru." (EC18)
6. Validation errors come back per field in one consistent shape that every form can show inline.

## E1 Funding Officers (feature: planner-v1)

Outcome: the BFTM keeps the list of their Funding Officers that all work is assigned to.
Release:

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E1-S1 | As an Admin, I want to add, edit and deactivate Funding Officers, so that work can be assigned to the right person. | 3 | backend | E0-S3, E0-S6 | Verified |
| E1-S2 | As an Admin, I want a Funding Officer screen in Pengaturan, so that I can manage my team from my phone. | 3 | frontend | E1-S1, E0-S5 | Verified |
| E1-S3 | As an Admin, I want to know what open work a Funding Officer still has when I deactivate them, so that nothing is left without an owner. | 2 | backend | E1-S1, E3-S3, E4-S1 | Todo |
| E1-S4 | As an Admin, I want a confirmation that shows a Funding Officer's open work, and to see records whose Funding Officer is inactive, so that I can reassign them. | 2 | frontend | E1-S3, E1-S2 | Todo |

### E1-S1 acceptance criteria
1. A Funding Officer has a name (required, 1 to 100 characters), a phone (required, normalised by the E0-S6 rules) and an active flag.
2. The list returns active Funding Officers first, then inactive ones, sorted by name.
3. A deactivated Funding Officer can no longer be assigned to a new Prospect, Pipeline or Activity. The server rejects it with "Funding Officer ini sudah nonaktif."
4. A deactivated Funding Officer can be reactivated.
5. There is no endpoint that deletes a Funding Officer. (EC22)

### E1-S2 acceptance criteria
1. Pengaturan → Funding Officer lists every Funding Officer with name, phone and status. Inactive ones are marked "Nonaktif" with a label, not colour alone.
2. The Admin can add and edit a Funding Officer. Invalid input shows inline errors from the server.
3. The Admin can deactivate and reactivate a Funding Officer.
4. With no Funding Officers yet, the screen explains that work is assigned to Funding Officers, and shows a "Tambah Funding Officer" action.

### E1-S3 acceptance criteria
1. A deactivation preview returns the counts of the Funding Officer's Prospects (not archived), open Pipelines and future Scheduled Activities. (EC20)
2. Deactivating does not change the Funding Officer on any Prospect, Pipeline or Activity, and does not change any past Actual. (EC20)
3. Prospect, Pipeline and Activity responses say when their Funding Officer is inactive.

### E1-S4 acceptance criteria
1. Deactivating a Funding Officer with open work first shows a confirmation with the counts, for example "4 Prospect, 2 Pipeline, 3 Kegiatan mendatang masih atas nama Rina." (EC20)
2. Prospects, Pipelines and Activities whose Funding Officer is inactive show the label "Funding Officer nonaktif" in lists and detail. (EC20)
3. The Prospect list can be filtered to show only Prospects with an inactive Funding Officer.

### E1 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| EC20 Deactivating a Funding Officer with open work | E1-S3 | 1, 2 |
| EC20 | E1-S4 | 1, 2 |
| EC22 No hard delete | E1-S1 | 5 |

## E2 Prospects (feature: planner-v1)

Outcome: one searchable list of institution- and venue-level Prospects replaces the spreadsheet.
Release:

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E2-S1 | As an Admin, I want to create, edit, search, archive and restore Prospects, so that I have one reliable list. | 8 | backend | E1-S1, E0-S6 | Verified |
| E2-S2 | As an Admin, I want a paged Prospect list with search and filters, so that I can find any Prospect fast on my phone. | 5 | frontend | E2-S1, E0-S5 | Verified |
| E2-S3 | As an Admin, I want a Prospect form with a location picker, so that I can add a Prospect in the field in under a minute. | 5 | frontend | E2-S1, E0-S5 | Verified |
| E2-S4 | As an Admin, I want a Prospect detail page, so that I see its data, its Pipelines and its Activities in one place. | 3 | frontend | E2-S3, E3-S3, E4-S1 | Todo |

### E2-S1 acceptance criteria
1. A Prospect has: name (required, 1 to 150 characters), Category (Sekolah, Pasar, Perusahaan, Instansi, Komunitas or Lainnya), address, location (optional latitude and longitude), Contact Person (name, role, phone), Potential Accounts, Funding Officer (required, active) and a note. There is no field for an account holder. (EC7, EC9)
2. Potential Accounts accepts only integers from 0 to 100,000. (EC10)
3. A location outside Indonesia's bounding box (latitude −11 to 6, longitude 95 to 141) is rejected with "Lokasi di luar Indonesia." (EC13)
4. The list is paged at 50 rows, sorted by name, and supports search by name and filters by Category, Funding Officer, archived status, "no location", all on the server. Each row carries `openPipeline` (null until E3-S3 fills it). The Stage filter moved to E3-S3 #9, because it needs Pipelines. It stays under 500 ms with 2,000 Prospects. (EC6)
5. Creating or renaming a Prospect whose name matches an existing one (ignoring case and repeated spaces) still saves, and the response lists the matching Prospects. (EC14)
6. Changing a Prospect's Funding Officer changes only the Prospect. (EC26)
7. Archived Prospects are excluded from the default list, can still be fetched by ID with `archived: true`, and can be restored. There is no endpoint that deletes a Prospect. (EC22, EC40)

### E2-S2 acceptance criteria
1. The list shows 50 Prospects per page, with name, Category, Funding Officer and the Stage of the open Pipeline (or "Belum ada Pipeline"). (EC6)
2. Search and the Category and Funding Officer filters update the list and survive a page reload, because they live in the URL.
3. A Prospect without a location is marked "Belum ada lokasi". (EC34)
4. A 150-character name wraps on mobile, and is truncated with the full name available on hover or focus in the desktop table. Stage badges are not truncated below 12 characters. (EC7, EC45)
5. With no Prospects, the list shows what a Prospect is and a "Tambah Prospect" action. With no search results, it says nothing matched and offers to clear the filters.
6. "Tampilkan arsip" shows archived Prospects, each labelled "Diarsipkan".

### E2-S3 acceptance criteria
1. Saving without a name shows "Nama Prospect wajib diisi" inline, and nothing is saved. Other server errors appear under their fields. (EC9)
2. With no active Funding Officers, the form says one must be added first and links to Pengaturan → Funding Officer. (EC2)
3. "Gunakan lokasi saya" fills the location from GPS. If GPS is denied or fails, the form says so and the Admin can tap the map instead. (EC33)
4. The note field shows a 500-character counter, stops at 500, and shows the hint "Jangan tulis nama, NIK, atau nomor rekening nasabah." (EC12, EC42)
5. The save button is disabled while saving, so a double tap creates one Prospect. (EC15)
6. When the server reports a Prospect with the same name, a warning lists it with a link, and the Admin can open it or confirm the save. (EC14)
7. A failed save keeps every input and shows "Gagal menyimpan. Periksa koneksi lalu coba lagi." with a retry. A 409 shows the reload message from E0-S6. (EC18, EC36)

### E2-S4 acceptance criteria
1. The page shows the Prospect's data, Contact Person (with a tap-to-call link), Funding Officer, the open Pipeline with its Stage, the closed Pipelines, and upcoming and past Activities.
2. "Mulai Pipeline" appears only when the Prospect has no open Pipeline and is not archived. (EC16)
3. Archiving a Prospect with an open Pipeline is not offered. The page says "Tutup atau tunda Pipeline dulu." (EC19)
4. Archiving otherwise asks for confirmation and says how many future Kegiatan will be cancelled. (EC19)
5. An archived Prospect opens read-only with the label "Diarsipkan" and a "Pulihkan" action. A missing ID shows a not-found page with a link back to the list. (EC40)

### E2 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| EC2 No Funding Officers yet | E2-S3 | 2 |
| EC6 2,000 Prospects | E2-S1 | 4 |
| EC6 | E2-S2 | 1 |
| EC7 Long name | E2-S1 | 1 |
| EC7 | E2-S2 | 4 |
| EC9 Missing name | E2-S1 | 1 |
| EC9 | E2-S3 | 1 |
| EC10 Out-of-range Potential Accounts | E2-S1 | 2 |
| EC12 Free text over 500 | E2-S3 | 4 |
| EC13 Location outside Indonesia | E2-S1 | 3 |
| EC14 Duplicate Prospect | E2-S1 | 5 |
| EC14 | E2-S3 | 6 |
| EC15 Double-tapped submit | E2-S3 | 5 |
| EC16 Second open Pipeline | E2-S4 | 2 |
| EC18 Two tabs | E2-S3 | 7 |
| EC19 Archiving with an open Pipeline | E2-S4 | 3, 4 |
| EC22 No hard delete | E2-S1 | 7 |
| EC26 Reassigning a Prospect | E2-S1 | 6 |
| EC33 GPS denied (location picker) | E2-S3 | 3 |
| EC34 Prospect with no location | E2-S2 | 3 |
| EC36 Save fails midway | E2-S3 | 7 |
| EC40 Missing or archived record by URL | E2-S1 | 7 |
| EC40 | E2-S4 | 5 |
| EC42 Customer data in free text (hint) | E2-S3 | 4 |
| EC45 Long words and badges | E2-S2 | 4 |

## E3 Pipelines (feature: planner-v1)

Outcome: every acquisition moves through the Stages of a Pipeline Template, so the BFTM knows where each one stands and what is stuck.
Release:

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E3-S1 | As an Admin, I want to manage Pipeline Templates with ordered Stages and Tasks, so that each kind of Prospect follows the right steps. | 5 | backend | E0-S3, E0-S6 | Verified |
| E3-S2 | As an Admin, I want a Pipeline Template screen in Pengaturan, so that I can edit Stages and Tasks without a developer. | 5 | frontend | E3-S1, E0-S5 | Todo |
| E3-S3 | As an Admin, I want to start a Pipeline, move it between Stages, tick Tasks and set its Outcome, so that every acquisition's state is recorded. | 8 | backend | E3-S1, E2-S1 | Verified |
| E3-S4 | As an Admin, I want a Pipeline detail screen, so that I can update a Pipeline in the field in a few taps. | 8 | frontend | E3-S3, E2-S3 | Todo |

### E3-S1 acceptance criteria
1. A Pipeline Template has a name, at least one Stage, and Stages in an explicit order. Each Stage has a name and zero or more Task names. Saving a template with no Stages is rejected with "Tambahkan minimal satu Stage." (EC3)
2. A fresh database has one default template with the Stages Identifikasi, Pendekatan, Presentasi, Negosiasi and Pembukaan Rekening, each with starter Tasks.
3. Stages and Tasks can be added, renamed, reordered and removed.
4. A template used by any Pipeline can be archived, but not deleted. A template no Pipeline uses can be deleted. (EC21)
5. An archived template cannot start a new Pipeline and can be restored. (EC21)

### E3-S2 acceptance criteria
1. Pengaturan → Pipeline Template lists templates with their Stage count and how many Pipelines use each.
2. The editor adds, renames, removes and reorders Stages and Tasks. Reordering works by touch on mobile and also with buttons (move up, move down) for keyboard users.
3. Saving a template with no Stages shows "Tambahkan minimal satu Stage." (EC3)
4. The editor says that changes apply only to new Pipelines. (EC21)
5. Archive and restore are offered. Delete is offered only for a template no Pipeline uses. (EC21)

### E3-S3 acceptance criteria
1. Starting a Pipeline copies the template's Stages and Tasks into the Pipeline, starts at the first Stage, and copies the Prospect's Funding Officer. Later template edits do not change it. (EC21)
2. Starting a Pipeline on a Prospect that has an open (or On Hold) Pipeline, or that is archived, is rejected with "Prospect ini masih punya Pipeline yang berjalan." or the matching archived message. (EC16)
3. An open Pipeline can move to any of its Stages, forward or back. The response to a forward move reports how many Tasks in the Stages it leaves behind are unticked. A Pipeline that is Won, Lost or On Hold cannot change Stage. (EC23)
4. Tasks can be ticked, unticked, given a due date and removed from one Pipeline. (EC22)
5. Outcome transitions: Open → Won requires Accounts Opened (an integer from 1 to 100,000) and a Won date that is not in the future in WIB; Open → Lost requires a reason; Open → On Hold; On Hold → Open at the same Stage; On Hold → Lost. Every other transition is rejected. (EC10, EC24, EC32)
6. Reopening a Won or Lost Pipeline clears its Outcome, Accounts Opened and Won date. It is rejected when the Prospect has another open or On Hold Pipeline. (EC25)
7. A Pipeline's Funding Officer can be changed separately from its Prospect's. (EC26)
8. Archiving a Prospect with an open or On Hold Pipeline is rejected with "Tutup atau tunda Pipeline dulu." (EC19)
9. The Prospect list (E2-S1) fills each row's `openPipeline` with the Stage name, position and Stage count of its open or On Hold Pipeline, and filters by Stage (template and Stage position) on the server. Moved here from E2-S1 #4 on 2026-11-19, because it needs Pipelines.

### E3-S4 acceptance criteria
1. The screen shows the Prospect, the Funding Officer, the current Stage as a badge, and every Stage with its Tasks, current Stage first on mobile.
2. Ticking a Task takes one tap and shows the result without a page reload. Overdue Tasks are marked "Terlambat" with a label. (EC30)
3. Moving forward with unticked Tasks shows "3 Tugas belum selesai. Tetap pindah ke Presentasi?" (Task is labelled "Tugas" in the UI, DESIGN.md) and the move happens only after confirming. (EC23)
4. Setting Won asks for Accounts Opened and the Won date. A date in the future or a count below 1 shows an inline error. Setting Lost asks for a reason, with the customer-data hint. (EC10, EC24, EC32, EC42)
5. Reopening a Won Pipeline asks for confirmation that says Realisasi for its month will go down by its Accounts Opened. (EC25)
6. Actions that the current state does not allow are not shown. (EC24)
7. The Funding Officer of the Pipeline can be changed from this screen. (EC26)

### E3 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| EC3 Template with no Stages | E3-S1 | 1 |
| EC3 | E3-S2 | 3 |
| EC10 Accounts Opened out of range | E3-S3 | 5 |
| EC10 | E3-S4 | 4 |
| EC16 Second open Pipeline | E3-S3 | 2 |
| EC19 Archiving a Prospect with an open Pipeline | E3-S3 | 8 |
| EC21 Template in use | E3-S1 | 4, 5 |
| EC21 | E3-S2 | 4, 5 |
| EC21 Pipeline copies its template | E3-S3 | 1 |
| EC22 Task removed from one Pipeline | E3-S3 | 4 |
| EC23 Moving between Stages | E3-S3 | 3 |
| EC23 | E3-S4 | 3 |
| EC24 Outcome transitions | E3-S3 | 5 |
| EC24 | E3-S4 | 4, 6 |
| EC25 Reopening | E3-S3 | 6 |
| EC25 | E3-S4 | 5 |
| EC26 Pipeline's own Funding Officer | E3-S3 | 7 |
| EC26 | E3-S4 | 7 |
| EC30 Overdue Tasks | E3-S4 | 2 |
| EC32 Won date in the future | E3-S3 | 5 |
| EC32 | E3-S4 | 4 |
| EC42 Customer data in the Lost reason | E3-S4 | 4 |

## E4 Activities and Check-ins (feature: planner-v1)

Outcome: the BFTM plans the team's field visits by day and proves each visit with a Check-in.
Release:

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E4-S1 | As an Admin, I want to schedule and cancel Activities for my Funding Officers, so that the week's field work is planned. | 5 | backend | E2-S1, E3-S3 | Todo |
| E4-S2 | As an Admin, I want a Jadwal screen and an Activity form, so that I can plan a week for the team in under 10 minutes. | 5 | frontend | E4-S1, E2-S3 | Todo |
| E4-S3 | As an Admin, I want to record a Check-in with a photo and GPS, so that every visit has proof and is marked On-site or Off-site. | 5 | backend | E4-S1 | Todo |
| E4-S4 | As an Admin, I want a Check-in screen that works on a weak connection, so that I can prove a visit in a few taps. | 5 | frontend | E4-S3, E4-S2 | Todo |

### E4-S1 acceptance criteria
1. An Activity has a Prospect (not archived), a Funding Officer (active), a date and time stored in UTC, an optional linked open Pipeline of the same Prospect, and a purpose (free text with the E0-S6 rules).
2. An Activity in the past can be created, and is Overdue from the moment it is saved. (EC28, EC30)
3. Status transitions: Scheduled → Cancelled, and Scheduled → Done only through a Check-in. Done and Cancelled are final, and any other change is rejected. (EC27)
4. The list filters by date range and Funding Officer, and returns Activities in time order with an `overdue` flag. (EC8, EC30)
5. Archiving a Prospect cancels its future Scheduled Activities and reports how many. The archive preview returns that count first. (EC19)
6. There is no endpoint that deletes an Activity. (EC22)

### E4-S2 acceptance criteria
1. Jadwal shows a day view and a week view, with Activities in time order grouped by Funding Officer, and filters by Funding Officer. Many Activities on one day extend the list; nothing is cut off. (EC8)
2. "Tambah Kegiatan" opens a form with Prospect search, Funding Officer (defaulting to the Prospect's), date, time and purpose. The time is entered and shown in WIB.
3. With no active Funding Officers or no Prospects, the form says what to add first and links to it. (EC2)
4. Overdue Activities are labelled "Terlambat", not by colour alone. (EC30)
5. The Activity detail shows status, Prospect, Funding Officer, linked Pipeline and the Check-in if there is one, and offers "Batalkan" with a confirmation for a Scheduled Activity.
6. The save button is disabled while saving, and a failed save keeps the input with a retry. (EC15, EC36)

### E4-S3 acceptance criteria
1. A Check-in needs a photo. The photo is stored in Vercel Blob first, and the Check-in is saved only after the photo is stored, so no Check-in exists without a photo. (EC38)
2. Only JPEG, PNG and WebP up to 5 MB are accepted, checked on the server by content, not by file name. Otherwise the request is rejected with a message naming the limit. (EC37)
3. With GPS within 200 m (haversine) of the Prospect's location, the Check-in is On-site. Further away, or without GPS, or when the Prospect has no location, it is Off-site. The distance and the reason are stored. (EC33, EC34, EC35)
4. GPS with an accuracy worse than 200 m is treated as no GPS, with the reason "GPS tidak akurat". (EC33)
5. A Check-in is rejected before the Activity's date in WIB, and on a Cancelled or Done Activity. (EC27, EC29)
6. Saving a Check-in marks the Activity Done in the same transaction.
7. The photo URL cannot be guessed, and the photo is served only to a signed-in Admin.

### E4-S4 acceptance criteria
1. The Check-in action appears on a Scheduled Activity only from its date in WIB onward. (EC29)
2. The Admin takes a photo with the camera or picks one from the gallery. HEIC is converted when the browser can decode it. The photo is resized on the device to 1600 px on the long edge as JPEG before upload. A photo still over 5 MB, or not an image, shows a specific message. (EC37)
3. GPS is requested with a 15-second timeout. If it is denied, slow or inaccurate, the screen shows "GPS tidak tersedia" (or the specific reason), and the Check-in can still be saved as Off-site. (EC33)
4. The upload shows progress. The save button stays disabled until it finishes. A failed upload keeps the photo and note and offers a retry. (EC15, EC36, EC38)
5. The screen says the photo must show the place or the activity, not a KTP or a passbook, and the note shows the customer-data hint. (EC42, EC43)
6. After saving, the result shows On-site or Off-site with the distance, and the Activity shows as Done.

### E4 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| EC2 No Funding Officers or Prospects yet | E4-S2 | 3 |
| EC8 Many Activities on one day | E4-S1 | 4 |
| EC8 | E4-S2 | 1 |
| EC15 Double-tapped submit | E4-S2 | 6 |
| EC15 | E4-S4 | 4 |
| EC19 Archiving cancels future Activities | E4-S1 | 5 |
| EC22 No hard delete | E4-S1 | 6 |
| EC27 Activity status changes | E4-S1 | 3 |
| EC27 | E4-S3 | 5 |
| EC28 Activity in the past | E4-S1 | 2 |
| EC29 Check-in before the Activity's day | E4-S3 | 5 |
| EC29 | E4-S4 | 1 |
| EC30 Overdue Activities | E4-S1 | 2, 4 |
| EC30 | E4-S2 | 4 |
| EC33 GPS denied, slow or inaccurate | E4-S3 | 3, 4 |
| EC33 | E4-S4 | 3 |
| EC34 Check-in for a Prospect with no location | E4-S3 | 3 |
| EC35 On-site Radius | E4-S3 | 3 |
| EC36 Save fails midway | E4-S2 | 6 |
| EC36 | E4-S4 | 4 |
| EC37 Large or wrong-format photo | E4-S3 | 2 |
| EC37 | E4-S4 | 2 |
| EC38 Slow upload, no Check-in without a photo | E4-S3 | 1 |
| EC38 | E4-S4 | 4 |
| EC42 Customer data in the Check-in note | E4-S4 | 5 |
| EC43 Photo of an identity document | E4-S4 | 5 |

## E5 Targets and dashboard (feature: planner-v1)

Outcome: the BFTM sees, for any month, Target against Actual for each Funding Officer and the team, and what needs attention.
Release:

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E5-S1 | As an Admin, I want monthly Targets and a dashboard summary computed from Won Pipelines, so that progress needs no manual totals. | 5 | backend | E3-S3, E4-S1 | Todo |
| E5-S2 | As an Admin, I want a Target screen in Pengaturan, so that I can set each Funding Officer's Target for a month. | 2 | frontend | E5-S1, E1-S2 | Todo |
| E5-S3 | As an Admin, I want a dashboard, so that I see the month's progress and what is overdue or coming up at a glance. | 5 | frontend | E5-S1, E0-S5 | Todo |

### E5-S1 acceptance criteria
1. A Target is unique per Funding Officer and month. Setting it again updates it. It accepts integers from 0 to 100,000. (EC10, EC17)
2. Actual for a month is the sum of Accounts Opened over Pipelines Won in that WIB calendar month, credited to the Pipeline's Funding Officer. A Pipeline Won at 23:30 WIB on 31 January counts in January. (EC26, EC31)
3. The team Target is the sum of the Funding Officers' Targets for the month. A Funding Officer or month with no Target reports `target: null`, not 0. (EC4)
4. The summary for a month returns, per Funding Officer and for the team: Target, Actual, and the same Actual for the previous month.
5. The summary returns Overdue Tasks (due date in WIB passed, unticked, on an open Pipeline) and Overdue Activities (time passed, still Scheduled). (EC30)
6. The summary returns today's and the next 7 days' Activities, and open Pipelines counted by Stage, grouped by template, then by Stage position and name.
7. Reopening a Won Pipeline lowers that month's Actual. (EC25)

### E5-S2 acceptance criteria
1. Pengaturan → Target shows a month picker and one row per active Funding Officer with a number input.
2. Out-of-range or decimal values show an inline error. (EC10)
3. Saving updates the existing Target rather than adding a second one. (EC17)
4. Copying last month's Targets into an empty month is not offered (not in the PRD). Each value is entered.

### E5-S3 acceptance criteria
1. The dashboard opens on the current WIB month, with a month picker.
2. Target vs Actual is shown for the team and for each Funding Officer, as a number against Target with the percentage, plus last month's Actual for comparison. No bare numbers.
3. A month with no Target shows Actual with "Target belum diatur" and a link to Pengaturan → Target, not a 0 % bar. (EC4)
4. On first use with no data, the dashboard shows the setup steps in order: add Funding Officers, set Targets, add a Prospect. (EC1)
5. Overdue Tasks and Activities are listed with a "Terlambat" label, and each one opens its Pipeline or Activity in one tap, so a Pipeline is reachable in 3 taps or fewer from the dashboard. (EC30)
6. Today's and the next 7 days' Activities, and open Pipelines by Stage, are shown. Numbers use `id-ID` grouping. (EC44)

### E5 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| EC1 First sign-in with no data | E5-S3 | 4 |
| EC4 No Target for a month | E5-S1 | 3 |
| EC4 | E5-S3 | 3 |
| EC10 Out-of-range Target | E5-S1 | 1 |
| EC10 | E5-S2 | 2 |
| EC17 Two Targets for the same month | E5-S1 | 1 |
| EC17 | E5-S2 | 3 |
| EC25 Reopening lowers Actual | E5-S1 | 7 |
| EC26 Credit follows the Pipeline's Funding Officer | E5-S1 | 2 |
| EC30 Overdue on the dashboard | E5-S1 | 5 |
| EC30 | E5-S3 | 5 |
| EC31 Month boundaries in WIB | E5-S1 | 2 |
| EC44 Number format | E5-S3 | 6 |

## E6 Prospect map (feature: planner-v1)

Outcome: the BFTM sees where the team's Prospects are and the Stage of each.
Release:

| ID | Story | Points | Owner | Depends on | Status |
|----|-------|--------|-------|------------|--------|
| E6-S1 | As an Admin, I want the map data for my Prospects with their Stage, so that the map can show them. | 2 | backend | E3-S3 | Todo |
| E6-S2 | As an Admin, I want a map of Prospects with filters and a list toggle, so that I can plan visits by area. | 5 | frontend | E6-S1, E0-S4 | Todo |

### E6-S1 acceptance criteria
1. The map endpoint returns every non-archived Prospect that has a location, with ID, name, Category, Funding Officer, and the Stage (with its position in its Pipeline) and Outcome of its latest Pipeline. Prospects with no location are excluded. (EC34)
2. It filters by Funding Officer and Stage on the server.
3. With 2,000 located Prospects, the response is under 500 KB and returns in under 500 ms. (EC6)

### E6-S2 acceptance criteria
1. Peta shows OpenStreetMap through Leaflet with attribution. Markers combine a colour with a Stage label or icon, so colour is never the only signal.
2. Markers cluster when zoomed out, and 2,000 Prospects stay responsive to pan and zoom on a mid-range phone. (EC6)
3. Filters by Funding Officer and Stage update the map.
4. Tapping a marker shows the Prospect's name, Stage and Funding Officer, with a link to its detail page.
5. On mobile, a toggle switches between the map and a list of the same Prospects.
6. With no located Prospects, the map shows the default area and says no Prospect has a location yet, with a link to the Prospect list. (EC5)

### E6 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| EC5 Map with no located Prospects | E6-S2 | 6 |
| EC6 Volume on the map | E6-S1 | 3 |
| EC6 | E6-S2 | 2 |
| EC34 Prospect with no location | E6-S1 | 1 |

### E0 edge-case trace
| Edge case (from the brief) | Story | Criterion |
|----------------------------|-------|-----------|
| EC11 Phone formats | E0-S6 | 1 |
| EC12 Free text over 500 | E0-S6 | 2 |
| EC15 Double-tapped submit | E0-S6 | 4 |
| EC18 Two tabs | E0-S6 | 5 |
| EC39 Signed out or expired session | E0-S3 | 5 |
| EC39 | E0-S5 | 1 |
| EC41 Repeated wrong passwords | E0-S3 | 4 |
| EC41 | E0-S5 | 3 |
| EC42 Customer data in free text (block) | E0-S6 | 3 |
| EC44 Numbers, dates and plurals | E0-S4 | 5 |

## Open questions

Open:

3. **Archiving a Prospect whose Pipeline is On Hold (E3-S3 #8 vs the brief's EC19).** The brief blocks archiving only while a Pipeline is open, and its message "Tutup atau tunda Pipeline dulu." offers On Hold as a way out. E3-S3 #8 also blocks On Hold, which is what is built. Asked the user on 2026-11-19.

Resolved:

1. Stage filter on the Prospect list: added to E2-S1 criterion 4. The user approved it with the designs on 2026-11-18.
2. Grouping open Pipelines by Stage across templates: grouped by template, then by Stage position and name, in E5-S1 criterion 6. The user approved it with the designs on 2026-11-18.

## Follow-ups

- **Shell and dynamic routes (from E2-S2).** `src/components/shell/bottom-nav.tsx` calls `usePathname()` outside a Suspense boundary, which blocks prerendering for routes with a dynamic segment. The placeholder `src/app/(app)/prospect/[id]/page.tsx` works around it with `export const instant = false`, and so does `src/app/(app)/prospect/[id]/ubah/page.tsx` (E2-S3). E2-S4 builds the real detail page and fixes this in the shell, so no page needs the workaround.

## Bugs

| ID | Story | Criterion | Owner | Status | Report |
|----|-------|-----------|-------|--------|--------|
| BUG-2 | E2-S3 | 1 | frontend | Verified | [QA 2026-11-19-E2-S3](qa/2026-11-19-E2-S3.md#bug-2-focus-lost-after-a-server-field-error) |
| BUG-1 | E0-S5 | 1 | frontend | Verified | [QA 2026-11-19-E0-S5](qa/2026-11-19-E0-S5.md#bug-1-open-redirect-through-dot-segments) |
