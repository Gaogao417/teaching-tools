# Implementation boundaries

Use this reference only after the topic experience specification is explicitly approved.

## Authority

- Treat the approved specification as the product and interaction contract.
- Treat final explanation TeX, ready bank records, and diagram assets as content truth.
- Preserve source paths and stable IDs through imported bundles, runtime projections, and review evidence.
- Do not silently revise an approved learner flow to reduce implementation effort.

## Framework use

- Reuse the existing Learn, Practice, and Review routes, workspace shell, navigation, style tokens, and shared components when they serve the approved experience.
- Reuse or extend shared interaction and runtime abstractions when the behavior is broadly reusable.
- Implement topic-specific behavior where necessary for fidelity, while preserving the repository's runtime-first boundary.
- Do not produce or ask the user to approve a separate framework-fit classification before implementation.

## Runtime ownership

- Keep the backend/runtime authoritative for accepted answers, mathematical evaluation, step transitions, persisted action evidence, diagnoses, and result snapshots.
- Keep frontend state limited to draft input, focus, transient selection, and presentation effects.
- Keep Learn and Practice on the same mathematical object and evaluation logic when specified; change guidance strength and visibility rather than creating contradictory truth.
- Keep Review immutable and based on persisted backend evaluation.
- Keep coaching derivations, object mappings, blank semantics, and error-specific explanations in typed runtime content traceable to the approved specification. Do not reconstruct mathematical reasons from display labels in the frontend.

## Change discipline

- Inspect the current worktree before editing.
- Preserve unrelated user changes and avoid broad formatting or cleanup.
- Update shared contracts and their documentation together when runtime shapes change.
- Add focused tests for new states, transitions, and evaluation rules.
- Do not mark the specification `implemented` until the visible behavior matches every approved interaction row and state rule.
