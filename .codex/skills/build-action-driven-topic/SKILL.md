---
name: build-action-driven-topic
description: Compile or revise a teaching-tools Topic from an approved teaching explanation, ready teaching-skills question banks, and diagram assets into the shared Action Runtime. Use when Codex is asked to create or 录入 a new Topic, connect a bank, map teaching steps to reusable ActionTemplates, add a genuinely missing reusable Action capability, or verify and repair a Topic across Learn, Practice, Assessment, and Review. Require a reviewable TopicBlueprint before implementation and prevent topic-specific pages, generated-bundle edits, and answer leakage.
---

# Build Action-Driven Topic

Treat a new Topic as content compilation, not page development:

```text
Topic = registration + lesson + ActionTemplates + Scenario Bank
      + diagram effects + SolutionBoard + verification
```

Use one evolving handoff artifact:

```text
docs/topics/<topic-id>/topic-blueprint.md
```

## Route by blueprint state

Inspect the blueprint before acting.

| State | Allowed work |
| --- | --- |
| missing | Generate a `draft` blueprint and stop |
| `draft` | Revise or present it; do not change product code |
| `approved` | Implement the confirmed blueprint |
| `implemented` | Run acceptance and repair implementation defects |
| `verified` | Report the verified result; change only on explicit request |

Treat only explicit user language such as “确认”, “通过”, or “按此实施” as approval. Never infer approval from silence.

## Phase 1: Produce the TopicBlueprint

1. Read [references/architecture-contract.md](references/architecture-contract.md) completely.
2. Read [references/topic-blueprint.md](references/topic-blueprint.md) completely.
3. Inspect the exact approved explanation, ready bank, diagram assets, enabled assignments, and one structurally similar existing Topic. Resolve `TEACHING_SKILLS_ROOT` instead of assuming the importer default is correct.
4. Copy [assets/topic-blueprint.template.md](assets/topic-blueprint.template.md) to `docs/topics/<topic-id>/topic-blueprint.md` and preserve source identifiers verbatim.
5. Map each source teaching step to one or more actions. Mark every action as:
   - `Reuse kind@version`; or
   - `ExtendRuntime capability-name`.
6. For every action specify all four outcomes: learner interaction, typed evidence, diagram effect, and SolutionBoard effect.
7. Separate public structure in `input` from teaching or assessment truth in `teachingInput`. Keep counts and interaction shape public; keep expected objects, values, ordering, and results private.
8. Specify stable geometry IDs, derived outputs, overlapping whole/part segments, SolutionBoard slots, submit boundaries, mode behavior, registration points, and first/middle/last bank samples.
9. Keep status `draft` and validate it:

```bash
python3 .codex/skills/build-action-driven-topic/scripts/validate_topic_blueprint.py \
  docs/topics/<topic-id>/topic-blueprint.md --expect-status draft
```

10. Present the blueprint for review and stop. Do not edit frontend, backend, shared contracts, registries, tests, or generated bundles in this phase.

## Approve the blueprint

After explicit approval:

1. Apply requested blueprint changes.
2. Change only the status from `draft` to `approved` after those changes are recorded.
3. Validate with `--expect-status approved`.
4. Proceed only when the user also authorizes implementation.

If implementation would materially change the action sequence, interaction contract, diagram effect, SolutionBoard, or mode boundary, return the blueprint to `draft` and request approval again.

## Phase 2: Implement the approved blueprint

1. Validate that the blueprint is `approved`.
2. Reuse registered actions whenever possible. Do not create a new machine for different wording or different Topic data.
3. If any row is `ExtendRuntime`, read [references/new-action-capability.md](references/new-action-capability.md) completely and implement the capability as a shared vertical slice before authoring Topic records.
4. Update the current registration seams recorded in the blueprint. Do not create a topic-specific Learn, Practice, or Review page.
5. Author lesson, scenario, geometry, ActionTemplates, private truth, board targets, and source tracking at the authoring source. Never hand-edit `topicScenarioBundle.json`.
6. Generate the bundle from `web/backend` with `npm run import:topics`.
7. Inspect generated first, middle, and last records. Confirm action IDs, geometry references, board slots, source IDs, and answer-key redaction.
8. Restart the backend after regenerating the bundle before browser verification; do not trust stale in-memory content.
9. Run focused tests, preserve unrelated worktree changes, and set status `implemented` only after behavior matches the approved blueprint.

## Phase 3: Verify the Topic

1. Read [references/acceptance-checklist.md](references/acceptance-checklist.md) completely.
2. Validate status `implemented`.
3. Walk at least one complete Topic item from the first action through the final action in the real browser. Also exercise wrong selection, wrong input, correction, BACK, CLEAR, refresh/restore, and narrow width.
4. Verify first, middle, and last bank records and all supported modes.
5. Run frontend tests/build and backend tests. Record exact commands, scenarios, screenshots, and intentionally deferred checks under `Verification evidence`.
6. Set status `verified` only when every required gate passes.

## Hard boundaries

- Preserve the approved explanation as teaching truth; analyze action decomposition without inventing new pedagogy.
- Prefer `Reuse`; add a new reusable capability only when no registered `kind@version` can express the interaction.
- Never add a Topic-specific page or duplicate the shared Action Runtime.
- Never put expected objects, order, values, results, coach truth, or completed SolutionBoard content into Assessment payloads.
- Require frontend preview commands and backend canonical commands to project equivalent persistent effects.
- Put segment values, shares, correspondence marks, and emphasis on the diagram through domain commands, not in an abstract interaction panel.
- Keep entity IDs stable across actions. Explicitly test overlapping whole/part segments and shared endpoints.
- Use slot-based SolutionBoard expressions. Do not reveal static `expectedLatex` before the learner supplies the relevant evidence.
- Require structural readiness to include required object selection and required answers; do not infer completion from arbitrary filled fields.
- Never edit generated bundles as the source of truth.
- Never mark a Topic verified when a required mode, action, persistence path, or visual gate fails.

## Resources

- [references/architecture-contract.md](references/architecture-contract.md): current repository seams, action catalog, truth boundaries, and generated artifacts.
- [references/topic-blueprint.md](references/topic-blueprint.md): how to fill the blueprint and make reuse/extension decisions.
- [references/new-action-capability.md](references/new-action-capability.md): mandatory vertical-slice contract for a new `kind@version`.
- [references/acceptance-checklist.md](references/acceptance-checklist.md): release gates and browser walkthrough.
- [assets/topic-blueprint.template.md](assets/topic-blueprint.template.md): blueprint handoff template.
- `scripts/validate_topic_blueprint.py`: deterministic blueprint structure and state validator.
