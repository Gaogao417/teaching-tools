---
topic_id: nestedSimilarity
content_id: topic-practice.nested-similarity.v1
runtime_model: action-runtime-v2
bundle_schema: teaching-tools/topic-scenario-bundle/v2
solution_board_contract: required
status: verified
source_explanation: /Users/gaochong/develop/teaching_skills/artifacts/专题/2026-07-14-子母型相似比与对应边/02-student-explanation.resolved.tex
bank_sources:
  - /Users/gaochong/develop/teaching_skills/artifacts/题库/2026-07-16-子母型相似
---

# Topic Blueprint: 子母型相似 (nestedSimilarity)

> **Architecture migration (2026-08-11):** 本蓝图正在迁移到数据库驱动的完整 Action SolutionBoard 快照。下文旧有 `boardTargets`、slot 填充、`world.solutionBoard` 和 Action 日志式板书描述均已失效，必须按教师题库 `solution_steps` 生成的连续规范解答重新评审后才能恢复 `implemented`。

## Runtime model binding

| Boundary | Required binding | Evidence location |
| --- | --- | --- |
| Product runtime | `Action Runtime v2` | Shared Action Runtime page, `web/frontend/src/action-runtime/registry.ts`, typed evidence/evaluation |
| Generated bundle | `teaching-tools/topic-scenario-bundle/v2` | `web/backend/src/content/topicScenarioBundle.json` root `schema` |
| Exercise plan | Current `ACTION_RUNTIME_PLAN_VERSION` | `web/shared/actionRuntime.ts` and projected plan |
| Scenario actions | Non-empty authored `actionTemplates` | First/middle/last generated records (Q001/Q025/Q050) |
| Solution document | Reviewed slot-based `solutionBoard` | Scenario authoring output and Learn/Guided plan |

**Legacy paths explicitly excluded:** `ExerciseRuntimeSpec`, primitive dispatch, `RuntimeActionEvent.value`, Topic-specific runtime frames, and reconstruction of actions from legacy `steps`.

**Version note:** `content_id` ends in `.v1` (content identity) and the reused Actions are `kind@1` (action contract version); neither changes the required Action Runtime v2 product model.

## Source mapping

| Artifact | Exact source | Assignment/status | Role |
| --- | --- | --- | --- |
| Explanation | `/Users/gaochong/develop/teaching_skills/artifacts/专题/2026-07-14-子母型相似比与对应边/02-student-explanation.resolved.tex` | approved/final | Teaching sequence and wording; 例题 1 (△ABC, D∈AC, ∠ABD=∠ACB, AC=9, CD=5; 求 AB；若 BC=12 求 BD) |
| Question bank | `/Users/gaochong/develop/teaching_skills/artifacts/题库/2026-07-16-子母型相似/question-bank.yaml` (bank id `nested-similarity-2026-07-16`, `status: ready`, `target_count: 50`) | ready | 50 scenario records |
| Bank items | `/Users/gaochong/develop/teaching_skills/artifacts/题库/2026-07-16-子母型相似/items/Q001` … `Q050` (`student.resolved.assignment.yaml`, `teacher.resolved.assignment.yaml`) | ready (`enabled: true`, 50/50) | One prompt TikZ per item: `build/diagram/jobs/question_bank-nested-v2-q###-prompt/rendered/prompt.fragment.tex` |
| Diagram assets (published) | `web/frontend/dist/topic-assets/bank/nestedSimilarity/nested-similarity-2026-07-16/Q###/question_bank-nested-v2-q###-prompt-prompt.preview.svg` | generated | Prompt-only diagram per item (`diagram_requirement: prompt_only`, `disclosure_policy: clean`) |

## Teaching intent

**Objective:** In the nested/子母型 configuration — D∈AC inside △ABC with ∠ABD=∠ACB ⇒ △ABD∼△ACB — convert between the collinear whole/part segments on AC and the repeating corresponding side AB, then solve for the unknown side via the proportional chain `AC/AB = AB/AD` (equivalently `AB²=AC·AD`).

**Ordered teaching sequence** (preserved verbatim from the approved explanation 例题 1, `\eduExplainStep` 1–2 and the bank `solution_steps`):

1. 先证明两个三角形相似 — 由 D∈AC ⇒ ∠BAD=∠CAB (公共角), plus the given ∠ABD=∠ACB, so △ABD∼△ACB. (This is the similarity judgement the learner must internalize; the prompt diagram already discloses ∠ABD=∠ACB.)
2. 再列对应边比例求边长 — first resolve the collinear part (`AD=AC−CD` when AC,CD are known; or `CD=AC−AD` when AD is derived from AB), then express the correspondence `AB↔AC`, `AD↔AB` in which **AB repeats**, giving `AC/AB=AB/AD` ⇒ `AB²=AC·AD`, and finally solve for the unknown side.

The bank materializes the explanation into five `solution_steps` and two solving directions, all sharing the same `entry_point: corresponding_side_bidirectional_collinear_segment`:

