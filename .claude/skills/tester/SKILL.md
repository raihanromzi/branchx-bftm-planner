---
name: tester
description: Use when frontend or backend stories or bugs in docs/product/backlog.md are Done, to verify their acceptance criteria with automated tests and mark them Verified or file bugs for BFTM Planner.
---

# Tester

Verify stories and bugs that are `Done`. Mark each one `Verified` only when every acceptance criterion passes. Otherwise file bugs.

## Before you start

Read `CLAUDE.md`, `docs/product/backlog.md`, `docs/product/api.md`, `docs/product/prd.md` and, for frontend stories, `docs/design/<story-id>.md`. Verify against the acceptance criteria and the PRD. Do not verify against the code alone.

## Steps

1. **Collect the work.** Take the story you were given. Otherwise, take every story and bug at `Done`. Skip those already `Verified`.
2. **Map criteria to tests.** For each acceptance criterion, decide the test level:
   - Backend logic, validation and authorization: unit or integration tests (Vitest), against the API contract in `api.md`.
   - User flows and screens: end-to-end tests (Playwright) in a browser. They run on all three viewport projects (`mobile`, `tablet`, `desktop`).
   - Each criterion needs at least one test that could fail. A test that always passes does not count.
   - Criteria that come from the brief's edge cases (see the epic's edge-case trace) get tests like any other criterion. Do not skip them.
3. **Write the tests**, one file per story ID:
   - Vitest: `tests/unit/<story-id>.test.ts`
   - Playwright: `tests/e2e/<story-id>.spec.ts`
   Use synthetic data only: fictional Prospect names and account counts. Never use real customer data.
4. **Check the responsive rules** for every frontend story, on every viewport project:
   - no horizontal page scroll (`document.documentElement.scrollWidth <= window.innerWidth`)
   - the primary action is visible and can be tapped
   - interactive elements are at least 44 × 44 px on `mobile` and `tablet`
   - the longest realistic content does not overflow its container
   Put shared helpers in `tests/e2e/support/`.
5. **Run the tests.** Use the test commands in `CLAUDE.md`. Record the commands and their results.
6. **Decide each story:**
   - All criteria and responsive checks pass, and the rest of the Definition of Done in `CLAUDE.md` holds: set the story to `Verified`.
   - Any criterion fails: leave it `Done`, and add a row to the Bugs table in the backlog. Give it the next ID `BUG-<n>`, the story ID, the criterion, the owner (`frontend` or `backend`), status `Todo`, and a link to the QA report.
   - A criterion cannot be tested: say why, and leave the story `Done`.
   - A fixed bug passes: set the bug to `Verified`. When the story has no open bugs and all its criteria pass, set the story to `Verified`.
7. **Write the QA report** to `docs/product/qa/<YYYY-MM-DD>-<story-id>.md`. List the result of each criterion and each responsive check per viewport, the commands run, and the bugs found.
8. **Report** the stories verified, the stories failing, and what is blocked. If `/develop` is running, return to it.

## Bug entries

In the QA report, each bug names the story ID, the criterion it breaks, the steps to reproduce, the expected result and the actual result.

## Companion skills

Use these if they are installed.

- `superpowers:verification-before-completion`: never set `Verified` without the test output in front of you.
- `superpowers:systematic-debugging`: when a criterion fails, trace the likely cause and put it in the bug entry. Diagnose only: the fix belongs to the owner skill.

## Rules

- Never change production code to make a test pass. Report the failure.
- Never edit an acceptance criterion to match what was built. If a criterion looks wrong, raise it with the user.
- Never set `Verified` without running the tests.
- Keep test data synthetic. Respect ADR 0001.
