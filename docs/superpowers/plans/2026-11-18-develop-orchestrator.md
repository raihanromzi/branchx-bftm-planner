# `/develop` Orchestrator Implementation Plan

> **Superseded.** Implemented differently in `skills/develop/SKILL.md`. See the status note in the spec. Do not execute this plan.

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Execution method is not yet chosen (see end).

**Goal:** Add a `develop` skill that takes a feature idea and runs the delivery stages in `CLAUDE.md` through the existing role skills, pausing at four gates and recording progress in a per-feature state file.

**Architecture:** One orchestrator skill (`skills/develop/SKILL.md`) that sequences the role skills and reads/writes `docs/features/<feature-id>.md`. The role skills are not modified. A markdown template gives the state file its shape.

**Tech Stack:** Markdown skill files with YAML frontmatter. No application code. Verification by shell checks (no test runner exists yet: no `package.json`).

**Spec:** `docs/superpowers/specs/2026-11-18-develop-orchestrator-design.md`

## Global Constraints

- No product code, no PRD or GLOSSARY content invented. Stage 0 must stop if those files are missing.
- Do not set a story to `Verified` anywhere except in the tester's skill flow.
- Do not deploy to production without explicit user confirmation in the conversation (gate G4).
- No git commit or push (`CLAUDE.md`).
- UI text Bahasa Indonesia; skill and docs text English.

## Review Focus

1. **Missing prerequisites:** `prd.md` or `GLOSSARY.md` absent at intake. Expected: stop and ask, never generate them. Covered by Task 1 check.
2. **Silent gate pass:** user says "looks fine" or stays silent. Expected: no advance without an explicit approve. Covered by Task 1 check.
3. **Unbounded retry:** a failing story loops forever. Expected: at most two retries, then stop and ask. Covered by Task 1 check.
4. **Resume mid-stage:** a second `/develop <feature-id>` repeats finished stages. Expected: state file read first; completed stages skipped. Covered by Task 2 check.
5. **Unconfirmed production deploy:** devops reached without G4. Expected: stop at G4. Covered by Task 1 check.

## File Structure

- Create: `skills/develop/SKILL.md`. Orchestration rules: intake, stage order, gates, failure handling, resume.
- Create: `skills/develop/feature-state-template.md`. Empty state file: header, idea, one row per stage, open questions, story links.

## Task 1: Orchestrator skill

**Files:**
- Create: `skills/develop/SKILL.md`

**Interfaces:**
- Consumes: the eight role skills by name (`product-owner`, `product-manager`, `software-architecture`, `ui-designer`, `backend`, `frontend`, `tester`, `devops`), invoked in the order in the spec's table.
- Produces: `docs/features/<feature-id>.md` written and updated at each stage and gate.

- [ ] **Step 1: Write the review checks as a grep script**

Save as `/tmp/check-develop.sh` (not in the repo):

```bash
#!/bin/sh
f="skills/develop/SKILL.md"
test -f "$f" || { echo "FAIL: missing $f"; exit 1; }
grep -q '^name: develop$' "$f" || { echo "FAIL: frontmatter name"; exit 1; }
for s in product-owner product-manager software-architecture ui-designer backend frontend tester devops; do
  grep -q "$s" "$f" || { echo "FAIL: no reference to $s"; exit 1; }
done
grep -qi 'never generate\|do not generate\|stop and ask' "$f" || { echo "FAIL: missing-prerequisite rule"; exit 1; }
grep -qi 'explicit.*approve' "$f" || { echo "FAIL: gate approval rule"; exit 1; }
grep -qi 'two retries\|at most two' "$f" || { echo "FAIL: retry bound"; exit 1; }
grep -qi 'production.*confirm' "$f" || { echo "FAIL: production confirmation gate"; exit 1; }
grep -qi 'never.*Verified\|only the tester' "$f" || { echo "FAIL: Verified rule"; exit 1; }
echo "PASS"
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `sh /tmp/check-develop.sh`
Expected: `FAIL: missing skills/develop/SKILL.md`

- [ ] **Step 3: Write `skills/develop/SKILL.md`**

Frontmatter: `name: develop`, and a `description` that says when to use it (a raw feature idea to take through the full delivery workflow, or resume a feature by ID). Body sections, in order: Before you start (read `CLAUDE.md`; check `prd.md` and `GLOSSARY.md` exist, stop if not); Stages (the table from the spec, section 7.2, reproduced as the stage order with each gate); Gates (the four gates and the gate protocol from spec section 7.6, with the explicit-approve rule); Failure handling (spec section 7.4, retry limit of two); Resume (read the state file first); Rules (no `Verified` except by the tester, production only after G4, no commit or push).

- [ ] **Step 4: Run the check to verify it passes**

Run: `sh /tmp/check-develop.sh`
Expected: `PASS`

- [ ] **Step 5: Hand-check the stage order**

Run: `grep -n 'product-owner\|product-manager\|software-architecture\|ui-designer\|backend\|frontend\|tester\|devops' skills/develop/SKILL.md`
Expected: the eight names appear in the spec's order (product-owner, product-manager, software-architecture, ui-designer, backend, frontend, tester, devops), with G1 to G4 placed as the spec's table places them.

## Task 2: State file template

**Files:**
- Create: `skills/develop/feature-state-template.md`

**Interfaces:**
- Consumes: nothing from Task 1 except the stage names.
- Produces: the blank template the orchestrator copies to `docs/features/<feature-id>.md` at intake.

- [ ] **Step 1: Write the failing check**

Run: `test -f skills/develop/feature-state-template.md && echo PASS || echo FAIL`
Expected: `FAIL`

- [ ] **Step 2: Write the template**

Sections: `# <feature-id>`; `Idea (as written by user)`; `Stage table` with columns Stage, Skill, Status (`pending` / `in progress` / `waiting for gate` / `done` / `blocked`), Artifacts, Gate decision and date; `Open questions`; `Stories` with columns ID, Owner, Status. Ten stage rows, matching spec section 7.2 (intake through production deploy).

- [ ] **Step 3: Verify**

Run: `grep -c '^|' skills/develop/feature-state-template.md`
Expected: at least 12 table rows (header, separator, and 10 stages), and the file contains `G1`, `G2`, `G3`, `G4`.

## Task 3: Cross-check against the spec

- [ ] **Step 1:** Re-read spec sections 7.2 to 7.6 against the two files. Each stage, gate, retry rule and state-file field must appear once.
- [ ] **Step 2:** Confirm no file outside `skills/develop/` changed: `git status` is not available (no commits yet), so list `skills/` and `CLAUDE.md` modification times against the plan start.

## Execution method

Not yet chosen. Two options:

- **Native:** I write both files in this session, then run the checks. One reviewer pass on the result. Cheapest; the work is two markdown files.
- **Subagent-driven:** a fresh subagent per task with review. Costs more and adds little for two files.

I recommend **Native**: the tasks are small, and the spec and plan carry the design.

Do you want Native, or a different method?