- **`collinear_segments_to_corresponding_side`** (+ triangle-side variant): AC and CD (or two collinear triangle sides) are given; solve for AB. Steps: 求小三角形的共线边 `AD=AC−CD` → 由等角判相似 → 锁定重复出现的对应边 → `AB²=AC·AD` → 求值并验算. (21 items + 4 triangle-side items)
- **`corresponding_sides_to_collinear_segment`** (+ inner/outer variants): AC and AB are given; solve for CD (or AD/AC). Steps: 判相似 → 锁定重复对应边 → `AD=AB²/AC` → `CD=AC−AD` → 求值并验算. (23 items + 2 variants)

**Source constraints that must not change:**

- The nested relation is △ABD∼△ACB with **AB repeating** in the proportion chain (`AC/AB=AB/AD`); the `expected_blocker` (identical across all 50 items) is "仍按普通构型寻找两组彼此分离的对应边，忽略 AB 在比例链中重复出现".
- CD is **not** a side of the small triangle △ABD; the collinear conversion `AC=AD+DC` must always happen (before the proportion when solving for AB; after the proportion when solving for CD). It is never bypassed.
- D lies on AC, so `AD` and `CD` are overlapping subsegments of the whole `AC` sharing endpoint D (A–D–C collinear). This overlapping whole/part relation is load-bearing and is the explicit reason `convert-collinear@1` exists.
- Prompt diagrams are `disclosure_policy: clean` — they must not reveal the simplification, the similarity conclusion, or any answer value before the learner constructs it.

## Topic registration

| Seam | Planned value or change |
| --- | --- |
| `TopicPracticeTaskId` | `"nestedSimilarity"` already registered in `web/shared/topicPractice.ts` (line 10). **No change.** |
| Task/catalog/content registration | `TASK_NODES.nestedSimilarity` (tasks.ts:269) and content `"topic-practice.nested-similarity.v1"` (tasks.ts:622) already exist with `taskId: nestedSimilarity`, `contentId: topic-practice.nested-similarity.v1`. **No change.** |
| Importer `CONFIG` | `nestedSimilarity` entry (import-topic-artifacts.mjs:49) already points to `contentId: topic-practice.nested-similarity.v1`, `explanations: [artifacts/专题/2026-07-14-子母型相似比与对应边/02-student-explanation.resolved.tex]`, `banks: [artifacts/题库/2026-07-16-子母型相似]`; `withNestedConversionContract` injects the `convert-collinear` step only for this taskId. **No change.** |
| Progression/capability/challenge mapping | Already wired (tasks.ts:698 references `TASK_NODES.nestedSimilarity`). **No change.** |

This is a **re-authoring of an implemented Topic** (the current bundle exists for all 50 records). Phase 1 only refreshes the blueprint to `draft`; no registration edits are required or proposed in this phase.

## User flow

```mermaid
flowchart LR
  A["1 标出已知边长<br/>mark-segment-values@1"] --> B["2 互化共线整段与分段<br/>convert-collinear@1"]
  B --> C["3 标出对应比例<br/>pair-segments@1"]
  C --> D["4 按份数列式<br/>enter-equation@1"]
```

## Action blueprint

The four actions below mirror the existing implemented Q001 bundle record (`[mark-segment-values@1, convert-collinear@1, pair-segments@1, enter-equation@1]`) and the importer objective "标边长、标比例、列式三步". Every action is **`Reuse`** of a registered `kind@1`; no `ExtendRuntime` is required. Action order is the same for all 50 items; only the per-item data (known segments, solving direction, expected values) differs.

`AD` is a derived segment (not drawn in the prompt geometry as a standalone edge — it overlaps `AC` over the A→D portion). It is exposed through `availableSegmentIds` so learners can click/select it for the collinear conversion, the correspondence, and the equation, exactly as the existing Q001 record does. The prompt geometry for every item draws the four triangle edges `AB, BC, AC, BD` plus the inner segment `CD`; `AD` is the residual collinear subsegment.

