---
spec_version: v2
spec_kind: example
working_title: 等腰直角三角形一线三垂直求坐标
grade_band: 八年级
topic_or_chapter: 平面直角坐标系与全等三角形
target_concept: 利用"一线三垂直"模型，过直角顶点作横竖辅助线，由全等三角形对应边相等列二元一次方程组，求第三点坐标
primary_skill_unit: coordinate-isosceles-right-vertex
related_skill_units: identify-congruent-triangles, setup-two-variable-system
learning_mode: example
prototype_candidate: triangle-guided-derivation
fit_level: new-tool-needed
difficulty: medium
estimated_minutes: 5-7
step_mode: multi-step
repo_mapping_ready: partial
---

# 等腰直角三角形一线三垂直求坐标

## 1. Spec Summary

- Spec kind: `example`
- Spec intent: 教学生掌握"一线三垂直"模型的完整解题流程：过直角顶点作横竖辅助线、识别全等三角形对应边、列方程组、求解第三点坐标。
- Learner-facing seed or generation rule: 已知等腰直角三角形 ABC，∠A = 90°，AB = AC，给出 B、C 两点坐标，求 A 点坐标。
- Why this spec is worth building: 学生常见错误不是不会解方程组，而是辅助线画错方向、对应边找错，导致方程列错。本题是坐标系与全等三角形的综合应用，在八年级几何中属于高频失分题型。

## 2. Skill Unit Definition

- Primary skill unit: `coordinate-isosceles-right-vertex`
- Related skill units: `identify-congruent-triangles`（识别全等三角形及其对应关系）, `setup-two-variable-system`（用等量关系列二元一次方程组）
- Skill unit goal: 学生能在坐标系中识别等腰直角三角形，正确构造"一线三垂直"辅助线，由全等三角形的对应边相等列出方程组并求解未知顶点坐标。
- Prerequisite knowledge: 坐标平面内两点间距离；全等三角形的判定与性质；直角坐标系中横线与竖线的表示；二元一次方程组的解法。
- Likely misconception: 辅助线方向选错（应该过 A 作横线和竖线，而不是过 B 或 C）；全等三角形对应边搞反（BE 对应 AF、AE 对应 CF 的配对关系容易出错）；列方程时符号搞错（距离的正负方向混淆）。
- Mastery evidence: 学生能独立完成：画出辅助线、指出两个全等三角形及对应边、列出正确的二元一次方程组、解出目标点坐标。

## 3. Learning Role and Experience

- Learning mode: `example`
- Hint level: `high`
- Observable learning goal: 学生能按固定四步流程完成：识别辅助线构造、确认全等对应边、列方程组、解出坐标，并说明每一步的中间结果来自哪里。
- Student action: `multi-step-input`
- Success condition: 四步中间结果和最终坐标均正确，方程组与题意一致，解出的坐标满足 ∠A = 90° 且 AB = AC。

## 4. Learner Flow

1. Student sees: 左侧工作区展示坐标平面，标出 B(x₁, y₁)、C(x₂, y₂) 两点，并画出等腰直角三角形 ABC 的轮廓（A 位置用问号标记）；右侧 guide 展示题目条件与当前步骤目标。
2. Student does: 第 1 步（构造辅助线）：确认过 A 点的横线（y = b）和竖线（x = a），以及从 B 到横线的垂线（垂足 E）和从 C 到竖线的垂线（垂足 F）——学生选择辅助线的构造方向；第 2 步（识别全等与对应边）：指出 △ABE ≅ △CAF，并标出对应边关系 BE = AF、AE = CF；第 3 步（列方程）：设 A(a, b)，将对应边关系转化为关于 a、b 的二元一次方程组；第 4 步（解方程组）：输入 A 的最终坐标。
3. System feedback: 每步提交后立即判断。若错误，反馈明确指出是"辅助线方向不对""对应边配错""方程列错"还是"方程解错"。
4. Advance or finish condition: 当前步骤正确后才解锁下一步；最后一步必须给出正确坐标才算完成。

## 5. Workspace and UI Requirements

- Selected current prototype: 交互节奏最接近 `triangle-guided-derivation` 的多步推进，但当前原型的核心对象是单一直角三角形且无坐标系，不能直接承载本题。
- Primary workspace object: 坐标平面上的等腰直角三角形 ABC，叠加辅助线（过 A 的横竖线、垂足 E 和 F）、两个全等三角形的高亮区域。
- Core mathematical object that must remain visible: 坐标平面、B 和 C 的坐标标注、辅助线与垂足、以及当前步骤正在操作的对应边或方程。
- Workspace action area: 所有选择、标注、方程输入、坐标作答都在同一个左侧坐标平面工作区完成。
- Guide responsibilities: guide 只负责展示题目条件、当前步骤目标、短提示与即时反馈，不承担主要输入动作。
- Visibility or layout constraints: 坐标平面与辅助线必须全程同屏可见；步骤切换时不能把核心图替换掉；学生不应在多个面板之间来回找当前输入点。

