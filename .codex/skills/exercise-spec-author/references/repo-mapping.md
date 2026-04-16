# Repo Mapping

Use this file only for `Appendix A. Repo Mapping`.

## Purpose

Map the `skill-unit`, `example`, or `exercise-pack` spec to current repo concepts without turning the main spec into implementation notes.

## Current Mapping Targets

### `Skill Unit Mapping`

Capture:
- the primary `skill-unit` name
- the observable mastery evidence
- the likely paired `example` or `exercise-pack`
- whether the unit already maps cleanly to a current runtime shape or is still pedagogical-only

### `TaskDefinition`

Capture:
- candidate task title
- one-sentence summary
- whether it is closer to product-facing `example` or `exercise-pack`
- difficulty
- likely `engineKind`
- likely `contentId` naming direction

### `ContentDefinition`

Capture:
- prompt template direction
- expected hint level
- scene kind
- completion policy
- guide step titles and summaries
- feedback tone and cue expectations

### Runtime Notes

Capture:
- dominant learner action as current runtime actions such as `select`, `input`, `submit`, `clear`
- whether the delivery object looks like one step, multi-step, or a short pack
- what correctness must inspect
- what learner-visible variables are randomized or fixed

## Current Repo Anchors

Useful real anchors in this repo:
- `meaning` maps to ordered edge selection
- `ratioToSide` maps to side-value placement
- `guidedSolve` maps to multi-step triangle derivation
- `demoCounter` maps to single custom input

Current terminology note:
- Current implementation and route names still use `practice`.
- In the main spec body, prefer the product terms `example`, `exercise-pack`, and `skill-unit`.
- Mention `practice` only in Appendix A when you need to point to an existing code path or runtime contract.

## Repo Mapping Rules

- Keep mapping concrete but lightweight.
- Suggest, do not over-prescribe, exact code changes.
- Do not invent new shared contract fields unless the spec already concluded `new-tool-needed`.
- If the spec kind is `skill-unit` and there is no direct runtime mapping yet, say that explicitly instead of forcing a fake `TaskDefinition`.
- If fit is `stretch` or `new-tool-needed`, say which existing parts remain reusable.