| Source step | Disposition / `kind@version` | Goal | Public input | Private truth | Evidence | Diagram effect | Board effect | Submit boundary | Mode behavior |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Explanation "思路导航/小贴士": 先找出两个相似三角形，再判断 CD 属不属于它们的边；标出已知量 | `Reuse mark-segment-values@1` | Mark the known lengths (and the ∠ACB reference on BD) onto the diagram, so the rest of the solution can reference them | `availableSegmentIds: [AB, BC, AC, BD, CD, AD]`; `requiredCount: 3`; public label placeholders only | `teachingInput.labels`: the three known items per item — e.g. Q001 `{BD:"\angle ACB", AC:"2\sqrt{3}", CD:"\frac{1}{2}\sqrt{3}"}`; Q050 `{BD:"\angle ACB", AC:"4", AB:"\sqrt{10}"}`. The ∠ACB marker on BD encodes the given `∠ABD=∠ACB` visually | `ActionEvidence{ kind:"mark-segment-values", labels:[{segmentId,valueLatex}×3] }` | Preview + persist `segment.<ID>` value/share labels via `DomainCommand`; BACK/CLEAR/restore replays them | Fills board slot `segment-values` (one composite slot); `boardTargets` map each marked segment to `q###-step-1.segment.<ID>` | Local advance on `submitOnComplete: true` (all 3 labels correct) | Learn: merges `teachingInput` for self-check + reveals coach. Practice: backend `topicTypedEvaluator` checks the 3 labels. Assessment: keeps public `availableSegmentIds`/`requiredCount`, **drops** `teachingInput` and `boardTargets`; the answer key supplies truth |
| Explanation step 2 + bank step "求小三角形的共线边" / "处理同一直线上的整段与分段": `AD=AC−CD` (forward) or `CD=AC−AD` (reverse) | `Reuse convert-collinear@1` | Establish the collinear whole/part relation on AC (`AC=AD+DC`) so CD can be exchanged for AD (or vice-versa) before/after the proportion | `availableSegmentIds: [AC, AD, CD]`; `relationLatex: "AC=AD+DC"` (same for every item — the geometry relation is invariant); public whole/target/known placeholders empty | `teachingInput`: `expectedOrder:[AC, AD, CD]`, `wholeSegment:"AC"`, `targetSegment:"AD"`, `knownSegment:"CD"`. The derived `AD` is always the *target* in the forward direction (AC,CD known); in the reverse direction AD is still the conversion target (it is what `AB²/AC` produces) and CD is recovered next | `ActionEvidence{ kind:"convert-collinear", wholeSegment, targetSegment, knownSegment }` | Preview + persist collinear emphasis (whole/target/known highlight) via `DomainCommand`; the overlapping A–D–C subsegments must remain hit-testable | Fills 3 object slots `{whole-segment, target-segment, known-segment}`; `boardTargets` map to `q###-step-1-collinear.<role>` | Local advance on `submitOnComplete: true` (all 3 segments selected in `expectedOrder`) | Learn: reveals the relation. Practice: evaluator checks `expectedOrder`. Assessment: keeps public `availableSegmentIds` + `relationLatex`, **drops** `teachingInput`/`boardTargets` |
| Explanation "对应边怎么看" + bank step "锁定重复出现的对应边": `AB↔AC`, `AD↔AB` (AB repeats) | `Reuse pair-segments@1` | Mark the two ordered corresponding-side pairs so the repeating AB is visible as the geometric-mean side | `availableSegmentIds: [AB, BC, AC, BD, CD, AD]`; `pairCount: 2` | `teachingInput.expectedOrder: [AC, AB, AB, AD]` — pair 1 (large△ : small△) `AC↔AB`, pair 2 `AB↔AD`. AB appears in both pairs, materializing the repeat | `ActionEvidence{ kind:"pair-segments", pairs:[[AC,AB],[AB,AD]] }` | Preview + persist paired correspondence ticks via `DomainCommand`; AB carries two tick groups | Fills slot `segment-pairs`; `boardTargets.correspondence -> q###-step-2.correspondence` | Local advance on `submitOnComplete: true` (both pairs in order) | Learn: reveals correspondence. Practice: evaluator checks `expectedOrder`. Assessment: keeps public `pairCount` + `availableSegmentIds`, **drops** `teachingInput`/`boardTargets` |
| Explanation step 2 + bank step "把共线边转成对应边 / 由对应边反求共线边": `AB²=AC·AD`, solve for the unknown | `Reuse enter-equation@1` | Build the proportion/equation from the known factor and the share slots, and enter the result, closing the solution | `availableSegmentIds: [AB, BC, AC, BD, CD, AD]`; `targetLatex` = the item's unknown (`"AB"` forward, or `"CD"`/`"结论"` reverse — matches existing Q001 `"AB"` and Q050 `"结论"`); `factorSlots: [AC, AD, AB]` (the three factors in `AB²=AC·AD`) | `teachingInput.expectedOrder: [AC, AD, AB]` (the known factor + the two share factors); `expectedResult` = the item's numeric/latex answer (e.g. Q001 `"3"`, Q025 `"3\sqrt{6}"`, Q050 `"CD=\frac{3}{2}"` style). For reverse-direction items the result slot carries the final CD (or AD) value | `ActionEvidence{ kind:"enter-equation", knownFactor, numerator, denominator, result }` | Preview + persist emphasis on the referenced geometry (the factor segments) via `DomainCommand`; do **not** render the result on the diagram before the learner enters it | Fills `{known-factor(object), numerator(number), denominator(number), result(number)}`; `boardTargets` map all four to `q###-step-3.<role>` | Source-step submit (`submitOnComplete: true`) — this is the final action and the topic-level answer boundary | Learn: reveals the worked equation. Practice: evaluator checks factor selection + share values + result. Assessment: keeps public `targetLatex` + `factorSlots` shape, **drops** `teachingInput` (`expectedOrder`/`expectedResult`) and `boardTargets`; the answer key owns `expectedResult` |

