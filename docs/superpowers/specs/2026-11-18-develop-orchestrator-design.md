# `/develop` orchestrator: design

Status: **superseded**. `skills/develop/SKILL.md` and `CLAUDE.md` are the current design. What changed from this draft: a missing PRD or glossary now triggers a bootstrap phase (product-owner writes them with the user) instead of stopping; each feature gets its own brief in `docs/product/briefs/<slug>.md`; the role skills were updated to close gaps (E0 Foundation epic, story IDs, a Bugs table and fix loop, a code-review step, `DESIGN.md`, handoffs back to `/develop`); and open question 1 is resolved by the bootstrap phase.
Date: 2026-11-18
Repo: branchx-bftm-planner

## 1. Intent

One command, `/develop <feature idea>`, takes a raw feature idea and drives it through the delivery workflow in `CLAUDE.md`, using the existing role skills in `skills/`. The command runs each stage itself and stops at four approval gates. The user never has to remember which skill comes next.

Why: the role skills already exist and hand off to each other in prose. What is missing is the sequencing, a place that records where a feature is, and the gates that keep the user in control.

## 2. Goals

- One entry point, `/develop`, for the full lifecycle of one feature.
- Reuse the eight role skills as they are. Their responsibilities do not change.
- Stop at exactly these gates, each waiting for an explicit user answer:
  1. the product brief (`docs/product/brief.md`)
  2. the backlog (`docs/product/backlog.md`)
  3. each architecture decision that needs a choice
  4. before any production deploy
- Keep a per-feature state file, so progress is visible and a stopped run can resume.
- Follow every hard rule in `CLAUDE.md`.

## 3. Non-goals

- No Telegram, bot, digest, or reminder code (v1 rule).
- No multi-role access. Admin only.
- No offline sync.
- No automatic commit or push. `CLAUDE.md` says commit only when the user asks.
- No new product scope. The orchestrator plans nothing the PRD does not contain.

## 4. Anti-goals (a run that does these has failed, even if it finished)

- Setting a story to `Verified` anywhere except the tester.
- Deploying to production without the user's confirmation in the conversation.
- Continuing past a failed gate, a failed build, or failing tests.
- Inventing an endpoint, a role, or a metric to unblock a story.
- Silently picking an architecture option that the user should choose.

## 5. Constraints

- The stack and rules in `CLAUDE.md` are fixed (Next.js, shadcn/ui, Postgres on Neon with Drizzle, Vercel Blob, Leaflet, Vercel Hobby). Changing them needs an ADR.
- UI text is Bahasa Indonesia. Code and docs are English.
- ADR 0001 forbids individual customer data.
- The repo currently has no `prd.md`, `GLOSSARY.md`, `backlog.md`, `api.md`, or ADRs. See Open questions.

## 6. Approaches considered

1. **Chosen: an orchestrator skill (`develop`) that calls the role skills in order, and a per-feature state file.** It keeps the role skills unchanged. The state file supports resume. Gates are ordinary conversation turns, which suits this work.
2. Rejected: a static slash-command file that lists the steps. It has no state, cannot resume, and cannot tell whether a gate was passed.
3. Rejected: an external script that runs the skills. The skills are prompts that need a conversation for gates and clarifying questions, so a script adds a second system to maintain for no gain.

## 7. Design

### 7.1 Command and location

- Skill name `develop`, at `skills/develop/SKILL.md`. Invoked as `/develop`. Follows the same one-folder-per-skill layout as the other roles.
- Per-feature state file at `docs/features/<feature-id>.md`, where `<feature-id>` is a short kebab-case slug chosen at intake (my call; a slug is easier to scan than a number).

### 7.2 Pipeline

