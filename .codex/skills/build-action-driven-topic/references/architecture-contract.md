# Action-driven Topic architecture contract

Read this before drafting or implementing a Topic. Treat paths as repository-relative.

## What is stable

The shared Learn and Practice pages consume an `ExercisePlan`; they do not need Topic-specific screens. A Topic is authored offline and materialized into the shared Action Runtime.

```text
teaching-skills sources
  -> importer and Topic authoring
  -> actionTemplates + private answer key + SolutionBoard
  -> ExercisePlan projector
  -> frontend Action Page Runtime
  -> typed backend evaluation and committed world
```

## Current action catalog

Check `web/frontend/src/action-runtime/registry.ts` for the authoritative registered versions before proposing a new capability.

| `kind@version` | Learner operation | Persistent teaching effect |
| --- | --- | --- |
| `make-parallel@1` | Select a through-point and reference line | Construct a parallel relation |
| `intersect-carriers@1` | Select two carrier points | Construct carrier and intersection |
| `mark-segment-values@1` | Select segments and enter values | Put length/share labels on segments |
| `pair-segments@1` | Select ordered corresponding segments | Put paired correspondence ticks on the diagram |
| `ratio-scratch@1` | Select two segments and simplify a ratio | Put simplified shares on the diagram |
| `convert-collinear@1` | Select whole, target, and known segments | Emphasize the collinear relation |
| `enter-equation@1` | Select a known factor and enter equation values | Emphasize referenced geometry and fill the equation |
| `select-option@1` | Choose one authored option | Fill a board slot when configured |
| `enter-text@1` | Enter a final textual or mathematical result | Fill the canonical conclusion |

Different wording, labels, target IDs, expected values, or Topic content are data variations, not reasons to add a new action.

## Contract ownership

| Concern | Authoritative location |
| --- | --- |
| Topic/task types and geometry data | `web/shared/topicPractice.ts` |
| Action contracts, evidence, plans, mode payloads | `web/shared/actionRuntime.ts` |
| Persistent diagram commands | `web/shared/actionWorld.ts` |
| SolutionBoard slots and commands | `web/shared/solutionBoard.ts` |
| Frontend machines and projections | `web/frontend/src/action-runtime/actions/` |
| Action registry and per-kind input validation | `web/frontend/src/action-runtime/registry.ts` |
| Page sequencing, draft effects, undo and checkpoint | `web/frontend/src/action-runtime/pageRuntime.ts` |
| Diagram and board composition | `web/frontend/src/action-runtime/projectWorkspaceView.ts` |
| Production geometry renderer and hit-test | `web/frontend/src/geometry/` |
| Offline ActionTemplate and SolutionBoard authoring | `web/backend/scripts/lib/topicActionTemplateAuthoring.ts` |
| teaching-skills source registration and bundle generation | `web/backend/scripts/import-topic-artifacts.mjs` |
| Mode projection and answer redaction | `web/backend/src/services/actionRuntime/topicPlanProjector.ts` |
| Typed canonical evaluation and effects | `web/backend/src/services/actionRuntime/topicTypedEvaluator.ts` |
| Generated bundle | `web/backend/src/content/topicScenarioBundle.json` |

## Current registration seams

Until a dedicated Topic Manifest compiler replaces them, a new Topic may require coordinated updates to:

- `TopicPracticeTaskId` in `web/shared/topicPractice.ts`;
- task, catalog, and content registrations in `web/shared/tasks.ts`;
- importer `CONFIG` in `web/backend/scripts/import-topic-artifacts.mjs`;
- progression, capability, or challenge mappings when the approved Topic needs them;
- teaching-skills explanation and bank paths.

Record every applicable seam in the blueprint. Do not assume adding a source directory makes the Topic discoverable.

## Public and private truth

`AuthoredActionTemplate.input` is public structure. It may include:

- available entity IDs;
- required object count;
- pair count;
- factor-slot shape;
- learner-facing labels and placeholders that do not reveal the answer.

`teachingInput` or the private answer key owns:

- expected objects and ordering;
- correct values and equations;
- expected result;
- accepted answer variants;
- private diagnoses or canonical truth.

Learn may merge teaching truth for local instruction. Practice uses backend evaluation. Assessment must omit teaching truth, coach data, board targets, and SolutionBoard while retaining enough public structure to complete the interaction.

## Effect parity

For an effectful action, require this chain:

```text
editing context
  -> frontend preview command
  -> typed evidence
  -> optimistic completion command
  -> backend canonical command
  -> committed WorldProjection
```

Refreshing after acceptance must reproduce the same visible world. If the effect exists only in component state or only in the frontend projector, the contract is incomplete.

## Geometry rules

- Use stable semantic IDs across every action in a scenario.
- Store every segment that a learner must click or label, including subsegments.
- Separate opaque runtime output IDs from learner-facing names when appropriate.
- Do not display constructed answers before the construction action completes.
- Ensure every line references existing points when it becomes renderable.
- Include overlapping whole/part segments and shared endpoints in the hit-test plan.
- Persist teaching marks through domain commands so BACK, CLEAR, restore, and backend commit can replay them.

## SolutionBoard rules

- Author one continuous teacher document, not an action log or interaction card.
- Give every dynamic value a unique slot ID and map semantic roles through `boardTargets`.
- Reveal the current expression with empty slots; fill slots only from learner evidence.
- Complete an expression only when all required slots are filled.
- Keep Chinese prose in formal document typography and mathematical notation in KaTeX-compatible delimiters.
- Avoid nested `$...$` delimiters when a filled slot already contains math wrappers.

## Generated artifacts

Edit the importer, authoring source, or teaching-skills source. Regenerate `topicScenarioBundle.json`; never treat it as the editable source.

After generation, restart the backend before browser verification because imported JSON may remain cached in the running process.
