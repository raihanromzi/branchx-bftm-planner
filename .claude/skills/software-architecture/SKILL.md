---
name: software-architecture
description: Use when BFTM Planner needs architecture decisions or a design before building: module boundaries, data model, API shape, or a choice between technical options, recorded as ADRs in docs/adr/ and summarized in docs/architecture.md.
---

# Software Architecture

Design how BFTM Planner is built, and record each decision that has lasting consequences. Run this after the stories exist and before backend and frontend work starts.

## Before you start

Read `CLAUDE.md`, `docs/product/prd.md`, `docs/product/backlog.md`, `GLOSSARY.md`, `docs/architecture.md` (if it exists) and every file in `docs/adr/`. The stack in `CLAUDE.md` is the default. Change it only through a new ADR.

## Foundation ADRs

Before anything else, check that these ADRs exist:

- **ADR 0001, no individual customer data.** If it is missing, write it from the hard rule in `CLAUDE.md`, with `status: accepted`. It is not open for discussion.
- **ADR 0002, how the Admin signs in.** Telegram is out of v1. If this ADR is missing, raise it with options before any sign-in story is built.

## Steps

1. **Map the stories to the system.** For the feature's stories, list the entities each one reads and writes, the routes or services it needs, and what it depends on.
2. **Design the data model.** Use glossary terms for entity names. Show relations between Prospect, Pipeline, Stage, Task, Activity and Check-in, as far as the PRD uses them. Store institution-level data only.
3. **Design the API shape** at the level of resources and operations. Leave exact request and response bodies to the backend skill, which writes them to `docs/product/api.md`.
4. **Define module boundaries.** Name the modules, what each one owns, and which may call which. Keep the dependency direction one way.
5. **List the decisions that need a choice.** For each, write two or three real options with trade-offs, then recommend one. Ask the user to pick. Do not pick silently.
6. **Record each confirmed decision as an ADR.** Use the next free number in `docs/adr/`, in the form `NNNN-short-title.md`. Front matter: `status: accepted`. Sections: Context, Decision, Consequences.
7. **Update `docs/architecture.md`.** Cover the module map, data model, API shape and deployment shape, at most one page each. Add a text diagram where it helps. Change only the parts the feature affects.
8. **Hand off.** If `/develop` is running, return to it. Otherwise tell the user which stories the backend skill can start now, and which are blocked on an open decision.

## Rules

- Do not change the PRD's scope. If the architecture needs a feature the PRD does not contain, raise it.
- Each ADR covers one decision.
- Do not write application code in this skill.
