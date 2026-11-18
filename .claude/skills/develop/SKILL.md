---
name: develop
description: Use when the user runs /develop with a feature idea for BFTM Planner, or /develop with no argument to resume. Runs the full delivery lifecycle by invoking the role skills in order, from product-owner to devops, commits to a feature branch, pushes for CI and a Vercel preview, releases to production after the user confirms, and tracks progress in docs/features/.
argument-hint: "<feature idea> | <feature-slug> | (empty to resume)"
---

# Develop

The single entry point for building BFTM Planner. You act as the senior engineer who runs the lifecycle: you invoke each role skill in turn, carry its output to the next, commit and push as you go, and stop only at the gates where the user must decide.

## Start

1. **Read the ground rules:** `CLAUDE.md` (especially the Definition of Done and the git and release rules), then whichever of `docs/product/prd.md`, `GLOSSARY.md`, `DESIGN.md` and `docs/product/backlog.md` exist.
2. **Check the machine.** Confirm that `git`, `node` (22) and `npm` are available, and check whether `gh` is logged in. If `node` is missing, say so before the build phase. Planning can still go ahead without it.
3. **Decide what the argument means:**
   - **A new idea:** make a short kebab-case slug, such as `prospect-map`. Create `docs/features/<slug>.md` from the template below, with the user's words copied exactly under Request.
   - **An existing slug:** open `docs/features/<slug>.md` and resume at its `phase`.
   - **No argument:** list the features in `docs/features/` that are not at `done`. Resume the only one, or ask which to resume if there are several.
4. **Prepare git:**
   - If the repository has no commits yet, commit the project setup on `main` as `chore: project setup` and push `main`. Besides release records, this is the only commit made directly on `main`. Tell the user it happened.
   - Otherwise, if the working tree has uncommitted changes that this skill did not make, stop and ask the user what to do with them.
   - For a new feature: update `main` (`git switch main`, then `git pull --ff-only`), then run `git switch -c feature/<slug>`. To resume: `git switch feature/<slug>`.
5. **Bootstrap if needed.** If `docs/product/prd.md` or `GLOSSARY.md` is missing, run phase 0 before anything else.

## Phases

Run the phases in order. After each one, update the feature file: set `phase`, link the artifacts and add a line to the Log. That file is how a later session resumes, so keep it current.

| # | Phase | Skill | Output | Gate (stop and wait for the user) | Commit after |
|---|-------|-------|--------|-----------------------------------|--------------|
| 0 | bootstrap | product-owner (bootstrap mode) | `docs/product/prd.md`, `GLOSSARY.md` | User approves the PRD | `docs: product requirements and glossary` |
| 1 | brief | product-owner | `docs/product/briefs/<slug>.md`, with its edge cases | User approves the brief | `docs(<slug>): brief` |
| 2 | backlog | product-manager | Epic, stories and edge-case trace in `docs/product/backlog.md` | User approves the stories | `docs(<slug>): backlog` |
| 3 | architecture | software-architecture | ADRs, `docs/architecture.md` | User picks each open decision | `docs(<slug>): architecture decisions` |
| 4 | design | ui-designer | `docs/design/<story-id>.md`, and `DESIGN.md` updates | Only if `DESIGN.md` changes, or is still a draft | `docs(<slug>): screen designs` |
| 5 | build | backend, frontend, review, tester | Code, tests, `docs/product/api.md`, QA reports | Only when a story is stuck | One commit per `Verified` story, then push |
| 6 | release | devops | CI green, pull request, preview checked, production deploy | User confirms production | Release record (see Phase 6) |
| 7 | done | (this skill) | Final report | None | None |

**Skipping a phase.** Never skip architecture on the first feature, because ADR 0001 and ADR 0002 must exist before `E0-S3` is built. After that, skip architecture when the feature adds no entity, no new kind of route and no open decision. Skip design when the feature has no frontend story. Write the reason in the Log. Never skip a gate.

**Commits.** Follow the git rules in `CLAUDE.md`: Conventional Commits naming the story, files staged by path, `git status` checked first, and no secrets. After a gate, commit only once the user has approved.

## Phase 5: the build loop

Take this feature's stories in dependency order: backend before the frontend that uses it. First, take every `E0 Foundation` story that is not yet `Verified`. They belong to whichever feature runs first, and every other story depends on them. A story may start only when all its dependencies are `Verified` or `Released`. For each story:

