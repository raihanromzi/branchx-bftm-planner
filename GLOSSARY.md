# Glossary

The domain terms for BFTM Planner. Use them in code, tests, UI copy and commit messages. The UI uses the English term where it is shown here in code font; otherwise use the Bahasa Indonesia label given.

**Admin**
The only signed-in role in v1. In practice the BFTM. Has full access.
_Avoid:_ user, superuser.

**BFTM**
The person who leads a team of Funding Officers and plans their field acquisition. The Admin of the app in v1.

**Funding Officer**
A member of the BFTM's team who does field acquisition. In v1, a record with a name and phone number that work is assigned to. Does not sign in. Can be deactivated.
_Avoid:_ FO (in UI copy), agent, salesperson.

**Prospect**
An institution or venue that the team wants to open accounts with, such as a school, a market, a company, a government office or a community. Never an individual account holder.
_Avoid:_ customer, lead, client, nasabah.

**Category**
The kind of Prospect: Sekolah, Pasar, Perusahaan, Instansi, Komunitas or Lainnya.

**Contact Person**
The one person at a Prospect the team talks to: name, role and phone. Not an account holder.
_Avoid:_ PIC (in code), customer.

**Potential Accounts**
The estimated number of accounts a Prospect could open. An integer of 0 or more. UI: "Potensi rekening".

**Pipeline**
One acquisition attempt with one Prospect, moving through ordered Stages until it has an Outcome. A Prospect has at most one open Pipeline at a time.
_Avoid:_ deal, opportunity.

**Pipeline Template**
A reusable, ordered list of Stages, each with its Task checklist. A Pipeline is started from one.

**Stage**
One step in a Pipeline, such as "Presentasi". Its order comes from the Pipeline Template.
_Avoid:_ phase, step (in code).

**Task**
A checklist item inside a Stage, such as "Kirim proposal". It can be ticked off and can have a due date.
_Avoid:_ todo.

**Outcome**
How a Pipeline ended or paused: Won, Lost or On Hold. An open Pipeline has no Outcome. UI: "Berhasil", "Gagal", "Ditunda".

**Accounts Opened**
The number of accounts opened when a Pipeline is Won. It counts towards Actual in the month of the Won date.
_Avoid:_ conversions.

**Activity**
A scheduled field visit or meeting with a Prospect, assigned to a Funding Officer, optionally linked to a Pipeline. Status: Scheduled, Done or Cancelled. UI: "Kegiatan".
_Avoid:_ event, appointment.

**Overdue**
A Task past its due date that is not ticked, or an Activity whose time has passed while it is still Scheduled. UI: "Terlambat".

**Check-in**
Proof that an Activity happened: a required photo, the device's GPS if available, and a note. It marks the Activity Done.
_Avoid:_ attendance, absen (in code).

**On-site / Off-site**
Whether a Check-in's GPS lies within the On-site Radius of the Prospect's location. A Check-in without GPS, or for a Prospect with no location, is Off-site.

**On-site Radius**
The distance from the Prospect's location within which a Check-in counts as On-site.

**Target**
The number of new accounts set for a Funding Officer for a calendar month. The team Target is the sum over Funding Officers.
_Avoid:_ quota, KPI.

**Actual**
The sum of Accounts Opened on Pipelines Won in a month, per Funding Officer and for the team.
_Avoid:_ realisasi (in code). UI: "Realisasi".