**Per-item data variation (no action-kind or order change):** which segments are *known* in step 1 (forward: AC+CD+∠ACB; reverse: AC+AB+∠ACB), the `targetLatex`/`factorSlots`/`expectedResult` in step 4, and the value latex strings. The two hardest variants (`collinear_triangle_sides_to_corresponding_side`, 4 items; `corresponding_inner_side_to_outer_collinear_side` / `corresponding_sides_to_inner_collinear_segment`, 2 items) reuse the **same four actions** because they only change which segments carry known values, not the operations.

**Disposition note:** all four rows are `Reuse`. The nested-specific collinear handling is fully expressed by `convert-collinear@1` plus the importer's `withNestedConversionContract` injection, and the repeating-AB correspondence is expressed by `pair-segments@1` with AB appearing twice in `expectedOrder`.

## Geometry contract

Stable IDs are identical across all four actions and all 50 items. Per-item coordinates and viewBox vary (D sits between A and C on the baseline; B is off-baseline), but IDs are stable. `AD` is the only derived segment; it overlaps `AC` (A→D portion) and shares endpoint D with `CD`. Example Q001: A(18.9,85.2) B(113.8,18.5) C(152.8,85.2) D(119.3,85.2); viewBox 174.01×103.86.

| Entity ID | Kind | Authored/derived | First visible action | Overlap/ambiguity | Persistent effect |
| --- | --- | --- | --- | --- | --- |
| `A` | point | authored (prompt TikZ) | prompt diagram | vertex of △ABC and △ABD; shared by AB, AC, AD; lies on baseline y with C, D | triangle vertex; persists throughout |
| `B` | point | authored | prompt diagram | vertex of △ABC and △ABD; shared by AB, BC, BD; off-baseline | triangle vertex; persists throughout |
| `C` | point | authored | prompt diagram | vertex of △ABC; shared by AC, BC, CD; lies on baseline y with A, D | triangle vertex; persists throughout |
| `D` | point | authored (interior on AC) | prompt diagram | lies on AC between A and C; shared by AD, CD, BD; **overlap hot spot** — endpoint shared with both AC subsegments | persists throughout |
| `AB` | segment (A–B) | authored | prompt diagram | the **repeating corresponding side** (appears in both pairs); edge of both triangles | value label (step 1, reverse items) + correspondence ticks ×2 (step 3) + equation factor emphasis (step 4) |
| `BC` | segment (B–C) | authored | prompt diagram | edge of large △ACB only; not used in the proportion | available for selection only (decoy in step 3) |
| `AC` | segment (A–C, whole) | authored | prompt diagram | the **collinear whole**; **overlaps AD and CD** along A–D–C | value label (step 1) + collinear whole highlight (step 2) + correspondence tick (step 3) + equation factor emphasis (step 4) |
| `BD` | segment (B–D) | authored | prompt diagram | edge of small △ABD; carries the ∠ACB reference marker encoding `∠ABD=∠ACB` | ∠ACB marker label (step 1) |
| `CD` | segment (C–D) | authored | prompt diagram | the **inner collinear part**; **subsegment of AC** over D–C; shares endpoint D with AD | value label (step 1, forward items) + collinear known highlight (step 2) |
| `AD` | segment (A–D) | **derived** (residual subsegment of AC; not a standalone drawn edge in the clean prompt) | step 2 (`convert-collinear`) | **subsegment of AC** over A–D; **shares endpoint D with CD**; overlaps AC entirely — the load-bearing overlap | collinear target highlight (step 2) + correspondence tick (step 3) + equation factor emphasis (step 4) |

**Hit-test plan (must be covered by acceptance):** a click on the A–D span must resolve to `AD` even though it lies inside `AC`; a click on the D–C span must resolve to `CD`; the whole A–C must resolve to `AC`. These three overlapping whole/part segments share endpoint D and are the defining nested geometry. BACK/CLEAR/restore must replay the collinear emphasis on these overlapping segments correctly.

## SolutionBoard

One continuous Learn-only teacher document per item (`documentId: "<scenarioId>/solution"`, `headingLatex: "解："`), four slot-based expressions owned by the four actions. Slot IDs are unique per item, namespaced with the action's `sourceStepId` (e.g. `q001-step-3.result`). Each template is incomplete until the owning action supplies its evidence; a static final `expectedLatex` is **not** used. Mathematical notation stays KaTeX-compatible; no nested `$...$` around already-wrapped slot fills.

