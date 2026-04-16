---
name: exercise-spec-author
description: Design or revise stable learning specs for the teaching-tools repo. Use when turning a rough teaching idea into a reusable skill unit, a guided example, or a lower-hint exercise pack, checking fit against current tools, and producing a reviewable Markdown spec with repo-mapping notes and tooling-gap flags.
---

# Exercise Spec Author

## Overview

Despite the name, this skill now authors three related spec kinds for the repo:

- `skill-unit`: a reusable method step the system can teach, observe, and later drill
- `example`: a high-hint, guided example that teaches one primary `skill-unit`
- `exercise-pack`: a lower-hint short practice set assembled around weak `skill-unit`s, wrong work, and student choice

Work in two phases: identify the right spec kind and minimum authoring form, then produce a Markdown spec that teaching, product, and engineering can all review.

Read only the references you need:
- Read [references/current-prototypes.md](references/current-prototypes.md) before choosing an interaction shape for an `example` or `exercise-pack`.
- Read [references/pedagogy-and-ux.md](references/pedagogy-and-ux.md) before finalizing hint level, feedback, and visibility rules.
- Read [references/repo-mapping.md](references/repo-mapping.md) when writing `Appendix A. Repo Mapping`.
- Copy the output structure from [assets/exercise-spec-template.md](assets/exercise-spec-template.md). The filename is historical; the template now supports all three spec kinds.

## Workflow

1. Determine whether the user needs a `skill-unit`, an `example`, an `exercise-pack`, or a recommended sequence of them.
2. If the user asks for an `example` or `exercise-pack`, identify the primary `skill-unit` before choosing interaction details.
3. Identify the best current prototype before inventing a new interaction. Do this only for `example` and `exercise-pack` specs.
4. Collect the minimum authoring form. Reuse any details the user already supplied.
5. Ask only the smallest set of follow-up questions needed to make the spec decision-complete. Stop at 5 follow-ups.
6. Judge fit as `supported`, `stretch`, `new-tool-needed`, or `not-applicable`.
7. Produce the spec using the template in `assets/exercise-spec-template.md`.
8. If fit is `stretch` or `new-tool-needed`, include `Appendix B. Tooling Gap` and explicitly name the missing capability.

## Minimum Authoring Form

Collect these required fields first for every spec:
- `spec_kind`: `skill-unit` | `example` | `exercise-pack`
- `working_title`
- `grade_band`
- `topic_or_chapter`
- `target_concept`
- `primary_skill_unit`
- `skill_unit_goal`
- `observable_learning_goal`
- `student_action`: `select` | `input` | `ordered-select` | `multi-step-input` | `unsure`
- `prompt_seed`
- `success_condition`
- `likely_misconception`

Collect these additional required fields when `spec_kind` is `example` or `exercise-pack`:
- `learning_mode`: `example` | `exercise`
- `preferred_prototype`: `triangle-role-selection` | `triangle-value-placement` | `triangle-guided-derivation` | `single-input-custom` | `unsure`
- `hint_level`: `high` | `medium` | `low` | `unsure`
- `primary_workspace_object`

Collect these additional required fields when `spec_kind` is `exercise-pack`:
- `exercise_pack_source_priority`

Collect these optional fields only when they matter:
- `difficulty`
- `estimated_minutes`
- `prerequisite_knowledge`
- `related_skill_units`
- `mastery_evidence`
- `variable_space`
- `acceptable_equivalents`
- `feedback_tone`
- `must_remain_visible`
- `max_step_count`
- `pack_size`
- `student_choice_policy`
- `teacher_notes`

## Follow-Up Rules

Ask follow-ups only when one of these is still unclear:
- The primary `skill-unit` is unclear or too broad to observe.
- The spec kind should really be `example` instead of `exercise-pack`, or vice versa.
- The learning goal is not observable in student behavior.
- The chosen action does not match the preferred prototype.
- The correctness condition is incomplete or ambiguous.
- The misconception does not explain what feedback should correct.
- A UI visibility rule conflicts with the current workspace constraints.

When asking, prefer short targeted questions over brainstorming prompts.
If the user gives a broad teaching idea, convert it into the form fields instead of asking them to restate the whole idea.

## Fit Decision Rules

- `supported`: The current prototype can deliver the core learner action, evaluation, and visibility constraints of the `example` or `exercise-pack` without new runtime capability.
- `stretch`: A prototype can approximate the delivery object, but only with notable pedagogy or UX compromises. Name those compromises.
- `new-tool-needed`: The delivery object requires a new interaction primitive, new visible object type, or a workspace flow the current tools cannot express cleanly.
- `not-applicable`: Use this for pure `skill-unit` specs that are not yet being mapped to a specific runtime delivery shape.

Never mark an `example` or `exercise-pack` as `supported` if the core mathematical object would be hidden, overloaded, or approximated in a misleading way.

## Output Rules

Produce exactly one Markdown spec with a YAML frontmatter block.
Use the product terms `skill unit`, `example`, and `exercise pack` in the main body. Put implementation names such as `practice` only in `Appendix A. Repo Mapping` when needed.
Keep the main body pedagogical and interaction-focused. Put repo-specific implementation notes only in `Appendix A. Repo Mapping`.
Do not emit DOM structure, CSS classes, or pixel layout instructions.
Use concrete, teacher-readable language. Avoid abstract DSL language in the main body.
Keep one primary learner action per step.
Every `example` and `exercise-pack` must name one primary `skill-unit`.
If a spec touches multiple `skill-unit`s, name one primary unit and treat the rest as supporting units.
`exercise-pack` specs should describe a short purposeful pack, not an endless drill stream.
Keep `likely_misconception` and the feedback plan tightly coupled.

## Review Standard

Before finalizing, check all of the following:
- The spec kind is explicit.
- The primary `skill-unit` is explicit and reusable.
- The spec teaches one clear observable outcome.
- The selected prototype matches the dominant learner action when a prototype is applicable.
- The workspace protects the core mathematical object from being obscured when a workspace is applicable.
- Feedback names the student error, not just the final answer state.
- The appendix can map the idea to current repo concepts without inventing new hidden fields.

## Validator

Use `scripts/validate_exercise_spec.py <path-to-spec.md>` when the user asks for a quality check or when you generated a spec file on disk. The script name is historical; it now validates all spec kinds produced by this skill.

## Example Requests

- "Turn this rough method step into a reusable skill-unit spec."
- "Help me choose the best current prototype before we write the example spec."
- "Rewrite this draft into a low-hint exercise-pack spec and tell me whether it is supported or new-tool-needed."