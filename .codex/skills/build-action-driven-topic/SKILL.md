---
name: build-action-driven-topic
description: Compile or revise a teaching-tools Topic from an approved teaching explanation, ready teaching-skills question banks, and diagram assets into the Action Runtime v2 architecture with authored ActionTemplates and a database-backed, formally reviewed SolutionBoard. Use when Codex is asked to create or 录入 a new Topic, connect a bank, map teaching steps to reusable ActionTemplates, request a genuinely missing reusable Action capability, or verify and repair a Topic across Learn, Practice, Assessment, and Review. Require a reviewable TopicBlueprint, explicit v2 model binding, generated-bundle/runtime gates, and a fully assembled formally reviewed solution write-up before implementation can be accepted; prevent legacy v1 runtime fallback, topic-specific pages, generated-bundle edits, answer leakage, and action-log prose masquerading as a solution.
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

## Bind the runtime model first

Treat these as independent versions:

- Product architecture: **Action Runtime v2**.
- Generated bundle schema: exactly `teaching-tools/topic-scenario-bundle/v2`.
- Exercise plan schema: read `ACTION_RUNTIME_PLAN_VERSION` from `web/shared/actionRuntime.ts`; do not hardcode an older numeric plan version.
- Action contract version: the registered `kind@version`, which may legitimately be `@1`.
- Content and scenario IDs: suffixes such as `.v1` are content identity, not permission to use the legacy runtime.

Every new or revised Topic must materialize authored `actionTemplates` and one reviewed continuous `solutionBoard` from the question bank's teacher solution steps. Publishing must store complete per-Action `enter`/`accepted` snapshots in the question-solution database. Learn/Guided plans project only authorized `solutionBoardContexts`; Actions and `WorldProjection` do not own board prose or board commands. Assessment omits every SolutionBoard context. Do not use `ExerciseRuntimeSpec`, `RuntimeActionEvent.value`, primitive switches, legacy Topic frames, or string-answer reducers as the Topic implementation path.

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
5. Keep the template's exact v2 binding values. Do not reinterpret a `.v1` content ID as the runtime model.
6. Map each source teaching step to one or more actions. Mark every action as:
   - `Reuse kind@version`; or
   - `ExtendRuntime capability-name`.
7. For every action specify learner interaction, typed evidence, diagram effect, which reviewed proof rows become visible after acceptance, and the deterministic Learn demonstration beat. Do not make the Action author or assemble proof rows.
8. Separate public structure in `input` from teaching or assessment truth in `teachingInput`. Keep counts and interaction shape public; keep expected objects, values, ordering, and results private. Make `teachingInput` complete enough for the shared runtime to demonstrate the action without requiring learner input.
9. Specify stable geometry IDs, derived outputs, overlapping whole/part segments, reviewed SolutionBoard rows and their Action visibility boundaries, submit boundaries, mode behavior, registration points, and first/middle/last bank samples.
10. Keep status `draft` and validate it:

```bash
python3 .codex/skills/build-action-driven-topic/scripts/validate_topic_blueprint.py \
  docs/topics/<topic-id>/topic-blueprint.md --expect-status draft
```

11. Present the blueprint for review and stop. Do not edit frontend, backend, shared contracts, registries, tests, or generated bundles in this phase.

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
3. If any row is `ExtendRuntime`, read [references/new-action-capability.md](references/new-action-capability.md) completely and invoke `$build-action-runtime-capability`. Do not resume Topic authoring until the independent capability spec is `verified`.
4. Update the current registration seams recorded in the blueprint. Do not create a topic-specific Learn, Practice, or Review page.
5. Author lesson, scenario, geometry, ActionTemplates, private truth, reviewed teacher solution rows, and source tracking at the authoring source. Never hand-edit `topicScenarioBundle.json`, and never generate proof prose by dispatching on Action kind.
6. Generate the bundle from `web/backend` with `npm run import:topics`.
7. Run the generated-artifact gate, then inspect its reported first, middle, and last records:

```bash
python3 .codex/skills/build-action-driven-topic/scripts/validate_generated_topic_v2.py \
  web/backend/src/content/topicScenarioBundle.json --task-id <topic-id>
```

   Require bundle schema v2, non-empty `actionTemplates`, a complete static `solutionBoard`, no Action-owned board targets or placeholders, geometry references, source IDs, and answer-key redaction.
8. Restart the backend after regenerating the bundle before browser verification; do not trust stale in-memory content.
9. Run focused tests and preserve unrelated worktree changes.
10. Read [references/solution-writeup-review.md](references/solution-writeup-review.md) completely. At the end of Phase 2, assemble the complete canonical solution for the generated first, middle, and last records directly from the reviewed static SolutionBoard expressions. The assembler must reject placeholders and must not dispatch on Action kind or infer proof prose from parameter position. Use the helper to expose the generated documents:

```bash
python3 .codex/skills/build-action-driven-topic/scripts/assemble_topic_solutions.py \
  web/backend/src/content/topicScenarioBundle.json --task-id <topic-id>
```