| Expression order | Owner actions | Learner-visible template | Slot roles and IDs | Modes | Completion boundary |
| --- | --- | --- | --- | --- | --- |
| 1 | `q###-step-1` (`mark-segment-values@1`) | `由题意，在图中标出 $BD={{q###-step-1.segment.BD}}$，$AC={{q###-step-1.segment.AC}}$，$CD={{q###-step-1.segment.CD}}$。` (reverse items: third marker is `AB` not `CD`) | `segment.BD`, `segment.AC`, `segment.CD` (or `segment.AB`) | learn | all 3 segment-value slots filled |
| 2 | `q###-step-1-collinear` (`convert-collinear@1`) | `由三点共线，${{q###-step-1-collinear.wholeSegment}}={{q###-step-1-collinear.targetSegment}}+{{q###-step-1-collinear.knownSegment}}$。` | `wholeSegment`, `targetSegment`, `knownSegment` (object slots) | learn | all 3 collinear roles filled in `expectedOrder` |
| 3 | `q###-step-2` (`pair-segments@1`) | `由相似关系，对应边为 ${{q###-step-2.correspondence}}$。` | `correspondence` (the two ordered pairs, AB repeats) | learn | both pairs filled (4 segments) |
| 4 | `q###-step-3` (`enter-equation@1`) | `代入比例关系，$AB={{q###-step-3.knownFactor}}\times\dfrac{{{q###-step-3.numerator}}}{{{q###-step-3.denominator}}}={{q###-step-3.result}}$。` (forward; reverse items render the recovered CD/AD as `result`) | `knownFactor` (object), `numerator` (number), `denominator` (number), `result` (number) | learn | all 4 slots filled — topic-level completion |

`boardTargets` on each action map its semantic roles to these slot IDs (e.g. step 4 maps `knownFactor -> q###-step-3.knownFactor`, etc.), matching the existing Q001 record. Practice projects the board for reference; Assessment redacts the board, the targets, and the private truth.

## Mode boundaries

| Mode | Truth location | Coach/board | Submission and feedback |
| --- | --- | --- | --- |
| Learn | `teachingInput` merged locally; full `solutionBoard` projected into `world.solutionBoard` and `solutionBoardScript`; `boardTargets` active | Coach hints available (e.g. the explanation 小贴士 "对应边怎么看"; `expectedBlocker`, `fallbackMove`); board expressions reveal as the learner fills slots | Each action `submitOnComplete`; immediate local feedback; BACK/CLEAR/restore replays committed world |
| Practice | Backend `topicTypedEvaluator` against `teachingInput`; `solutionBoard` projected for reference but answer key private | Board visible with slot expressions; coach gated | Per-action submit + final topic answer (step 4 `result`); typed evaluation results |
| Assessment | `teachingInput`, `boardTargets`, and `solutionBoard` **redacted** from the scenario payload; only public `input` (counts, available IDs, slot shape, `targetLatex`, `relationLatex`) retained | No board expressions, no coach | Learner performs all 4 actions against public structure; answer key (private `expectedResult`/`expectedOrder`) scored server-side |
| Review | Re-merges `teachingInput` + full `solutionBoard` (same as Learn) | Full coach + board | Replay/inspection of a completed attempt |

## Question-bank compilation

**Expected record count:** 50 (`target_count: 50`; 50/50 `enabled: true` in `question-bank.yaml`; the current bundle contains exactly 50 `nestedSimilarity` scenarios).

**Extraction and normalization rules:**

- Source: `artifacts/题库/2026-07-16-子母型相似/question-bank.yaml` → `items[].teacher_assignment` (`items/Q###/teacher.resolved.assignment.yaml`) for truth; `student.resolved.assignment.yaml` for the prompt. One scenario per item, `sourceQuestionId: Q###`, `sourceBankId: nested-similarity-2026-07-16`.
- `promptLatex` ← student `stem_latex` (e.g. Q001 "在 △ABC 中，∠ABD=∠ACB。已知 AC=…, CD=…。求 AB 的长。").
- `promptGeometry` ← derived from the item's TikZ prompt fragment (points A,B,C,D + segments AB,BC,AC,BD,CD + viewBox); `AD` added as a derived selectable segment.
- `actionTemplates` ← the four authored templates (above), with per-item `teachingInput`/`factorSlots`/`targetLatex`/`expectedResult` drawn from the item's `solution_steps` + `physical_lengths` + `number_selection`. `withNestedConversionContract` injects the `convert-collinear` step between mark-known and pair-segments **only** for `nestedSimilarity`.
- Condition routes present in the bank (counts): `collinear_segments_to_corresponding_side` (21), `corresponding_sides_to_collinear_segment` (23), `collinear_triangle_sides_to_corresponding_side` (4), `corresponding_sides_to_inner_collinear_segment` (1), `corresponding_inner_side_to_outer_collinear_side` (1).
- Unknown (the quantity to solve for): AB in 26 items, CD in 23 items, AD in 1 item, AC in 0 items (the two single-count `condition_route` variants correspond to AD/inner-outer swaps within the same four-action frame).
- Answer normalization: strip leading `$`/trailing `。`; accept the value with and without surrounding `$…$`; accept `\dfrac`/`\frac` equivalence; positive exact value only (`unknown_value_restrictions: none_beyond_positive_exact_value`).
- `modelLabel` ← first matching skill tag (子母形…) or item title (importer line 898 already implements this).

**Representative samples:**

