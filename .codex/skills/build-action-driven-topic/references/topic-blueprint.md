# TopicBlueprint authoring guide

Use the template in `assets/topic-blueprint.template.md`. The blueprint is the approval boundary between content analysis and implementation.

## Source analysis

Read only approved/final teaching explanations and ready banks. Record exact source paths, source question IDs, assignments, and diagram assets. Do not silently substitute a similar artifact when a required source is missing.

Preserve the approved teaching sequence. Analyze how each step becomes an operation; do not invent new objectives or rewrite the pedagogy merely to fit existing actions.

## Action disposition

For each teaching step, first search the current registry and a similar Topic.

Use `Reuse kind@version` when the difference can be expressed through input data, private truth, presentation metadata, coach text, board targets, or diagram entities.

Use `ExtendRuntime capability-name` only when the learner must perform a distinct operation or the runtime lacks a required persistent effect. Describe the missing capability without preselecting an implementation.

One source step may own multiple actions. Use this when a single teaching sentence contains independently undoable operations or a server submission boundary, such as constructing a parallel relation and then constructing its carrier/intersection.

## Required action row

Each row must make these fields reviewable:

| Field | Required decision |
| --- | --- |
| Source step | Exact explanation step or source fragment |
| Disposition | `Reuse kind@version` or `ExtendRuntime capability-name` |
| Goal | One learner-observable outcome |
| Public input | Available objects, counts, slot shape, public labels |
| Private truth | Expected objects/order/values/result |
| Evidence | Exact typed evidence payload |
| Diagram effect | Preview and persistent world effect |
| Board effect | Expression and semantic slot roles |
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

Write the teacher document as ordered expression templates. For each expression record:

- owner source step and owner action IDs;
- learner-visible prose/math template;
- unique slot IDs;
- action semantic role to slot mapping;
- allowed modes;
- completion boundary.

The template must remain incomplete until the learner provides the corresponding evidence. A static final `expectedLatex` row is not a substitute for a slot-based expression.

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