| # | Stage | Skill | Reads | Writes | Gate after |
|---|-------|-------|-------|--------|-----------|
| 0 | Intake | (orchestrator) | `prd.md`, `GLOSSARY.md`, the idea | state file | none. Stops if a prerequisite is missing. |
| 1 | Brief | product-owner | `prd.md`, `GLOSSARY.md`, idea | `docs/product/brief.md` | **G1: user approves brief** |
| 2 | Backlog | product-manager | brief | `docs/product/backlog.md` | **G2: user approves backlog** |
| 3 | Architecture | software-architecture | backlog, ADRs | `docs/adr/NNNN-*.md`, `docs/architecture.md` | **G3: user picks each new decision** (skipped if no new decision) |
| 4 | UI design | ui-designer | backlog, PRD section 5 | `docs/design/<story-id>.md` for each frontend story | none. Reported at end. |
| 5 | Backend | backend | backlog, ADRs | code, `docs/product/api.md`, story to `Done` | none. Stories in dependency order. |
| 6 | Frontend | frontend | backlog, `api.md`, `docs/design/` | code, story to `Done` | none. Only after its backend dependencies are `Done`. |
| 7 | Verify | tester | `Done` stories | `tests/`, `docs/product/qa/`, story to `Verified` or bug | none. Runs after each story reaches `Done`. |
| 8 | Preview deploy | devops | `Verified` work | `docs/ops/deploy.md`, preview URL | none |
| 9 | Production deploy | devops | preview result | production URL | **G4: user confirms production deploy** |

Stage 4 has no gate because the user asked for gates only at the four points above. The orchestrator reports the design files at the end so the user can review them.

### 7.3 Ordering rules

- Backend stories run before the frontend stories that depend on them, as `CLAUDE.md` requires.
- Within a stage, stories run one at a time.
- The tester runs on a story as soon as it is `Done`. It does not wait for the whole feature.

### 7.4 Failure handling

- A story whose tests fail goes back to the role that owns it (backend or frontend). The orchestrator retries that story at most twice. After that it stops and asks the user.
- Stop immediately, and report, when:
  - a build, lint, or test command fails (devops rule and CLAUDE.md working rule)
  - a frontend story needs an endpoint missing from `api.md`
  - an acceptance criterion cannot be tested
  - a prerequisite file is missing
  - a gate is rejected
- Stopping never means deleting or rewriting finished work.

### 7.5 State file

`docs/features/<feature-id>.md` holds:

- the original idea, as the user wrote it
- one row per stage: status (`pending`, `in progress`, `waiting for gate`, `done`, `blocked`), artifact paths, and gate decision with date
- the list of open questions, copied from the brief and backlog
- a link to each story and its current status

The orchestrator reads this file first when resumed, so a second `/develop <feature-id>` continues where the last one stopped.

### 7.6 Gate behaviour

At each gate the orchestrator:

1. states what was produced, with the file path
2. lists the decisions it made on the user's behalf, marked as its calls
3. asks for one of: approve, change (with what), or stop
4. writes the answer and the date to the state file before continuing

It does not continue on silence or on "looks fine" without a clear approve.

### 7.7 Calls I made (for your check)

- Skill name `develop`, invoked as `/develop`.
- State files in `docs/features/`, one per feature.
- Stage 4 (UI design) has no gate.
- The tester runs per story, not per feature, as `CLAUDE.md` describes.
- Retry limit of two for a failing story.
- Design doc in `docs/superpowers/specs/`, not committed. Move it if you prefer another place.

## 8. What is left to the builder

- Exact wording of each gate prompt.
- The table layout inside the state file.
- How the orchestrator detects that a stage's artifacts already exist when resuming.

## 9. Open questions

1. **Where are `docs/product/prd.md`, `GLOSSARY.md`, `docs/design-summary.md`, and `docs/adr/0001-*.md`?** `CLAUDE.md` treats them as the source of truth, but they are not in the repo. Stage 0 will stop until they exist. If they are on another machine or in another folder, tell me where, or paste them in. If they do not exist yet, the first feature will need to start from the product-owner with no PRD, which changes the plan.

## 10. Builder check (done by reading as the builder)

- Stage 0 needs the PRD files. Open question 1.
- Stage 3 needs ADR 0002 (how the Admin signs in). The architecture skill already says to raise it first. No change needed in this design.
- `CLAUDE.md` lists five roles in its delivery order. This design adds `software-architecture`, `ui-designer` and `devops`. `CLAUDE.md` should be updated to match. That is a change to your file, so it is not made here.
- `CLAUDE.md` folder map must gain `docs/features/`, `docs/architecture.md`, `docs/design/` and `docs/ops/`. Same note as above.