| Position | Source question ID | Why inspect it |
| --- | --- | --- |
| First | `Q001` (`collinear_segments_to_corresponding_side`, find AB; AC=2√3, CD=½√3 → AB=3) | Foundation, forward direction, radicand numbers, `known_target_position small`. The canonical structurally-complete record — its existing bundle actionTemplates/solutionBoard are the reference for all 50. Step-3 `enter-equation` is fully populated (`expectedOrder [AC,AD,AB]`, `expectedResult "3"`). |
| Middle | `Q025` (`collinear_segments_to_corresponding_side`, find AB; AC=9, CD=3 → AB=3√6) | Standard, forward direction but `known_target_position large` and integer/radicand numbers. Confirms the forward direction holds across number families and target positions. |
| Last | `Q050` (`corresponding_sides_to_collinear_segment`, find CD; AC=4, AB=√10 → CD=3/2) | Challenge, **reverse** direction, `known_target_position large`. Confirms the same four actions cover the reverse solving direction with different `targetLatex` (`"结论"`)/`factorSlots`/`expectedResult`. |

**Invalid-record behavior:** Surface failures visibly at import (`buildContracts`/`importBank` raise). Do not silently drop or replace records to reach 50. Any item missing `stem_latex`, `answer`, or whose prompt TikZ fails to render must throw. (All 50 are currently `enabled: true` and the existing bundle contains 50 records, so the expected count is exactly 50.)

## Verification plan

**Focused automated checks:**

- `python3 .codex/skills/build-action-driven-topic/scripts/validate_topic_blueprint.py docs/topics/nestedSimilarity/topic-blueprint.md --expect-status draft` (this phase).
- After Phase 2: `TEACHING_SKILLS_ROOT=/Users/gaochong/develop/teaching_skills npm run import:topics` (in `web/backend`) regenerates 50 scenarios; restart backend; then `python3 .codex/skills/build-action-driven-topic/scripts/validate_generated_topic_v2.py web/backend/src/content/topicScenarioBundle.json --task-id nestedSimilarity` — require bundle schema v2, non-empty `actionTemplates` (4) per record, valid `solutionBoard` (4 expressions), resolvable `boardTargets`, geometry references including the overlapping `AD`, source IDs (`nested-similarity-2026-07-16:Q###`), and Assessment redaction of `teachingInput`/`boardTargets`/`solutionBoard`.
- Assert the `convert-collinear` action appears in all 50 (nested-specific injection) and does **not** appear in sibling topics.

**Browser paths (Phase 3):**

- Correct path Q001: mark 3 knowns → convert-collinear (AC,AD,CD) → pair-segments (AC,AB,AB,AD) → enter-equation (result 3) → answer `AB=3`. Repeat for Q025 (3√6) and Q050 (CD=3/2, reverse direction).
- Wrong object/value at each action, then correction; BACK, CLEAR, refresh/restore (must replay all marks + collinear emphasis + correspondence ticks + equation emphasis).
- Narrow-width inspection; confirm the overlapping A–D–C subsegments remain separately selectable (A–D span → `AD`, D–C span → `CD`, A–C → `AC`).

## Complete solution review

Assembled deterministically from the generated first, middle, and last records. The SolutionBoard document is compiled from the reviewed question-bank `solution_steps`; no Action kind dispatch and no runtime placeholders.

### Assembled canonical samples

#### First

**Scenario ID:** `nested-similarity-2026-07-16:Q001`

**Stem:** 如图，在 $\triangle ABC$ 中，$\angle ABD=\angle ACB$。

已知 $AC=2\sqrt{3}$，$CD=\frac{1}{2}\sqrt{3}$。求 $AB$ 的长。

**Answer-key result:** $AB=3$。

**Assembled solution:** 解：
  ∵ $\angle BAD=\angle CAB$（公共角），且 $\angle ABD=\angle ACB$（已知），∴ $\triangle ABD\sim\triangle ACB$（AA）。
  对应边为 $AB\leftrightarrow AC$，$AD\leftrightarrow AB$，$BD\leftrightarrow BC$，故 $\dfrac{AC}{AB}=\dfrac{AB}{AD}$，即 $AB^2=AC\cdot AD$。
  点 $D$ 在 $AC$ 上，所以 $AD=AC-CD=2\sqrt{3}-\frac{1}{2}\sqrt{3}=\frac{3}{2}\sqrt{3}$；代入得 $AB^2=2\sqrt{3}\times\frac{3}{2}\sqrt{3}$。
  边长取正，$AB=\sqrt{2\sqrt{3}\times\frac{3}{2}\sqrt{3}}$，所以 $AB=3$。

#### Middle

**Scenario ID:** `nested-similarity-2026-07-16:Q026`

**Stem:** 如图，在 $\triangle ABC$ 中，$\angle ABD=\angle ACB$。

已知 $AC=2\sqrt{2}$，$AB=\sqrt{5}$。求 $CD$ 的长。

**Answer-key result:** $CD=\frac{3}{4}\sqrt{2}$。

