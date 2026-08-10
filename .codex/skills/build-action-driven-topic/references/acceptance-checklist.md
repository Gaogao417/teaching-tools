# Topic acceptance checklist

Read this only after implementation reaches `implemented`.

## Source and generated structure

- Every teaching step maps to the recorded approved explanation.
- Every enabled bank record preserves source bank, assignment, question ID, stem, diagram, accepted answer, and diagnosis.
- First, middle, and last records materialize successfully.
- All `kind@version` values exist in the frontend registry.
- Every geometry, board slot, board target, source step, and action owner reference resolves.
- Generated counts and IDs are stable across a second importer run, apart from approved generation metadata.
- `topicScenarioBundle.json` was generated, not hand-edited.

## Truth and mode boundaries

- Learn may receive teaching truth and SolutionBoard.
- Practice sends typed evidence to backend evaluation and preserves correct prior work after a rejected action.
- Assessment contains no expected values, expected objects/order, accepted answers, coach truth, board targets, or SolutionBoard.
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

- The board reads as one formal solution beginning with `解：`, not an action log.
- Chinese prose uses document typography; mathematical notation renders correctly.
- The current expression is incomplete before learner evidence.
- Inputs fill only their mapped slots and never expose a later result.
- Completed expressions remain stable across actions and restore.
- No nested math delimiters, raw LaTeX control text, duplicate punctuation, or action jargon is visible.
- The final result includes the requested mathematical object, not only a bare number or ratio.

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
- intentionally deferred non-required checks and why.

Keep status `implemented` if any required check fails. Set `verified` only when all gates pass.
