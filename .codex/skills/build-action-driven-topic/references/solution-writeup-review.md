# Complete solution write-up review

Read this at the end of Phase 2. Review the complete database-bound SolutionBoard as a formal mathematical solution, not as UI copy.

## Assemble from reviewed question-bank truth

1. Select the generated first, middle, and last records.
2. Read the complete reviewed SolutionBoard expressions compiled from the question bank's `solution_steps`.
3. Render the heading and expressions in document order; do not inspect Action kind, infer parameter order, or reconstruct proof prose from arbitrary inputs.
4. Verify each Action's database snapshot is a complete authorized prefix of that same document, never a separately authored fragment.
5. Fail on empty expressions, unresolved `{{slot}}` placeholders, Action/UI language, or snapshots that diverge from the reviewed document revision.

Use `scripts/assemble_topic_solutions.py` to perform deterministic document assembly. Treat its mechanical findings as inputs to the review, not as a substitute for mathematical judgment.

## Blocking review rubric

Require all of the following before `pass`:

- **Answer correctness:** the final statement matches the private answer key and names the exact object requested by the stem, including units, interval, ratio orientation, or conditions when applicable.
- **Logical sufficiency:** every essential conclusion has a stated premise or recognizable theorem/relation; constructed points and lines are introduced before use; no circular or invalid implication appears.
- **Truth attribution:** use “由题意” only for facts explicitly present in the stem. Introduce derived lengths, shares, ratios, parallel consequences, and similarity conclusions with their actual relation or theorem; “在图中标出” is not a derivation.
- **Symbol discipline:** one symbol has one meaning; point/segment/angle notation is consistent; equality, ratio, congruence, similarity, and parallel symbols are used in the right semantic role.
- **Continuous exposition:** the text begins with `解：` and reads as one solution. It must not look like action titles, an interaction transcript, a checklist, or disconnected answer fragments.
- **Formal language:** remove “点击”“输入”“选择按钮”“当前动作”“系统会”“告诉老师”等 UI/coach wording. Prefer concise mathematical transitions such as “作…”, “由…得…”, “因为…所以…”, and “因此…”.
- **Typesetting:** keep prose outside math delimiters and notation inside appropriate delimiters; remove nested `$$`, raw unresolved control text, malformed fractions, repeated punctuation, mixed full/half-width punctuation, and unmatched delimiters.
- **No leakage artifact:** no slot ID, action ID, opaque runtime entity ID, placeholder, debugging label, or accepted-answer encoding is visible.

Any failure above is blocking. Fix the authoring source, regenerate, reassemble, and review again.

## Polish review

After blocking issues are zero, suggest improvements for:

- redundant or repetitive sentences;
- vague referents such as “它”“这个比”;
- steps that are correct but too compressed for the target grade;
- overlong explanations that obscure the core relation;
- inconsistent textbook terminology or punctuation style;
- a final conclusion that could more clearly echo the stem.

Record every suggestion even when it is not applied. Use one disposition: `Applied`, `Rejected with reason`, or `Requires approval`.

## Change authority

- Apply typography, punctuation, explicit-subject, and non-semantic formal-writing fixes directly.
- Return the TopicBlueprint to `draft` before changing the approved mathematical strategy, action order, source teaching meaning, or mode behavior.
- If a suggestion is optional pedagogy rather than a correctness fix, present it to the user and leave an explicit disposition.

## Required review output

Under `Complete solution review` in the TopicBlueprint, include:

1. first, middle, and last scenario ID, stem, answer-key result, and assembled solution;
2. a table with `Original fragment`, `Review dimension`, `Finding`, `Suggested revision`, and `Disposition`;
3. the final revised continuous solution for each representative pattern;
4. exact `Review verdict: pass` and `Blocking issues remaining: 0` only when true.
