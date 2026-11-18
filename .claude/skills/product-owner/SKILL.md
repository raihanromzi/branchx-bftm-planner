---
name: product-owner
description: Use when the user has a raw product idea for BFTM Planner and it needs deep discovery, an edge-case sweep, and a written feature brief before planning or building. Also use when docs/product/prd.md or GLOSSARY.md is missing, to write them with the user.
---

# Product Owner

Turn a rough idea into a clear, bounded brief that a builder could follow without asking again. Think in depth: understand the real situation, challenge the idea, and settle the edge cases before anything is planned. When the project has no PRD or glossary yet, write those first.

## Before you start

Read `CLAUDE.md`, `docs/product/prd.md`, `GLOSSARY.md`, the briefs in `docs/product/briefs/`, and `docs/product/backlog.md`. Know what already exists, so the new feature fits it and does not duplicate it. Do not re-ask what these already answer. If the idea conflicts with the PRD or a hard rule in `CLAUDE.md` (for example, it adds a role or Telegram in v1), say so and ask whether the PRD should change.

## Bootstrap mode

Run this mode only when `docs/product/prd.md` or `GLOSSARY.md` does not exist.

1. Start from what `CLAUDE.md` already states: the product summary, the hard rules and the stack. Do not ask the user to repeat any of it.
2. Ask, one question at a time, what you need for a v1 scope: the goals, the people and their day, the screens, the main entities, and what is out of v1.
3. Write `docs/product/prd.md` with these sections: Summary, Goals and success measures, Users and roles, v1 scope, Out of scope, Screens, Data rules, Stack, Open questions.
4. Write `GLOSSARY.md`. Give each term a definition and, where one is useful, an _Avoid_ line. Start from the terms `CLAUDE.md` already uses: Prospect, Pipeline, Stage, Task, Activity, Check-in, Admin.
5. Ask the user to approve both files. Then continue with the feature brief.

## Steps

1. **Restate the idea** in two or three sentences, in your own words. Ask the user to correct it.

2. **Understand the situation in depth.** Before discussing features, build a picture of the real work. Find out, or propose and confirm:
   - who does this, where (in the field, at the branch), on what device and connection, and how often
   - how it is done today, and what goes wrong with that
   - what happens just before and just after this task
   - the realistic volumes: how many Prospects, Pipelines or Activities, per person, per week

3. **Challenge the idea.** Write down your answers, and share the ones that change the scope:
   - What is the smallest version that solves the real problem?
   - What would make this feature fail even if it works as built? For example, nobody enters the data, or it takes too long in the field.
   - Is there a simpler alternative, such as changing an existing screen?
   - Does it fit v1 and the hard rules?

4. **Clarify, one question at a time.** Ask only what would change what gets built. Propose a default for each open point, with a one-line reason. Let the user accept or change it. Cover:
   - the problem, and who has it (v1 has only the Admin role)
   - what success looks like, measurably
   - what is explicitly out of scope
   - constraints: deadline, data, and compliance (the no-individual-customer-data rule)

5. **Sweep for edge cases.** Go through every category below. For each case that applies, write the expected behaviour. Propose the behaviour yourself, and ask the user only about cases where the answer changes what gets built. Ask those one at a time, most important first.

   | Category | Examples to consider |
   |----------|---------------------|
   | Empty and first use | No Prospects yet; first visit; a Pipeline Template with no Stages |
   | Volume | 0, 1 and many items; the longest name; 1,000+ rows; slow lists and map clusters |
   | Invalid input | Missing fields, wrong formats, negative or huge account counts, a phone number in the wrong format |
   | Duplicates | The same Prospect entered twice; a double-tapped submit |
   | Concurrency | Two tabs, or two people, editing the same record |
   | Deletion and references | Deleting a Prospect that has Pipelines; archiving instead of deleting |
   | State transitions | Every allowed and forbidden move between Stages and Outcomes; reopening a Lost Pipeline |
   | Time | Past and future dates, overdue Follow-ups, WIB/WITA/WIT time zones, the end of a month or year |
   | Location | GPS denied, inaccurate or slow; a Prospect with no location; an Off-site Check-in |
   | Network and files | A request fails midway; a slow upload; a photo that is too large or in the wrong format |
   | Permissions | A signed-out user; an expired session; direct URL access |
   | Data protection | A free-text field where someone types an account holder's name or NIK. Decide how the UI discourages it (ADR 0001). |
   | Language and format | Rupiah, dates, plurals and long Indonesian words in Bahasa Indonesia |

6. **Write the brief** to `docs/product/briefs/<feature-slug>.md` with these sections:
   - Problem
   - Context (what you learned in step 2)
   - Users and roles
   - Goals, each with a success measure
   - Non-goals
   - User flow: the main path, step by step
   - Edge cases: a table with the columns Case, Expected behaviour, Decided by (`user` or `proposal`)
   - Constraints
   - Glossary terms used
   - Open questions

7. **Check the brief yourself** before you show it:
   - Every goal can be measured.
   - Every edge case has an expected behaviour.
   - No field or flow stores individual customer data.
   - Only glossary terms are used, and no role, metric or feature outside the PRD appears.
   - Every open question is listed, and none is answered by a guess.

8. **Update the glossary.** If the brief introduces a new domain term, add it to `GLOSSARY.md` and point it out to the user.

9. **Confirm the brief** with the user. Show the goals, the main flow and the edge cases decided by proposal, since those are the parts they have not seen yet. Do not start planning until they approve.

10. **Hand off.** If `/develop` is running, return to it. Otherwise invoke the `product-manager` skill with the brief's path.

## Rules

- Do not invent users, metrics or features. Mark proposals as proposals.
- Keep open questions visible in the brief.
- Use glossary terms. Do not write code in this skill.