11. Review each assembled solution against the stem, approved explanation, and answer key. Record the original complete solution, every finding, a concrete suggested revision, its disposition, and the final revised solution under `Complete solution review` in the TopicBlueprint.
12. Fix blocking correctness, reasoning, notation, placeholder, raw-LaTeX, punctuation, or UI/action-language defects at the question-bank authoring source; regenerate and repeat steps 6–11. Apply non-semantic formal-writing fixes directly. Return the blueprint to `draft` before changing approved pedagogy, action order, or mathematical strategy.
13. Set status `implemented` only when behavior matches the approved blueprint, every representative solution is complete and placeholder-free, the formal review verdict is `pass`, blocking issues remaining is `0`, and all suggested revisions have an explicit disposition.
14. In the Phase 2 handoff to the user, show the final complete solution and the modification table. Separate already-applied fixes, optional polish suggestions, and changes that require renewed approval; do not hide the review only inside the blueprint.

## Phase 3: Verify the Topic

1. Read [references/acceptance-checklist.md](references/acceptance-checklist.md) completely.
2. Validate status `implemented`.
3. Walk at least one complete Topic item from the first action through the final action in the real browser. In Learn, verify one explicit student confirmation advances exactly one deterministic demonstration beat, a question or “没听懂” response does not advance, and completion stays in teaching mode. In Practice, also exercise wrong selection, wrong input, correction, BACK, CLEAR, refresh/restore, and narrow width.
4. Verify first, middle, and last bank records and all supported modes.
5. Run frontend tests/build and backend tests. Record exact commands, scenarios, screenshots, and intentionally deferred checks under `Verification evidence`.
6. Set status `verified` only when every required gate passes.

## Hard boundaries

- Preserve the approved explanation as teaching truth; analyze action decomposition without inventing new pedagogy.
- Prefer `Reuse`; add a new reusable capability only when no registered `kind@version` can express the interaction.
- Never add a Topic-specific page or duplicate the shared Action Runtime.
- Never add Topic-specific playback timers, coach API calls, prompts, ASR, or TTS code. Learn pacing and multimodal Q&A belong to the shared runtime; Topic authoring supplies only reviewed action truth and teaching copy.
- Never implement a new Topic through `ExerciseRuntimeSpec`, a primitive switch, `RuntimeActionEvent.value`, a legacy Topic frame, or a fallback that reconstructs actions from `steps`.
- Do not confuse Action Runtime v2 with action `version: 2`: reuse the registered `kind@version`, often `@1`, inside the v2 runtime model.
- Never put expected objects, order, values, results, coach truth, or completed SolutionBoard content into Assessment payloads.
- Require frontend preview commands and backend canonical commands to project equivalent persistent diagram effects.
- Put segment values, shares, correspondence marks, and emphasis on the diagram through domain commands, not in an abstract interaction panel.
- Keep entity IDs stable across actions. Explicitly test overlapping whole/part segments and shared endpoints.
- Store complete reviewed SolutionBoard snapshots as backend-owned question context. Never let an Action concatenate proof prose, carry `boardTargets`, or emit board commands.
- Never treat a list of action captions or generated per-Action phrases as a complete solution. Assemble the reviewed teacher document in order and review it as one continuous mathematical write-up.
- Never mark a Topic `implemented` while the complete solution contains UI verbs, coach language, unexplained symbols, logical gaps, raw control text, unresolved placeholders, malformed delimiters, or a bare final value that does not answer the requested object.
- Require structural readiness to include required object selection and required answers; do not infer completion from arbitrary filled fields.
- Never edit generated bundles as the source of truth.
- Never accept a generated Topic record without authored `actionTemplates` and a reviewed `solutionBoard`; absence means legacy/incomplete authoring, not an optional shortcut.
- Never mark a Topic verified when a required mode, action, persistence path, or visual gate fails.

## Resources

- [references/architecture-contract.md](references/architecture-contract.md): current repository seams, action catalog, truth boundaries, and generated artifacts.
- [references/topic-blueprint.md](references/topic-blueprint.md): how to fill the blueprint and make reuse/extension decisions.
- [references/new-action-capability.md](references/new-action-capability.md): handoff contract to the dedicated new-Action skill.
- [references/acceptance-checklist.md](references/acceptance-checklist.md): release gates and browser walkthrough.
- [references/solution-writeup-review.md](references/solution-writeup-review.md): complete-solution assembly, formal mathematical writing rubric, and required review output.
- [assets/topic-blueprint.template.md](assets/topic-blueprint.template.md): blueprint handoff template.
- `scripts/validate_topic_blueprint.py`: deterministic blueprint structure and state validator.
- `scripts/validate_generated_topic_v2.py`: deterministic generated bundle, ActionTemplate, and SolutionBoard binding gate.
- `scripts/assemble_topic_solutions.py`: deterministic first/middle/last complete SolutionBoard assembly for semantic review.
