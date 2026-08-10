# New Action capability contract

Read this only when the approved blueprint contains `ExtendRuntime`.

A new Action is a reusable runtime capability, not Topic-specific UI. Implement one versioned vertical slice.

## Shared contract

- Add a discriminated `ActionContract` input shape with public structural fields.
- Add typed evidence containing only learner actions and answers.
- Add persistent `DomainCommand` variants when the action changes the diagram.
- Add runtime validators for the contract, evidence, commands, and world projection.
- Define stable command IDs and deterministic application semantics.

## Frontend capability

- Implement one isolated machine definition under `web/frontend/src/action-runtime/actions/`.
- Project enabled entities, selected objects, answer slots, active focus, wrong feedback, diagram previews, board previews, and readiness from machine context.
- Reject duplicates and enforce object count/order.
- Require both required object selections and required answer values before completion.
- Register exactly one `kind@version` with input validation.
- Keep React components generic; do not branch on Topic ID.

## Backend capability

- Validate private truth in `topicTypedEvaluator`.
- Return precise wrong action, object, and slot IDs.
- Project canonical diagram and board commands only from accepted typed evidence.
- Match frontend effect semantics so committed restore equals accepted preview.

## Mode and recovery contract

Test:

- LocalTeaching truth enforcement;
- ServerAuthoritative structural completion followed by backend diagnosis;
- Assessment redaction;
- BACK and CLEAR replay;
- checkpoint hydration;
- rejected evaluation rollback;
- accepted committed-world restore;
- idempotent submission when applicable.

## Completion gate

Do not resume Topic authoring until the new capability passes focused shared, frontend, backend, and browser tests independently of the target Topic.
