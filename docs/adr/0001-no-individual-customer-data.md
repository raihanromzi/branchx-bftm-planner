---
status: accepted
date: 2026-11-18
---

# ADR 0001: No individual customer data

## Context

BFTM Planner is a prototype hosted outside bank infrastructure, on Vercel and Neon. Bank customer data (account holders' identities and accounts) must not leave bank systems. The app's purpose is planning acquisition at the level of institutions and venues, which does not need any data about individual account holders.

## Decision

The app stores no individual customer data. No table, column, file or log holds an account holder's name, NIK, account number or balance.

It stores only:

- Prospects at institution or venue level (a school, a market, a company, an office, a community)
- one minimal Contact Person per Prospect: name, role and phone
- account counts: Potential Accounts, Accounts Opened and Targets
- Funding Officers (the team's own staff) and the Admin

Free-text fields are the main leak risk, so the app reduces it:

- every free-text field is capped at 500 characters and shows a hint not to enter an account holder's name, NIK or account number
- the server rejects free text with a 16-digit run (the NIK pattern) or a 10+-digit run that is not a valid phone number
- the Check-in screen tells the Admin to photograph the place or the activity, not an identity document or passbook

## Consequences

- Reports by account holder, and any feature that needs account-level data, cannot be built in this app. Such work belongs inside bank systems.
- Accounts Opened is a count entered by hand. It cannot be reconciled automatically with core banking.
- A schema change, story or design that adds an account-holder field must be rejected in review. Changing this ADR needs a new ADR and a change to `CLAUDE.md`'s hard rules.
- The digit-run check can reject a legitimate long number in a note. The error message explains why, and the user can rephrase.
