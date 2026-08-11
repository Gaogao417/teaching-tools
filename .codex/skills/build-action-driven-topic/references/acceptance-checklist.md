# Topic acceptance checklist

Read this only after implementation reaches `implemented`.

## Source and generated structure

- Blueprint binds `runtime_model: action-runtime-v2`, bundle schema v2, and required SolutionBoard.
- Generated bundle root schema is exactly `teaching-tools/topic-scenario-bundle/v2`.
- First, middle, and last records each contain non-empty authored `actionTemplates` and a complete reviewed static `solutionBoard`.
- Projected plans use the current `ACTION_RUNTIME_PLAN_VERSION`; no fixture or endpoint pins an obsolete plan number.
- No new Topic path uses `ExerciseRuntimeSpec`, primitive dispatch, `RuntimeActionEvent.value`, or action reconstruction from legacy steps.
- Every teaching step maps to the recorded approved explanation.
- Every enabled bank record preserves source bank, assignment, question ID, stem, diagram, accepted answer, and diagnosis.
- First, middle, and last records materialize successfully.
- All `kind@version` values exist in the frontend registry.
- Every geometry, source step, SolutionBoard owner action, and expression reference resolves; no Action contains a board target.
- Generated counts and IDs are stable across a second importer run, apart from approved generation metadata.
- `topicScenarioBundle.json` was generated, not hand-edited.

## Truth and mode boundaries

- Learn may receive authorized database-backed SolutionBoard contexts.
- Practice sends typed evidence to backend evaluation and preserves correct prior work after a rejected action.
- Assessment contains no expected values, expected objects/order, accepted answers, coach truth, or SolutionBoard context.
- Public counts and interaction shape remain sufficient for Assessment completion.
- Review reads persisted evaluation rather than recomputing truth in the frontend.

## Action-by-action behavior

For every action, verify:

- the instruction describes only the current operation;
- enabled objects are correct and duplicates cannot be selected;
- selection order and maximum count match the blueprint;
- required inputs appear at the right time and focus correctly;
- structural readiness requires both object selection and required answers;
- wrong selection identifies the clicked object and gives an actionable correction without leaking unrelated answers;
- editing produces the approved preview;
- confirmation persists the same effect;
- the next action retains required prior effects;
- BACK and CLEAR remove exactly the intended uncommitted effects.

## Geometry quality

- Values and shares appear on the corresponding segment, not in a separate abstract panel.
- Correspondence marks and emphasis are legible and do not obscure labels.
- Constructed points and lines remain hidden until created.
- Whole/part collinear segments select correctly near each intended midpoint.
- Shared endpoints prioritize points when the action expects a point.
- Derived and authored geometry do not create misleading duplicate visible lines.
- Desktop and narrow widths retain a usable diagram viewport.

## SolutionBoard quality

- The TopicBlueprint contains assembled first, middle, and last canonical solutions, a finding/revision/disposition table, and final revised solution text.
- Each assembled solution comes from reviewed question-bank solution steps, not Action-kind prose generation or disconnected `expectedLatex` fragments.
- The formal review verdict is `pass`, blocking issues remaining is `0`, and every suggested revision has an explicit disposition.
- The board reads as one formal solution beginning with `解：`, not an action log.
- Chinese prose uses document typography; mathematical notation renders correctly.
- Each Action context is a complete immutable board projection authorized for its mode and stage.
- Guided Practice advances from the stored `enter` projection to the stored `accepted` projection only after backend acceptance and never exposes a later result.
- Restoring a session reproduces the same diagram world and authorized board context.
- No nested math delimiters, raw LaTeX control text, duplicate punctuation, or action jargon is visible.
- The final result includes the requested mathematical object, not only a bare number or ratio.
- The reasoning is mathematically sufficient: constructions are introduced, premises precede conclusions, theorem/relation use is identifiable, symbols keep one meaning, and no essential inference is skipped.

## Browser walkthrough

Use the real local page and walk:

1. first action to final action on the correct path;
2. wrong object, wrong value, correction;
3. BACK within an action and across an empty next action;
4. CLEAR for the current source-step group;
5. refresh/checkpoint restore where supported;
6. first, middle, and last bank records;
7. desktop and narrow width;
8. keyboard focus and accessible names for inputs and primary controls.

Restart the backend after importer output changes before taking screenshots or accepting results.

## Required commands

Run commands with the stated working directory; do not combine them into one opaque shell chain.

| Working directory | Command |
| --- | --- |
| repository root | `python3 .codex/skills/build-action-driven-topic/scripts/validate_generated_topic_v2.py web/backend/src/content/topicScenarioBundle.json --task-id <topic-id>` |
| repository root | `python3 .codex/skills/build-action-driven-topic/scripts/assemble_topic_solutions.py web/backend/src/content/topicScenarioBundle.json --task-id <topic-id>` |
| `web/backend` | `npm run import:topics` |
| `web/backend` | `npm test` |
| `web/frontend` | `npm test` |
| `web/frontend` | `npm run build` |

Run additional focused tests for new capabilities and importer rules.

## Verification evidence

Record:

- commands and results;
- exact Topic and sample record IDs;
- actions exercised;
- modes exercised;
- screenshots or browser states inspected;
- assembled first/middle/last solutions, formal review findings, suggested revisions, and dispositions;
- intentionally deferred non-required checks and why.

Keep status `implemented` if any required check fails. Set `verified` only when all gates pass.
