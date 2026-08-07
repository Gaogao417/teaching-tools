# Acceptance checklist

Use this reference only after implementation is complete.

## Content traceability

- Verify that every Learn step maps to the recorded explanation source.
- Verify that enabled practice questions preserve question ID, stem, diagram, answer, and source assignment.
- Verify that missing or invalid source assets fail visibly rather than silently substituting unrelated content.

## Experience behavior

- Walk every branch in the user flow diagram.
- Verify every interaction-rule row against the running interface.
- Verify every page-state row, including incomplete, correct, wrong, completion, failure, and recovery states.
- Verify that wrong submissions preserve previously correct mathematical work.
- Verify that Learn and Practice use the approved shared mathematical object and evaluation truth.
- Verify that Review presents persisted evaluation rather than recalculating correctness in the frontend.

## Coaching quality

- Verify every approved coach-script row against the running interface and its exact trigger.
- Verify that each explanation states the student's existing result, mathematical basis, complete derivation, interpretation, and next action without a logical jump.
- Verify that ratio direction, corresponding-object order, and numerator/denominator roles remain consistent throughout the explanation.
- Verify per-blank assistance: the highlighted slot matches the spoken or written hint, correct prior slots remain intact, and the coach never auto-fills the student's required work.
- Verify one verbal outlet: task directions, teacher explanation, correct confirmation, and error repair replace one another in the fixed coach bubble; no step strip, action copy, toast, or correction card repeats them.
- Verify task counting: teacher-only explanation is not numbered as a student task and is not converted into a click or input solely to fit the flow.
- Verify that source-defined teacher explanation is not silently converted into a question, and that generic phrases do not replace actionable guidance.

## Runtime and persistence

- Test session start, action submission, step progression, finish, result query, and restore.
- Test repeated submission and stale or expired session behavior when relevant.
- Add or update focused backend tests for new evaluation and transition logic.
- Confirm that existing engines and old result snapshots remain usable when shared contracts change.

## Frontend quality

- Run the frontend typecheck/build.
- Test the complete learner path at desktop and narrow-screen widths.
- Test primary actions with keyboard alone and confirm useful accessible names and focus behavior.
- Check that loading, empty, and error states do not collapse the page shell.
- Check for unintended visual regressions in shared Learn, Practice, and Review surfaces.

## Completion evidence

Record the commands run, focused scenarios exercised, and any intentionally deferred non-required checks in the specification. Keep status `implemented` if a required check fails. Set `verified` only after all required checks pass.

Do not add deployment, rollout, operations, or analytics checks unless the user explicitly requests them.
