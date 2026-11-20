---
name: frontend
description: Use when implementing frontend stories or frontend bugs from docs/product/backlog.md for BFTM Planner: Next.js App Router pages and components, shadcn/ui, Leaflet maps, and responsive or PWA UI in Bahasa Indonesia, checked by screenshot at mobile, tablet and desktop widths.
---

# Frontend

Implement the frontend stories in `docs/product/backlog.md`. Work one story at a time.

## Before you start

Read `CLAUDE.md`, `DESIGN.md`, `docs/product/prd.md`, `GLOSSARY.md`, `docs/product/api.md` and the story's design in `docs/design/<story-id>.md`. Use only endpoints that appear in `api.md`. If a story needs an endpoint that does not exist, stop and report it. Do not invent one. If the story has no design file, ask for the ui-designer skill to run first.

## Steps

1. **Pick the work.** Take the story you were given. Otherwise, take an open frontend bug from the Bugs table first, then a frontend story at `Todo` whose dependencies are all `Verified` or `Released`. Set it to `In progress`.
2. **Read the project's conventions** first: folder layout, components, styling and data-fetching patterns. Match them.
3. **Build the story** in small steps:
   - Restate its acceptance criteria.
   - Build the layout first, then the states (empty, loading, error), then the interactions, as the design file describes them.
   - Use the copy from the design file. All UI text is in Bahasa Indonesia and uses glossary terms.
   - Build the edge cases the design file shows: GPS denied, a failed upload, a duplicate warning, and so on.
   - Use the tokens and components named in `DESIGN.md`. Do not hard-code colours, spacing, radius or font.
   - Build mobile first, then add the tablet and desktop layouts from the design file. Make it installable as a PWA where the PRD asks.
4. **Smoke-check** the story by running the app or a quick test against its main flow. This is not the full design review — just enough to catch an obviously broken build before moving to the next story in the batch.
5. **Mark the work `Done`** in the backlog once the smoke check passes. For a bug, set its row in the Bugs table to `Done`. The design review (step 5 below) and the full test run happen once, after every story in the batch reaches `Done`.
6. **When the batch is complete** (every story built), run the design review once per screen: with the dev server running, capture screenshots with Playwright at the `mobile`, `tablet` and `desktop` viewports. Cover the normal state with the longest realistic content; add empty, loading or error states only where they are visually distinct or risky. Save them to `test-results/screens/<story-id>/`, which is git-ignored. Open every screenshot and go through the design review checklist in `DESIGN.md`. Fix each failure, take the screenshots again, and repeat until every item passes.
7. **Run the local checks once for the batch:** `npm run lint`, `npm run typecheck`, and the tests for the batch's stories.
8. **Report** the stories completed, the stories blocked, any criterion you could not check, and the design review result. If `/develop` is running, return to it.

## Stack

- Next.js App Router with TypeScript
- shadcn/ui for components
- Leaflet with OpenStreetMap (react-leaflet) for maps

## Companion skills

Use these if they are installed. This skill's steps, the design file, `DESIGN.md` and `CLAUDE.md` win where they disagree.

- `frontend-design:frontend-design`: for visual polish within the tokens and patterns in `DESIGN.md`. It does not override them.

## Rules

- Do not change backend contracts.
- Do not skip acceptance criteria or the design review to finish faster.
- If the design file itself breaks a rule in `DESIGN.md`, do not quietly build something different. Report it, so the ui-designer can fix the design.
- Keep changes scoped to the story.
