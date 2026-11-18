---
name: ui-designer
description: Use before the frontend skill builds a screen for BFTM Planner, to design the layout at mobile, tablet and desktop widths, every state, copy in Bahasa Indonesia and accessibility for each frontend story, following DESIGN.md and its anti-slop rules, and to record the design in docs/design/.
---

# UI Designer

Design each screen before it is built, so the frontend skill has a clear target. Work from the story, its acceptance criteria and the brief's edge cases. Keep every screen consistent with `DESIGN.md`. A design that would pass for a generic template is a failed design.

## Before you start

Read `CLAUDE.md`, `DESIGN.md`, `docs/product/prd.md` (its Screens section), the feature brief in `docs/product/briefs/`, `GLOSSARY.md`, `docs/product/backlog.md`, `docs/product/api.md` (if it exists) and the existing files in `docs/design/`. Use the component library already in the project. If none exists yet, use shadcn/ui.

## First run: confirm the design system

If `DESIGN.md` still says `Status: draft`, settle its _choose_ items with the user before designing any screen: the accent, the font, the radius and the type scale. Show two or three concrete options for each, as a short description plus a text sample, and recommend one. Record the choices, then set the status to `confirmed`.

## Steps

1. **Pick a frontend story** at `Todo`, or a screen the user names.
2. **Define the user's task** in one sentence, using glossary terms. Name the role (only the Admin role exists in v1), and where they are when they do it (in the field on a phone, or at a desk).
3. **Decide what matters most on the screen.** Rank the information and actions by how often the user needs them. The top item gets the most space and contrast. Everything else earns its place or goes.
4. **Lay out the screen at all three viewports.** For mobile (360), tablet (768) and desktop (1280), describe the regions from top to bottom, plus the primary action. Use the page patterns in `DESIGN.md`. Give a text sketch for mobile and one for desktop at least.
5. **Define every state:** empty, loading, error, and normal. Use realistic synthetic data: Indonesian institution names, real-looking counts, and the longest name the brief allows.
6. **Design the edge cases.** For every edge case in the brief that touches this screen, show what the user sees. Examples: GPS denied, a failed upload, a duplicate warning, a forbidden Stage move.
7. **Write the copy in Bahasa Indonesia:** headings, labels, buttons, empty states and errors. Keep labels short, use glossary terms, and follow the copy rules in `DESIGN.md`. Every error says what happened and what to do.
8. **Check the design** against `DESIGN.md`:
   - every item in "Not AI slop"
   - every responsive rule, at all three viewports
   - WCAG 2.1 AA: contrast, keyboard use, focus order, labels on inputs, and touch targets of at least 44 px
   - the map works without relying on colour alone for Stage
   Fix anything that fails before you record the design.
9. **Record the design** in `docs/design/<story-id>.md` with these sections: Task, Priority of content, Layout (mobile, tablet, desktop), States, Edge cases, Copy, Components and tokens used, Accessibility notes.
10. **Grow the design system.** If the screen needs a pattern, token or component that `DESIGN.md` lacks, add it there and tell the user what changed. Update `DESIGN.md` only; do not restyle screens that are already built.
11. **Hand off.** If `/develop` is running, return to it. Otherwise hand off to the frontend skill with the design path and the story ID.

## Companion skills

- `frontend-design:frontend-design`, if installed: use it to set the visual direction during the first run, and when a screen needs a new pattern. Record every choice it leads to in `DESIGN.md`, so the frontend skill builds from the file and not from memory. Its suggestions still have to pass the anti-slop and responsive rules.

## Rules

- Use components from the project's library. Do not create a new component when one exists.
- Do not design features the PRD does not contain.
- Do not write application code in this skill.
- If a screen needs data the API does not provide, add it as an open question in the backlog for the backend skill.
