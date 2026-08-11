# Action Runtime v2 contract

Treat paths as repository-relative and inspect the current code before editing.

## Mandatory binding

Action Runtime v2 means:

- offline authoring emits opaque `AuthoredActionTemplate[]`;
- backend projects a versioned `ExercisePlan` without reconstructing per-kind input;
- frontend dispatches only through `kind@version` in `ActionMachineRegistry`;
- machines emit typed `ActionEvidence`;
- frontend preview and backend acceptance emit equivalent persistent diagram commands;
- `WorldProjection` replays diagram effects only;
- the backend projects complete database-owned `solutionBoardContext` snapshots separately from the Action world;
- Assessment receives public structure but no teaching truth or SolutionBoard context.

Reject `ExerciseRuntimeSpec`, `RuntimeActionEvent.value`, primitive switches, free-form answer strings, legacy Topic frames, and reconstruction from `steps[].primitive`.

## Version domains

| Domain | Authority | Rule |
| --- | --- | --- |
| Product model | ADR-004 and current v2 runtime code | Always Action Runtime v2 |
| Plan schema | `ACTION_RUNTIME_PLAN_VERSION` in `web/shared/actionRuntime.ts` | Read the constant; never assume it equals 2 |
| Bundle schema | `TopicScenarioBundle` in `web/shared/topicPractice.ts` | Must remain `teaching-tools/topic-scenario-bundle/v2` |
| SolutionBoard schema | `SOLUTION_BOARD_SCHEMA_VERSION` in `web/shared/solutionBoard.ts` | Use the current constant |
| Action contract | registry key `kind@version` | Start a new kind at 1; bump only for incompatible semantics |
| Content/scenario identity | task/content/scenario records | `.v1` suffix is unrelated to runtime architecture |

## Contract ownership

| Concern | Authority |
| --- | --- |
| Action envelope, union, evidence, plan | `web/shared/actionRuntime.ts` |
| Persistent diagram commands and replay | `web/shared/actionWorld.ts` |
| SolutionBoard document, immutable context, and projection | `web/shared/solutionBoard.ts` |
| Diagram effect batches | `web/shared/actionEffects.ts` |
| Machine interface and shared projection helpers | `web/frontend/src/action-runtime/actions/actionDefinition.ts` |
| Action machines | `web/frontend/src/action-runtime/actions/` |
| Registry and per-kind input validation | `web/frontend/src/action-runtime/registry.ts` |
| Page sequencing, draft/commit, BACK/CLEAR | `web/frontend/src/action-runtime/pageRuntime.ts` |
| Workspace projection | `web/frontend/src/action-runtime/projectWorkspaceView.ts` |
| Typed private evaluation | `web/backend/src/services/actionRuntime/topicTypedEvaluator.ts` |
| Mode projection/redaction | `web/backend/src/services/actionRuntime/topicPlanProjector.ts` |
| Question solution revision and Action snapshot storage | `web/backend/src/repositories/questionSolutionRepository.ts` |
| Generic Topic authoring | `web/backend/scripts/lib/topicActionTemplateAuthoring.ts` |
| Bundle generation | `web/backend/scripts/import-topic-artifacts.mjs` |
| Production diagram renderer and hit-test | `web/frontend/src/geometry/` |

## SolutionBoard isolation

SolutionBoard is reviewed question content, not reusable Action behavior. The question bank owns one complete formal solution. Publishing stores immutable per-Action/mode/stage projections in `question_solution_revisions` and `question_action_solution_boards`; the backend sends the authorized projection as `solutionBoardContext`.

An Action capability must not author, concatenate, preview, validate, or persist proof prose. Its contract, machine, evidence, evaluator, and effect batch contain no `boardTargets`, board slots, or board commands. The shared page may display the context associated with the current `actionId`, but the capability does not interpret that content.

Capability tests must verify isolation: diagram preview/evaluation remains deterministic when no solution context exists, and an authorized context passes through unchanged when present. Assessment contains no context.

## Effect invariant

For the same accepted evidence, frontend and backend must produce semantically equal persistent diagram effects. Command IDs must be stable, commands deterministic, and replay idempotent at the batch/session boundary. A refresh after acceptance must reproduce the visible diagram marks; the backend independently restores the authorized immutable SolutionBoard context.