1. **Build.** Invoke `backend` or `frontend`, according to the story's Owner. The story ends at `Done`, or at `Blocked` with a reason. A frontend story reaches `Done` only after its design review at the three viewports has passed.
2. **Review.** Review the diff for this story with the `code-review` skill. If it is not available, review the diff yourself for correctness, security, ADR 0001 and the hard rules in `CLAUDE.md`. Also run `security-review` when the story touches sign-in, uploads, or input from the user. Weigh each finding with `superpowers:receiving-code-review`: check that it is real before acting on it. Fix findings that are inside the story's scope. Record any others as open questions in the backlog.
3. **Test.** Invoke `tester` for this story. It sets `Verified`, or files a bug in the backlog's Bugs table.
4. **Fix the bugs.** Hand each bug back to the story's owner skill, then review and test again. After two failed fix attempts on the same bug, stop. Set the story to `Blocked` and report to the user.
5. **Commit and push.** When the story is `Verified`, commit its code, tests, backlog status, `api.md` changes and QA report together: `feat(<story-id>): <what it does>`, or `fix(BUG-<n>): ...` for a bug. Push the feature branch. CI and a Vercel preview start on every push.
6. **Watch CI.** If `gh` is available, check the run for this push (`gh run list --branch feature/<slug> --limit 1`, then `gh run watch`). If CI fails on something that passed locally, treat it as a bug in this story and go back to step 4. Do not start the next story on a red build.

The phase ends when every story in the feature is `Verified` and CI is green on the latest push.

**Large features.** When a feature has more than about six stories, run each story's build in a subagent, with the story ID, the relevant skill and the paths it needs. This keeps the main conversation small. Run the review, the test and the commit in the main conversation.

## Phase 6: release

Invoke `devops`. It:

1. confirms that CI is green on the feature branch
2. opens a pull request into `main` (`gh pr create`), with the stories, the QA reports and the preview URL in the body. Without `gh`, it gives the user the compare link.
3. checks the Vercel preview of the branch: the pages load, sign-in works, and the feature's main flow works at a mobile and a desktop width
4. **gate:** shows the user the PR, the preview URL and the check results, and asks whether to release to production
5. on a yes: merges the PR (`gh pr merge --merge --delete-branch`). Vercel then builds `main` and runs the migrations for production.
6. checks production the same way as the preview
7. records the release: it sets the feature's stories to `Released`, fills in the epic's Release line in the backlog, adds an entry to `docs/ops/deploy.md`, and sets the feature file's phase to `done`. It commits these docs to `main` as `docs(<slug>): release record` and pushes. This docs-only commit is the one other allowed direct commit to `main`. Vercel skips building it, because `vercel.json` ignores docs-only changes.

If the production check fails, devops rolls back to the previous deployment in Vercel, records it, and reports. The feature goes back to phase 5 with a bug.

## Gates

At a gate, show the user what was produced: a summary of its key points and its file path. Ask one clear question, then stop. Do not start the next phase in the same turn. When the user replies, record the decision in the feature file's Log, commit as the table says, and continue.

Everything that is not a gate runs without asking. If a role skill tells you to "hand off" or to "tell the user the next step", treat that as returning control to this skill.

## Stop and ask, instead of guessing, when

- the request conflicts with the PRD or a hard rule in `CLAUDE.md`, for example a new role, Telegram, or individual customer data
- two sources of truth disagree and the PRD does not settle it
- a check fails and the cause is outside the current story
- git is in an unexpected state: a merge conflict, a rejected push, or a branch that has moved on the remote

Set the feature's `phase` to `blocked`, write the reason under "Blocked on", and report.

## Feature file template

```markdown
---
feature: <slug>
title: <short title>
phase: brief
branch: feature/<slug>
started: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

# <title>

## Request

<the user's words, unedited>

## Artifacts

- Brief:
- Epic and stories:
- ADRs:
- Designs:
- QA reports:
- Pull request:
- Preview URL:
- Production release:

## Log

- <YYYY-MM-DD> <phase>: <what happened, decisions taken at gates>

## Blocked on

(none)
```

## Final report

When the phase is `done`, tell the user:

- what was built, story by story, with each story's status
- the pull request, the preview URL and the production URL
- the decisions they made at the gates
- any open questions, follow-up stories or limits that were found

## Companion skills and precedence

Plugins add discipline inside the phases. They never replace a phase or a gate.

| Phase | Companion skill |
|-------|-----------------|
| design | `frontend-design:frontend-design` (through ui-designer) |
| build | `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion` (through backend, frontend and tester) |
| review | `code-review`, `security-review`, `superpowers:receiving-code-review` |
| release | `security-review`, the `vercel:*` skills (through devops) |
| always | `security-guidance` runs on its own: it warns when an edit introduces a risky pattern |

While `/develop` runs, do not invoke `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:executing-plans`, `superpowers:subagent-driven-development` or `superpowers:finishing-a-development-branch`. Phases 0 to 4 already do the brainstorming and planning, the backlog is the plan, and phase 6 is the branch finish. Running those skills too would add a second spec, a second plan and a second set of gates.