## 6. Evaluation and Feedback

- Correctness rule: 第 1 步检查辅助线是否过 A 且方向正确（横竖各一条）；第 2 步检查全等三角形识别与对应边配对是否正确；第 3 步检查方程组是否与对应边关系一致且化简正确；第 4 步检查坐标解是否满足方程组。
- Allowed equivalents: 方程组可写成 |y₁ − b| = |x₂ − a|、|x₁ − a| = |y₂ − b| 的绝对值形式，也可写成展开后的线性形式；若题目 B、C 位置导致 A 有两解，学生只需求出其中一解即可（guide 应提示另一解的存在）。
- Wrong-answer pattern(s): 辅助线画在 B 或 C 而不是 A 处；对应边配对时把 BE 配成 CF 而不是 AF；列方程时把横纵坐标关系写反（x 和 y 混淆）；解方程时计算错误。
- Feedback tone and examples: 语气直接、简短、可继续作答。例如"辅助线应该过哪个点？再看看直角顶点在哪里。""注意对应关系：一个三角形的竖直边应该等于另一个三角形的水平边。""方程列对了，但解的过程再检查一下计算。"

## 7. Variants and Constraints

- Variable space: B、C 坐标取整数或简单分数，保证方程组解为整数或简单分数；A 的位置优先出现在第一象限或方便画图的象限。
- Exercise pack source priority: `not-applicable`，本 spec 是 `example`，不是 `exercise-pack`。
- Difficulty levers: 入门版本 B、C 在同一象限且 A 也在同一象限；进阶版本 B、C 跨象限；高难度版本可扩展为已知 A、B 求 C（需调整辅助线构造方式）。
- Invalid or misleading cases to avoid: 不生成 B = C 的退化情况；不生成导致 A 落在 BC 上的极端情况；不使用导致坐标值为无理数的 B、C 组合。

## 8. Review Checklist

- [x] Spec kind is explicit
- [x] Primary skill unit is explicit
- [x] Learning mode is explicit or marked `not-applicable`
- [x] One observable learning goal
- [x] One dominant learner action per step
- [x] Current prototype choice is justified or marked `not-applicable`
- [x] Core diagram or math object stays visible when applicable
- [x] Feedback matches the likely misconception
- [x] Success condition is directly testable

## Appendix A. Repo Mapping

- Suggested learning-runtime mapping: 这是一个产品侧 `example`，实现容器仍可沿用当前 `practice` runtime 的多步会话、guide 与反馈节奏，但数学工作区对象需要换成"坐标平面 + 辅助线 + 方程输入"。
- Suggested `TaskDefinition` direction: 可在八年级目录下新增任务，标题方向可为"等腰直角三角形一线三垂直求坐标"，难度 `medium`，需要新的 `engineKind`，命名方向可为 `coordinate-isosceles-right`。
- Suggested `ContentDefinition` direction: prompt 需要明确 B、C 坐标与等腰直角条件；scene 应围绕坐标平面与辅助线，而不是单一直角三角形；completion policy 为 `multi-step`；guide step 可固定为 `construct-lines`、`identify-congruent`、`setup-equations`、`solve-coordinates`。
- Suggested scene / flow / guide / feedback mapping: flow 可复用当前 guided example 的逐步解锁节奏；guide 负责步骤标题、辅助线构造提示与即时反馈；correctness 需要新增"辅助线方向判定""对应边配对判定""方程一致性判定"三类检查。
- Reusable current repo pieces: 多步 flow 容器、guide step 结构、correct/wrong/finish 反馈节奏、任务注册与结果持久化链路仍可复用；当前 `triangle-trig` 工作区与三角形交互锚点不可直接复用。

## Appendix B. Tooling Gap

- Why current prototypes fail: 现有原型都以单一直角三角形为核心对象，不支持坐标平面、辅助线绘制、垂足标记、全等三角形高亮等多对象叠加的交互。若强行套用，会把本题误教成三角形边值题，而不是坐标系中利用全等构造列方程的核心方法。
- Minimum new capability needed: 需要一个以"坐标平面 + 可叠加辅助线 + 全等三角形高亮 + 方程组输入 + 分步保存中间结果"为核心的新工作区原语，至少支持坐标平面渲染、辅助线方向选择、对应边标注、方程输入与校验。
- What can still be reused: 现有 session/runtime 管线、多步 guide 框架、反馈状态流转、任务与内容注册模式都可以继续沿用。
