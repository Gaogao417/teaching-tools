# Architecture Checklist

Use this checklist before implementing or approving a new exercise runtime.

## Source of Truth

Inspect these files before deciding that a new exercise needs custom UI:
- `docs/adr/ADR-001-runtime-first-architecture.md`
- `docs/features/practice.md`
- `web/shared/contracts.ts`
- `web/frontend/src/pages/practice/runtime/GuidePanel.tsx`
- `web/frontend/src/pages/practice/runtime/WorkspaceScene.tsx`
- `web/frontend/src/pages/practice/runtime/InputAnchorLayer.tsx`
- the closest existing engine under `web/backend/src/services/runtime/engines/`

## Ownership Defaults

Use these defaults unless the spec proves they are wrong:
- Workspace owns the persistent mathematical object and direct manipulation of that object.
- Guide-step owns narration, hinting, step status, and step-local answer entry.
- A learner should not lose sight of the main mathematical object just because the current step changed.
- A custom engine may change the visible object; it may not silently redefine product ownership boundaries.

## Primitive Mapping

Try to express each step with existing primitives before adding new code paths:
- `select`: choose visible objects or named options.
- `input`: enter a value or expression into a shared runtime input target.
- `assign`: move a known value into a known target when the contract already supports it.
- `compose`: build a formula or expression from declared slots.
- scene `zones`: click or select a visual object.
- scene `anchors`: place shared inputs at stable locations.
- guide-step copy and inline note: explain the current step and direct the next action.

## Preflight Questions

Answer these before implementation:
- What is the persistent workspace object?
- Which learner actions are direct object manipulation?
- Which learner actions are step-local text or value entry?
- Which current primitives cover each step?
- Is any requested interaction actually a missing guide capability?
- Is any requested interaction actually a missing workspace primitive?
- If no clean mapping exists, is the correct answer `new-tool-needed`?

## Anti-Patterns

Flag the implementation if any of these appear without explicit justification:
- An exercise-local `StepInputArea` or sidebar used for generic step answers.
- A scene model blob used as a substitute for proper shared anchors or zones.
- `selectionKind: single` while the evaluator expects a full set or multi-select answer.
- Wildcard input targets such as `solution-*` that the shared runtime cannot render or clear consistently.
- A renderer that changes input semantics instead of following `allowedActions`.
- A spec marked `supported` even though it only works by moving guide-step interactions into the workspace.

## Contract Consistency Checks

Verify all of the following together:
- Flow step title and goal.
- `allowedActions` for the active step.
- Scene anchors and zones.
- Renderer behavior and draft state writes.
- Evaluator logic and answer cardinality.
- Clear behavior.
- Submit payload shape.
- Done-state summary shown back to the learner.

## Escalation Rule

When the current runtime cannot express the interaction cleanly, stop and say which capability is missing:
- guide-step shared input surface
- workspace primitive for a new visible object
- new correctness primitive
- other explicit platform capability

Do not solve a platform gap by hiding a new product rule inside a one-off exercise renderer.
