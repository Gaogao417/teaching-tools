---
name: build-topic-learning-experience
description: Turn reviewed teaching explanation TeX, ready question banks, and diagram assets into a stateful topic Learn/Practice/Review experience. Use when Codex needs to create or revise a topic experience specification, implement an explicitly approved specification in teaching-tools, or verify a completed topic experience. Always produce a reviewable draft specification before code and require explicit user approval before implementation.
---

# Build Topic Learning Experience

Treat the reviewed explanation as the teaching truth. Convert its existing steps into an operable learner experience without re-analyzing the learning problem, inventing new learning objectives, or optimizing the pedagogy.

Use one evolving specification as the handoff between design, implementation, and verification:

```text
docs/topics/<topic-id>/topic-experience-spec.md
```

## Route by specification state

Inspect the specification before acting.

| State | Allowed work |
| --- | --- |
| missing | Generate a `draft` specification and stop |
| `draft` | Revise or present the specification; do not change product code |
| `approved` | Implement the confirmed specification |
| `implemented` | Run acceptance and repair implementation defects |
| `verified` | Report the verified result; change only on explicit request |

Treat only explicit user language such as “确认”, “通过”, or “按此实施” as approval. Never infer approval from silence, partial feedback, or a request to inspect the draft.

## Phase 1: Generate the experience specification

1. Read [references/experience-spec.md](references/experience-spec.md) completely.
2. When the experience includes guidance, coaching, step narration, or fill-in assistance, read [references/coach-explanation.md](references/coach-explanation.md) completely and apply it to every learner-visible coaching transition.
3. Inspect the exact final explanation TeX, ready question bank, enabled assignments, and diagram assets named or discoverable in the topic artifact tree.
4. Create the specification from [assets/topic-experience-spec.template.md](assets/topic-experience-spec.template.md).
5. Generate sections in this order:
   - source mapping;
   - user flow diagram;
   - page structure;
   - interaction rules;
   - coach explanation scripts when coaching is present;
   - page state description;
   - decisions requiring user confirmation.
6. Set `status: draft` even when the design appears complete.
7. Validate the file:

```bash
python3 .codex/skills/build-topic-learning-experience/scripts/validate_experience_spec.py \
  docs/topics/<topic-id>/topic-experience-spec.md --expect-status draft
```

8. Present the specification for review and stop. Do not edit frontend, backend, shared contracts, tests, or generated bundles in this phase.

Do not constrain the experience to currently available action primitives. Propose the interaction that most faithfully operationalizes the explanation. Do not add a framework-fit report or implementation classification to the specification.

## Approve the specification

After explicit approval:

1. Apply requested final specification edits.
2. Change only the specification status from `draft` to `approved` after those edits are reflected.
3. Validate with `--expect-status approved`.
4. Proceed to implementation only when the user asks to continue or the approval message explicitly authorizes implementation.

If implementation would materially change the approved flow, page structure, interaction, or state behavior, update the specification back to `draft`, describe the conflict, and obtain approval again.

## Phase 2: Implement the approved specification

1. Read [references/implementation-boundaries.md](references/implementation-boundaries.md) completely.
2. Read [references/coach-explanation.md](references/coach-explanation.md) completely when the approved specification contains coaching or fill-in assistance.
3. Validate that the specification is `approved` before changing product code.
4. Implement the approved experience, reusing or extending the framework as needed. Do not insert a separate framework-adaptation gate.
5. Keep explanation steps, question IDs, assets, accepted answers, diagnoses, coaching scripts, and runtime steps traceable to the recorded sources.
6. Preserve unrelated worktree changes and keep edits scoped to the approved experience.
7. Run focused build and runtime checks.
8. Change the specification status to `implemented` only after the implemented behavior matches the approved specification.

## Phase 3: Verify the implementation

1. Read [references/acceptance-checklist.md](references/acceptance-checklist.md) completely.
2. Read [references/coach-explanation.md](references/coach-explanation.md) completely when verifying coaching or fill-in assistance.
3. Validate that the specification is `implemented`.
4. Test every specified flow and page state, including wrong-answer preservation, session recovery, narrow-screen behavior, keyboard operation, coaching transitions, and per-blank assistance.
5. Repair implementation defects without silently changing the approved experience.
6. Record concise verification evidence in the specification.
7. Change the status to `verified` only when all required checks pass.

## Hard boundaries

- Keep the final explanation as the source of teaching sequence and wording.
- Do not introduce a separate learning-problem or learning-objective analysis stage.
- Produce the user flow diagram inside the first draft specification, before page structure and code.
- Keep Learn and Practice on the same mathematical object and evaluation truth wherever the approved design requires it.
- Keep mathematical truth, state transitions, and evaluation in the backend/runtime rather than inferring them in the frontend.
- Exclude deployment, rollout, operations, and product analytics unless the user explicitly expands scope.
- Never bypass the explicit approval gate.
