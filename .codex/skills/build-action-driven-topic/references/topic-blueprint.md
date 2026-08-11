# TopicBlueprint authoring guide

Use the template in `assets/topic-blueprint.template.md`. The blueprint is the approval boundary between content analysis and implementation.

## Source analysis

Read only approved/final teaching explanations and ready banks. Record exact source paths, source question IDs, assignments, and diagram assets. Do not silently substitute a similar artifact when a required source is missing.

Preserve the approved teaching sequence. Analyze how each step becomes an operation; do not invent new objectives or rewrite the pedagogy merely to fit existing actions.

## Action disposition

For each teaching step, first search the current registry and a similar Topic.

Use `Reuse kind@version` when the difference can be expressed through input data, private truth, presentation metadata, coach text, reviewed solution context, or diagram entities.

Use `ExtendRuntime capability-name` only when the learner must perform a distinct operation or the runtime lacks a required persistent effect. Describe the missing capability without preselecting an implementation.

One source step may own multiple actions. Use this when a single teaching sentence contains independently undoable operations or a server submission boundary, such as constructing a parallel relation and then constructing its carrier/intersection.

## Required action row

Each row must make these fields reviewable:

| Field | Required decision |
| --- | --- |
| Source step | Exact explanation step or source fragment |
| Disposition | `Reuse kind@version` or `ExtendRuntime capability-name` |
| Goal | One learner-observable outcome |
| Public input | Available objects, counts, input shape, public labels |
| Private truth | Expected objects/order/values/result |
| Evidence | Exact typed evidence payload |
| Diagram effect | Preview and persistent world effect |
| Solution visibility | Reviewed proof rows visible after acceptance |
| Submit boundary | Local advance, source-step submit, or group boundary |
| Mode behavior | Learn, Practice, Assessment differences |

If any effect column says “none”, confirm that the action is intentionally non-effectful rather than unfinished.

## Geometry contract

List every point, segment, derived output, and teaching mark referenced by the action rows. Include:

- stable ID and learner-facing name;
- authored versus runtime-derived ownership;
- first action where it becomes visible;
- overlapping carrier or subsegment relationships;
- intended click area for ambiguous geometry;
- whether it must persist across subsequent actions.

Do not approve a blueprint that asks the learner to select an entity absent from the geometry model.

## SolutionBoard contract

Write the teacher document as ordered, complete expressions sourced from the reviewed question-bank solution. For each expression record:

- owner source step and owner action IDs;
- learner-visible complete prose/math;
- allowed modes;
- completion boundary.

The Action does not fill, concatenate, or own these expressions. Publishing materializes complete per-Action `enter`/`accepted` snapshots in the database, and the backend sends only the authorized snapshot as Action context. A generated action-log sentence is not a substitute for a reviewed proof row.

## Complete solution review contract

At the end of implementation, concatenate the reviewed expressions in document order and verify their stored per-Action snapshots. Review first, middle, and last generated records as complete mathematical solutions, not as action fragments.

Record in the blueprint:

- scenario ID, stem, answer-key result, and assembled solution for each sample;
- one review row for every detected defect or polish opportunity;
- a concrete revision and disposition for each row;
- the final revised continuous solution;
- `Review verdict: pass` and `Blocking issues remaining: 0` only after regeneration confirms the fixes.

Do not approve a solution containing unresolved placeholders, UI or coach language, unexplained symbols, invalid implications, missing conditions, raw LaTeX controls, malformed punctuation, or a final value that does not name the requested object.

## Question-bank compilation

Record:

- source bank and assignment;
- expected record count;
- extraction rules;
- accepted answer normalization;
- diagram source and geometry derivation;
- first, middle, and last sample IDs;
- invalid-record behavior.

Require failures to be visible. Do not silently drop or replace records solely to reach a target count.

## Approval decisions

End the draft with only decisions that materially alter runtime capability, teaching flow, source selection, or mode behavior. Do not ask the user to confirm routine implementation details already fixed by the architecture contract.

After approval, treat action order, effects, board document, mode boundaries, and source mapping as contracts. Return to `draft` if implementation must change them materially.
