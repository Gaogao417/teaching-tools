---
name: build-action-runtime-capability
description: Design, implement, version, and verify a reusable teaching-tools Action capability while creating a new Topic from a concrete question or question family, or when the user explicitly invokes this skill. Do not trigger it for standalone Runtime architecture/refactoring discussions. Require an approved ActionCapabilitySpec and a complete shared/frontend/backend/authoring/test vertical slice.
---

# Build Action Runtime Capability

## Trigger gate

Use this skill only when at least one condition is true:

- the user supplied a concrete question or question family and asked to create a new Topic, and that Topic needs a missing/incompatible reusable Action capability;
- the user explicitly invoked `build-action-runtime-capability`.

Do not infer this skill from a standalone Runtime architecture proposal, cross-cutting refactor, SolutionBoard redesign, or general code-maintenance request.

Build a reusable `kind@version` for **Action Runtime v2**, not a Topic widget.

Use one handoff artifact:

```text
docs/actions/<kind>/action-capability-spec.md
```

## Bind the model and classify the change

Read [references/runtime-v2-contract.md](references/runtime-v2-contract.md) completely. Then inspect the current `ActionContract`, registry, representative machine, typed evaluator, authoring source, and tests.

Keep version domains separate:

- The required product model is Action Runtime v2.
- The current plan number comes from `ACTION_RUNTIME_PLAN_VERSION` and may not be `2`.
- A new action may start at `@1`; increment its action version only for an incompatible contract/evidence change.
- A Topic/content ID ending in `.v1` does not authorize a legacy runtime implementation.

Classify the request:

| Situation | Decision |
| --- | --- |
| Existing action can express it through public input, private truth, presentation, question-owned solution context, or geometry data | Reuse the existing `kind@version`; stop and report the mapping |
| Distinct reusable learner operation or persistent effect | Add a new `kind@1` |
| Compatible optional behavior for an existing action | Extend the existing version and preserve old fixtures |
| Incompatible input, evidence, or semantics | Add the next version and keep old registry support while referenced |

## Phase 1: Specify and stop

1. Copy [assets/action-capability-spec.template.md](assets/action-capability-spec.template.md) to `docs/actions/<kind>/action-capability-spec.md`.
2. Define the capability without Topic IDs, source-step wording, or one problem's object names.
3. Specify public input, private truth, typed evidence, structural readiness, local teaching correctness, deterministic Learn demonstration events, backend diagnosis, diagram preview/canonical effects, SolutionBoard isolation, modes, recovery, and authoring API.
4. List every shared/frontend/backend/authoring/test seam that must change.
5. Keep status `draft` and validate:

```bash
python3 .codex/skills/build-action-runtime-capability/scripts/validate_action_capability_spec.py \
  docs/actions/<kind>/action-capability-spec.md --expect-status draft
```

6. Present the spec for explicit approval and stop. Do not change product code in this phase.

## Phase 2: Implement the approved vertical slice

After explicit approval, set status `approved`, validate it, and read [references/vertical-slice-checklist.md](references/vertical-slice-checklist.md) completely.

Implement in this order:

1. Shared discriminated `ActionContract`, typed `ActionEvidence`, and validators.
2. Shared persistent `DomainCommand` semantics when the Action changes the diagram world.
3. One isolated frontend machine definition and projector; include enabled entities, drafts, readiness, precise wrong state, diagram preview commands, and a deterministic Learn demonstration derived only from reviewed teaching truth.
4. One registry entry for the exact `kind@version` with runtime input validation.
5. Backend private evaluation with precise wrong action/object/input IDs plus accepted canonical diagram commands.
6. Generic offline authoring support that emits public `input`, private `teachingInput`, answer fields, and capabilities. The Action authorer must not create SolutionBoard prose, targets, slots, or commands; the requesting Topic separately binds reviewed question-bank proof rows to Action visibility boundaries.
7. Shared, frontend, backend, authoring, recovery, and browser tests using a capability fixture independent of the requesting Topic.

Require preview/commit parity:

```text
frontend draft evidence
  -> preview diagram commands
  -> typed submission
  -> backend canonical diagram commands
  -> committed diagram WorldProjection
  -> replayed restore with the same visible diagram result
```

Set status `implemented` only after the reusable vertical slice works without the target Topic.

## Phase 3: Verify independently

Validate the `implemented` spec and execute every gate in [references/vertical-slice-checklist.md](references/vertical-slice-checklist.md).

Walk a real Action Runtime page through correct input, wrong input, correction, BACK, CLEAR, checkpoint/refresh, accepted commit, rejected rollback, desktop, and narrow width. Verify Learn/Guided behavior and Assessment redaction. Record exact commands, fixture IDs, browser evidence, and any deferred checks.

Set status `verified` only after all required gates pass. Then return the registered `kind@version` to the requesting Topic workflow.

## Hard boundaries

- Never implement a Topic-specific React branch, machine, evaluator case keyed by Topic ID, or one-off panel.
- Never route new work through `ExerciseRuntimeSpec`, primitive switches, `RuntimeActionEvent.value`, topic answer strings, or a legacy Topic frame.
- Keep answer truth in `teachingInput` or the backend answer key; Assessment receives only public interaction shape.
- Require every Learn-capable Action to expose a deterministic demonstration path. Do not require learner clicks, synthesize missing truth, or put playback timing inside the Action.
- Never ship an effect only in React or XState state. Persist it through typed workspace commands.
- Never put SolutionBoard prose, `boardTargets`, slots, previews, or commands in an Action capability. Test that the capability preserves the backend-projected question solution context without interpreting it.
- Never project different accepted effects in frontend preview and backend canonical evaluation.
- Never register a `kind@version` without input validation and unsupported-version behavior.
- Never resume the requesting Topic until the capability spec is `verified`.

## Resources

- [references/runtime-v2-contract.md](references/runtime-v2-contract.md): authoritative model binding, version distinctions, and repository seams.
- [references/vertical-slice-checklist.md](references/vertical-slice-checklist.md): implementation and acceptance gates.
- [assets/action-capability-spec.template.md](assets/action-capability-spec.template.md): approval artifact template.
- `scripts/validate_action_capability_spec.py`: deterministic structure, model-binding, and lifecycle validator.
