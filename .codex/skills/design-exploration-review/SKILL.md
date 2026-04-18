---
name: design-exploration-review
description: Explore or review bolder visual and interaction directions for the teaching-tools repo without breaking runtime architecture. Use when redesigning learner-facing screens, rethinking information architecture, or comparing UI directions before implementation.
---

# Design Exploration Review

## Overview

Use this skill when the task is not only to preserve the current UI, but to improve or rethink it.

This skill is for bold exploration with explicit boundaries. It should expand the design space while keeping runtime ownership, backend contracts, and shared styling discipline visible.

Read only what you need:
- Read `web/CLAUDE.md` before proposing new frontend structure or styling.
- Inspect the current page or flow you are redesigning.
- Read the old design reports under `.claude/worktrees/glm-5.1/wxapp/design-reports/` when redesigning the same screen family or when you want prior reasoning about layout and task flow.
- If the redesign touches practice runtime ownership, also read `exercise-runtime-implementer/references/architecture-checklist.md`.

## Workflow

1. Name the non-negotiables.
List what cannot be broken:
- runtime ownership boundaries
- required learner actions
- backend or contract assumptions
- the shared style system and token discipline

2. Identify the real design problem.
Focus on one or two of these:
- information hierarchy is unclear
- the learner action flow is noisy or indirect
- the screen looks too generic or lacks emphasis
- feedback, progress, or task framing is hard to scan

3. Explore within the safe zone.
You may propose stronger layout, typography, pacing, emphasis, or interaction patterns when they do not:
- move guide behavior into the workspace
- hide the persistent mathematical object
- require a new runtime capability without naming it
- bypass the shared style system

4. Produce a direction, not just critique.
When helpful, summarize the outcome as:
- `keep`: what stays stable
- `change`: what should be redesigned
- `watch`: what could turn into a platform or UX problem

5. Hand off cleanly to implementation.
Before coding, translate the chosen direction into:
- the target screen structure
- the reused shared classes or tokens
- any justified shared-style additions
- any explicit runtime limitation that still remains

## Review Standard

Before finalizing, confirm all of the following:
- The proposal is more intentional, not just different.
- The learner path is clearer or lighter than before.
- Visual boldness does not weaken runtime ownership.
- The output is implementable with the current frontend system, or the gap is clearly named.

## Example Requests

- "Give me two stronger directions for this learner screen before we code."
- "Review this redesign and tell me what we should keep, change, and watch."
- "Help us rethink the page flow without drifting away from the runtime architecture."
