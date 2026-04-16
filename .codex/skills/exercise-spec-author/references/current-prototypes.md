# Current Prototypes

Use this file to decide whether a new `example` or `exercise-pack` fits the current repo without inventing a new abstraction too early.

For a pure `skill-unit` spec, `prototype_candidate` and `fit_level` may stay `not-applicable` until you also author the delivery object.

## `triangle-role-selection`

Best fit:
- Ordered selection of two edges or roles on one right triangle
- Meaning tasks such as "pick numerator first, denominator second"

Current strengths:
- Strong for edge recognition and ordered choice
- Keeps the triangle as the main visual object
- Clear guide/workspace split

Current limits:
- No typed value entry
- No rich branching or alternate solution paths
- Not a good fit for more than two ordered selections

Current repo examples:
- `meaning`

## `triangle-value-placement`

Best fit:
- Put numeric or symbolic side values onto AB / BC / AC
- Infer side lengths from a known trig ratio

Current strengths:
- Direct mapping from ratio to side-entry task
- Works when each side gets at most one value input

Current limits:
- Weak for formula composition
- Weak for proof-like reasoning or multiple dependent substeps
- Currently assumes triangle-side anchors are the main inputs

Current repo examples:
- `ratioToSide`

## `triangle-guided-derivation`

Best fit:
- Two- or three-step derivation on the same triangle
- Learner fills intermediate ratio, missing side, then final target expression

Current strengths:
- Supports progressive unlocking
- Good when all steps stay on the same underlying diagram
- Can separate intermediate computation from final formula

Current limits:
- Weak for multiple valid strategies
- Weak for symbolic transformations that need re-layout each step
- Current repo still mixes some formula layout concerns into the runtime projection

Current repo examples:
- `guidedSolve`

## `single-input-custom`

Best fit:
- Minimal diagnostic or platform-check tasks with one explicit input and submit

Current strengths:
- Very simple
- Useful for validating the generic runtime pipeline

Current limits:
- Not a serious math-teaching interaction by itself
- No rich geometry or multi-object workspace

Current repo examples:
- `demoCounter`

## Fit Heuristic

Choose `supported` only when:
- one current prototype matches the dominant learner action
- the mathematical object remains visible
- correctness can be judged without inventing a new runtime capability

Choose `stretch` when:
- a prototype almost fits but introduces notable pedagogy or UX compromise

Choose `new-tool-needed` when:
- the learner needs a new visible object type
- the task needs a new interaction primitive
- the task needs a different workspace flow, not just different content

Current repo note:
- The existing repo examples are closer to product-facing `example` delivery than `exercise-pack` delivery.
- `exercise-pack` should usually reuse the same core workspace object, but with less guide burden and a shorter, more diagnostic prompt style.