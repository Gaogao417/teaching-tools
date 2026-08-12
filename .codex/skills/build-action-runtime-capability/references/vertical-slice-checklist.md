# New Action vertical-slice checklist

## Shared contract

- Add or version a discriminated `ActionContract` input with public structural fields only.
- Add exact typed evidence containing learner selections and entered values.
- Update runtime guards for contracts, evidence, diagram commands, effects, and plan hydration where applicable.
- Add deterministic diagram command variants only for durable geometry effects.
- Keep the Action contract and effects independent of SolutionBoard content and context.
- Define stable command, mark, output entity, and input identities.

## Frontend machine and registry

- Keep one machine definition under `web/frontend/src/action-runtime/actions/`.
- Derive enabled objects, selected objects, active slot, values, readiness, wrong state, and completion evidence from machine context.
- Reject duplicates; enforce object kind, order, maximum count, and required answers.
- Separate structural readiness from local teaching correctness.
- Define deterministic Learn demonstration events from `teachingInput`; one shared runtime advance must complete exactly one Action without learner entry.
- Emit diagram preview commands from the draft evidence shape when the Action has a diagram effect.
- Register exactly the supported `kind@version` and validate every required input field.
- Test invalid input and unsupported version errors.
- Keep React components generic; add generic renderer capability only when the workspace view truly needs a new presentation primitive.

## Backend and authoring

- Evaluate private expected objects, order, values, and results in `topicTypedEvaluator` or a reusable delegated evaluator.
- Return exact `wrongActionIds`, `wrongObjectIds`, and `wrongSlotIds`.
- Emit canonical diagram commands only after acceptance.
- Verify canonical effects equal accepted frontend completion effects.
- Add a generic authoring API/mapping that emits `input`, `teachingInput`, answer fields, and capabilities.
- Verify the Action authoring path does not generate SolutionBoard prose or add an Action-kind case to complete-solution assembly.
- Ensure generated bundle records still use `teaching-tools/topic-scenario-bundle/v2` with authored `actionTemplates` and `solutionBoard`.
- Do not edit `topicScenarioBundle.json` by hand.

## Modes, recovery, and security

- Learn/LocalTeaching may merge teaching truth and preview correctness.
- Learn confirmation drives the deterministic demonstration path; questions and comprehension feedback must leave the Action unchanged.
- Guided Practice uses structurally complete typed evidence and backend authority.
- Assessment keeps public shape but removes teaching truth, coach internals, and SolutionBoard context.
- Rejected evaluation preserves prior committed effects and removes rejected drafts.
- BACK removes the latest uncommitted action effect without corrupting earlier work.
- CLEAR resets the intended source-step group only.
- Checkpoint/refresh restores current action, draft evidence when supported, committed diagram marks, and the backend-authorized immutable SolutionBoard context.
- Repeated accepted submission does not duplicate derived entities or teaching marks.

## Tests and browser acceptance

At minimum, add focused tests for:

- shared validators and command application;
- frontend machine correct/wrong/duplicate/readiness behavior;
- registry valid, invalid, and unsupported-version behavior;
- diagram preview command shape;
- SolutionBoard isolation and unchanged authorized-context passthrough;
- backend correct/wrong evaluation and canonical diagram commands;
- mode redaction;
- BACK, CLEAR, rejected rollback, accepted restore, and replay;
- generic authoring output and generated v2 record validation.

Use a capability fixture independent of the requesting Topic. Then walk the real browser page at desktop and narrow width. Record exact commands and evidence in the spec; keep status `implemented` if any required gate fails.
