---
name: exercise-runtime-implementer
description: Implement or review exercise runtimes for the teaching-tools repo while preserving the runtime-first architecture. Use when turning an exercise spec into backend projector, evaluator, and frontend renderer changes; mapping learner actions to existing runtime primitives; checking guide-step versus workspace ownership; pairing initial learner-facing UI design with the repo's design guard skills; or rejecting custom UI workarounds that should be new platform capabilities.
---

# Exercise Runtime Implementer

## Overview

Use this skill when an exercise spec is already drafted and the next task is to implement or review the runtime work without drifting away from the current architecture.

Default to an architecture-fit pass before code. If the requested interaction cannot be expressed cleanly with the current runtime primitives, stop and name the missing capability instead of inventing an exercise-local workaround.

When the task includes initial learner-facing UI design, screen structure, or flow changes, run `design-runtime-guard` before implementation. If the user explicitly wants a bolder redesign or wants to compare directions, also run `design-exploration-review` before coding.

Read only what you need:
- Read [references/architecture-checklist.md](references/architecture-checklist.md) before designing or reviewing a new exercise engine.
- Read `../design-runtime-guard/SKILL.md` when learner-facing UI is in scope.
- Read `../design-exploration-review/SKILL.md` when the request includes redesign, stronger visual direction, or interaction exploration.
- Inspect the current source-of-truth files named in that checklist before deciding ownership or adding UI.

## Workflow

1. Ground in the current runtime and decide whether a design pass is required.
Read the architecture and contract files before proposing implementation changes. At minimum, inspect:
- `docs/adr/ADR-001-runtime-first-architecture.md`
- `docs/features/practice.md`
- `web/shared/contracts.ts`
- `web/frontend/src/pages/practice/runtime/GuidePanel.tsx`
- `web/frontend/src/pages/practice/runtime/WorkspaceScene.tsx`
- `web/frontend/src/pages/practice/runtime/InputAnchorLayer.tsx`

If the task changes learner-facing UI, layout, or flow:
- run the `design-runtime-guard` workflow first
- inspect `web/CLAUDE.md`
- inspect `web/frontend/src/styles.css` and the relevant file in `web/frontend/src/styles/`
- if the request is intentionally exploratory, also consult `design-exploration-review`

2. Classify the learner actions before writing code.
For each learner step, identify:
- the persistent mathematical object that must stay visible
- whether the learner is directly manipulating that object
- whether the learner is entering a step-local answer or intermediate text
- which existing runtime primitives already cover the interaction

3. Do an architecture-fit check.
Use one of these outcomes explicitly in your reasoning and final summary:
- `supported by current primitives`
- `needs guide extension`
- `needs workspace primitive`
- `new-tool-needed`

4. Map every step to shared primitives.
Prefer these shared primitives before creating custom components:
- `select` for choosing visible objects or options
- `input` for shared text/value entry targets
- `assign` and `compose` when the runtime contract already supports them
- scene `zones` for direct object interaction
- scene `anchors` for positioned shared inputs
- guide-step text and inline guidance for narration and step-specific instructions

5. Apply ownership defaults.
- `GuidePanel` owns step narration, status, hints, and step-local instructional context.
- `practice-canvas-zone` owns the persistent mathematical object and direct manipulation of that object.
- If the interaction is primarily "fill in this step answer" rather than "manipulate the visible object," default it to guide-step-side shared infrastructure, not an exercise-local workspace sidebar.
- Use `mixed` ownership only when a step genuinely needs both a visible-object action and a tightly coupled shared input surface.

6. Reject common anti-patterns.
Do not:
- add a custom `StepInputArea` or exercise-local sidebar just to collect step answers
- embed a scene-model blob and then bypass shared anchors/zones when the runtime already has a matching primitive
- mismatch `selectionKind` with evaluator expectations
- introduce wildcard or ad hoc input targets unless the shared runtime supports them end to end
- let the workspace renderer quietly redefine the product contract that the guide and flow imply

7. Keep the contract consistent.
Check that these all agree:
- projector `allowedActions`
- renderer behavior
- evaluator expectations
- clear and submit semantics
- done-state summaries shown back to the learner

8. Escalate the right way.
If the spec cannot be implemented cleanly within the current guide/workspace split, report the missing platform capability. A new engine is not the same thing as a new interaction primitive.

9. Summarize the design handoff before coding.
When learner-facing UI is involved, explicitly state:
- what design constraints came from `design-runtime-guard`
- whether `design-exploration-review` changed the chosen direction
- which shared styles or tokens should be reused
- whether any remaining gap is architectural rather than visual

## Review Standard

Before finalizing implementation or review feedback, confirm all of the following:
- The workspace keeps the core mathematical object visible.
- Step-local inputs are not hiding inside exercise-local workspace furniture by default.
- Guide responsibilities and workspace responsibilities remain distinct.
- The engine reuses shared runtime primitives where possible.
- Learner-facing UI changes went through the design guard pass before implementation.
- Any custom renderer is justified by a real visible-object need, not by missing discipline.
- Any missing primitive is named explicitly instead of being smuggled in as custom UI.

## Example Requests

- "Use this spec to implement a new exercise engine without breaking the current runtime architecture."
- "Review this runtime implementation for guide-vs-workspace ownership mistakes."
- "Map each learner step in this exercise spec to existing runtime primitives before coding."
- "Tell me whether this exercise needs a new platform primitive or just a new engine."