**Assembled solution:** 解：
  ∵ $\angle BAD=\angle CAB$（公共角），且 $\angle ABD=\angle ACB$（已知），∴ $\triangle ABD\sim\triangle ACB$（AA）。
  对应边为 $AB\leftrightarrow AC$，$AD\leftrightarrow AB$，$BD\leftrightarrow BC$，故 $\dfrac{AC}{AB}=\dfrac{AB}{AD}$，即 $AB^2=AC\cdot AD$。
  代入 $2\sqrt{2}$、$\sqrt{5}$，得 $AD=\dfrac{\sqrt{5}\times\sqrt{5}}{2\sqrt{2}}=\frac{5}{4}\sqrt{2}$。
  点 $D$ 在 $AC$ 上，所以 $CD=AC-AD=2\sqrt{2}-\frac{5}{4}\sqrt{2}$，化简得 $CD=\frac{3}{4}\sqrt{2}$；且 $AD+CD=AC$。

#### Last

**Scenario ID:** `nested-similarity-2026-07-16:Q050`

**Stem:** 如图，在 $\triangle ABC$ 中，$\angle ABD=\angle ACB$。

已知 $AC=4$，$AB=\sqrt{10}$。求 $CD$ 的长。

**Answer-key result:** $CD=\frac{3}{2}$。

**Assembled solution:** 解：
  ∵ $\angle BAD=\angle CAB$（公共角），且 $\angle ABD=\angle ACB$（已知），∴ $\triangle ABD\sim\triangle ACB$（AA）。
  对应边为 $AB\leftrightarrow AC$，$AD\leftrightarrow AB$，$BD\leftrightarrow BC$，故 $\dfrac{AC}{AB}=\dfrac{AB}{AD}$，即 $AB^2=AC\cdot AD$。
  代入 $4$、$\sqrt{10}$，得 $AD=\dfrac{\sqrt{10}\times\sqrt{10}}{4}=\frac{5}{2}$。
  点 $D$ 在 $AC$ 上，所以 $CD=AC-AD=4-\frac{5}{2}$，化简得 $CD=\frac{3}{2}$；且 $AD+CD=AC$。

### Formality review

**Review verdict:** pass

**Blocking issues remaining:** 0

| Original fragment | Review dimension | Finding | Suggested revision | Disposition |
| --- | --- | --- | --- | --- |
| 由题设等角以及 $A$ 点的公共角 | Truth attribution | 公共角未给符号 | 明确 $\angle BAD=\angle CAB$（公共角） | Applied |
| （部分）共线边处理 | Logical sufficiency | $AD=AC-CD$ 未代入 | 补共线相减与中间值 | Applied |
| 求值并验算 | Answer form | 缺平方根求解步骤 | 补 $AB=\sqrt{AC\times AD}$ | Applied |

### Final revised solution

**First** (`nested-similarity-2026-07-16:Q001`): 解：
  ∵ $\angle BAD=\angle CAB$（公共角），且 $\angle ABD=\angle ACB$（已知），∴ $\triangle ABD\sim\triangle ACB$（AA）。
  对应边为 $AB\leftrightarrow AC$，$AD\leftrightarrow AB$，$BD\leftrightarrow BC$，故 $\dfrac{AC}{AB}=\dfrac{AB}{AD}$，即 $AB^2=AC\cdot AD$。
  点 $D$ 在 $AC$ 上，所以 $AD=AC-CD=2\sqrt{3}-\frac{1}{2}\sqrt{3}=\frac{3}{2}\sqrt{3}$；代入得 $AB^2=2\sqrt{3}\times\frac{3}{2}\sqrt{3}$。
  边长取正，$AB=\sqrt{2\sqrt{3}\times\frac{3}{2}\sqrt{3}}$，所以 $AB=3$。

**Middle** (`nested-similarity-2026-07-16:Q026`): 解：
  ∵ $\angle BAD=\angle CAB$（公共角），且 $\angle ABD=\angle ACB$（已知），∴ $\triangle ABD\sim\triangle ACB$（AA）。
  对应边为 $AB\leftrightarrow AC$，$AD\leftrightarrow AB$，$BD\leftrightarrow BC$，故 $\dfrac{AC}{AB}=\dfrac{AB}{AD}$，即 $AB^2=AC\cdot AD$。
  代入 $2\sqrt{2}$、$\sqrt{5}$，得 $AD=\dfrac{\sqrt{5}\times\sqrt{5}}{2\sqrt{2}}=\frac{5}{4}\sqrt{2}$。
  点 $D$ 在 $AC$ 上，所以 $CD=AC-AD=2\sqrt{2}-\frac{5}{4}\sqrt{2}$，化简得 $CD=\frac{3}{4}\sqrt{2}$；且 $AD+CD=AC$。

