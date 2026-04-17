# Pedagogy and UX Checks

Use these checks before finalizing any `skill-unit`, `example`, or `exercise-pack` spec.

## Pedagogy

- Define one primary `skill-unit` per spec. Supporting units are allowed, but they should not compete with the primary one.
- Make the learning goal observable in student action, not just in teacher intention.
- Teach one dominant concept per spec.
- Keep one primary action per step.
- Tie every error state to a likely misconception.
- Distinguish “student did not know what to do” from “student chose the wrong mathematical relation.”
- Prefer concrete success evidence such as selection order, value placement, or final expression, not vague claims like “understands the concept.”
- Let `example` teach with stronger scaffolding and clearer intermediate visibility.
- Let `exercise-pack` check and reinforce with fewer hints than the paired `example`.

## Workspace UX

- Keep the core mathematical object visible at all times.
- Use the workspace for the persistent mathematical object and direct manipulation of that object.
- Prefer guide-step ownership for step-local text entry, intermediate explanations, and short answer collection unless the input is itself anchored to the visible object.
- Do not place controls over the main geometry unless the control is itself the point of the interaction.
- Reduce split attention: the student should not hunt for the next input location, but this does not require every input to live in the workspace.
- Preserve stable landmarks across steps whenever the math object stays the same.
- Make the current target explicit in wording and visually nearby context.
- Do not invent a second workspace just because an `exercise-pack` is lower hint; lower hint should usually mean less guide copy, not a different object model.
- Do not normalize exercise-local sidebars or form panels as the default way to deliver multi-step inputs.

## Feedback

- Give immediate feedback after a meaningful action, not only at the end of the whole exercise.
- Name the error in learner language when possible.
- Prefer corrective feedback that helps the next attempt.
- Avoid purely decorative celebration if the student still does not know what changed.
- `example` feedback may be more corrective and next-step oriented.
- `exercise-pack` feedback may be shorter, but it still needs to name the mathematical error rather than only marking the answer wrong.

## Red Flags

If any of these are true, reconsider the spec:
- The learner goal cannot be inferred from the output.
- Two different mathematical ideas are being tested in one step.
- The guide/workspace ownership split is left implicit.
- The exercise depends on hiding, overlaying, or cropping the core diagram.
- The current prototype only fits if the wording becomes misleading.
- The `skill-unit` is too broad to observe or drill.
- `example` and `exercise-pack` differ only by name, not by hint level or role.
- The `exercise-pack` behaves like an endless drill stream instead of a short purposeful set.
- The spec is only implementable by pushing generic step-form UI into the workspace.