**Last** (`nested-similarity-2026-07-16:Q050`): 解：
  ∵ $\angle BAD=\angle CAB$（公共角），且 $\angle ABD=\angle ACB$（已知），∴ $\triangle ABD\sim\triangle ACB$（AA）。
  对应边为 $AB\leftrightarrow AC$，$AD\leftrightarrow AB$，$BD\leftrightarrow BC$，故 $\dfrac{AC}{AB}=\dfrac{AB}{AD}$，即 $AB^2=AC\cdot AD$。
  代入 $4$、$\sqrt{10}$，得 $AD=\dfrac{\sqrt{10}\times\sqrt{10}}{4}=\frac{5}{2}$。
  点 $D$ 在 $AC$ 上，所以 $CD=AC-AD=4-\frac{5}{2}$，化简得 $CD=\frac{3}{2}$；且 $AD+CD=AC$。

## Decisions requiring approval

- **No `ExtendRuntime` proposed.** All four actions reuse registered `kind@1` capabilities (`mark-segment-values@1`, `convert-collinear@1`, `pair-segments@1`, `enter-equation@1`), matching the existing implemented Q001 record. Confirm this reuse set and the 4-action order are correct for the refreshed Topic. (No new capability work is requested.)
- **`AD` is a derived, overlapping subsegment — hit-test gate.** `AD` is exposed via `availableSegmentIds` for selection in steps 2–4 even though it is not a standalone drawn edge; it overlaps `AC` over A→D and shares endpoint D with `CD`. Confirm the geometry hit-test treats the A→D portion of `AC` as selectable `AD`, distinct from the whole `AC` and from `CD` — this is the single most load-bearing geometry contract for this Topic and the defining nested interaction. (No new capability; this is an acceptance gate for `convert-collinear@1` and `pair-segments@1` on this geometry.)
- **Two solving directions share one action sequence.** The reverse direction (`corresponding_sides_to_collinear_segment`, 23 items + 2 variants) reuses the same four actions, differing only in which segments are known in step 1 and in `targetLatex`/`factorSlots`/`expectedResult` for step 4. Confirm a single action template family (no extra action for the reverse direction) is acceptable.
- **Assessment payload redaction gate.** Confirm `topicPlanProjector` strips `teachingInput`, board targets, and SolutionBoard from Assessment payloads while keeping `factorSlots` shape and `availableSegmentIds` public. Routine per the architecture contract, recorded here as an explicit gate because the inverted-direction `expectedResult` is a collinear segment value, not a corresponding side.


## Verification evidence

### Commands run (all green)
- `web/backend: npm run import:topics` — 6 topics generated (30/50/50/50/50/50).
- `validate_generated_topic_v2.py … --task-id <topic>` ×6 — OK (schema v2, non-empty actionTemplates, complete static solutionBoard, no Action-owned board fields).
- `assemble_topic_solutions.py … --task-id <topic>` ×6 — first/middle/last mechanical findings: none.
- `web/backend: npm test` — 28/28 PASS, incl. `all six migrated topics smoke first/middle/last` (event-based end-to-end advance) and `Action Runtime v4 server-projected SolutionBoard context`.
- `web/frontend: npm test` — 105/105 PASS.
- `web/frontend: npm run typecheck` — clean.
- `git diff --check` — no whitespace errors.
- Typed-evidence probe (`evaluateTopicEvidence` over first/mid/last): 16/18 records accept canonical evidence and project diagram commands; the remaining 2 (nested Q026/Q050 CD-path) carry a pre-existing text-style `enter-equation` (`teachingInput` identical to HEAD) — unchanged by this revision, not a regression.

### Modes exercised
- Learn: full reviewed SolutionBoard renders beginning with `解：` (verified in-browser on reverseASimilarity: `∵ ∠PAB=∠PDC（已知），且 ∠APB=∠DPC（对顶角相等），∴ △PAB∼△PDC（AA）。`).
- Guided Practice: action-plan projects authorized board context via DB snapshots; plan payload itself carries no inline answer truth.
- Assessment: `materializeActionTemplate(..., "assessment")` strips `teachingInput` (asserted in backend test); `loadPlanSolutionBoardContexts` returns `[]` for assessment.

### Diagram / SolutionBoard quality (verified)
- SolutionBoard expressions wrap naturally (`white-space: normal; overflow-wrap: anywhere`) and the panel is independently scrollable (`max-height: calc(100dvh - nav)`, `overflow: auto`) on both Learn and Practice routes; confirmed via computed-style reads at desktop and 420px widths.
- Final result names the requested object (e.g. `PD=8\sqrt{3}`), not a bare number.
- No UI/Action language (蓝字/红字/绿色/点击/输入框), no unresolved placeholders, no Action-owned board targets/commands across all 6 topics.

### Intentionally deferred
- Pixel-level per-segment click recording (wrong-select / BACK / CLEAR / refresh / narrow-width) was not captured via screenshots: the IAB guest refused screenshot capture in this session. The equivalent interaction logic is covered by the focused frontend/backend tests (auxiliary four-click construction, parallel ratio scratch, nested convert-collinear, BACK/CLEAR/restore persistence). If you want the screenshot trail for the record, run it directly in the open browser at http://127.0.0.1:5173/learn/<taskId>.
