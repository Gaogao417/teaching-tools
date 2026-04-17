---
spec_version: v2
spec_kind: example
working_title: 范围约束下解三角函数方程
grade_band: 高中
topic_or_chapter: 三角函数与三角方程
target_concept: 已知 sin/cos/tan(omega x + phi) = 常见函数值，且给出待求量范围时，先把范围变换到 omega x + phi，再筛角并回代求解
primary_skill_unit: transform-expression-range
related_skill_units: find-reference-angles, filter-angles-in-range, solve-backsubstitution
learning_mode: example
prototype_candidate: triangle-guided-derivation
fit_level: new-tool-needed
difficulty: medium
estimated_minutes: 6-8
step_mode: multi-step
repo_mapping_ready: partial
---

# 范围约束下解三角函数方程

## 1. Spec Summary

- Spec kind: `example`
- Spec intent: 教学生把“解三角函数方程且带范围限制”稳定拆成四步：找基准角、变换范围、筛选合法角、回代求待求量。
- Learner-facing seed or generation rule: 已知 `sin/cos/tan(omega x + phi) = value`，其中 `omega`、`x`、`phi` 三者中已知两项、待求一项，并给出待求量的取值范围。学生按步骤写出范围内全部合法解。
- Why this spec is worth building: 这类题常见失误不是不会套通解，而是不先处理范围，导致漏解、多解，或把 `x` 的范围误当成 `omega x + phi` 的范围。

## 2. Skill Unit Definition

- Primary skill unit: `transform-expression-range`
- Related skill units: `find-reference-angles`, `filter-angles-in-range`, `solve-backsubstitution`
- Skill unit goal: 学生能先把待求量的范围等价地变换成 `omega x + phi` 的范围，再把后续筛角和回代建立在这个新范围上。
- Prerequisite knowledge: 单位圆上的特殊角；`sin/cos/tan` 的常见函数值；一元一次不等式范围变换；一元一次方程求解。
- Likely misconception: 学生直接写通解或只写主值角，没有先把范围换到 `omega x + phi`，从而在筛角阶段漏掉合法角，或把不在范围内的角错误保留下来。
- Mastery evidence: 学生能依次给出对应函数值的候选角、正确的 `omega x + phi` 范围、该范围内全部合法角 `theta`，并据此求出原范围内的全部待求量。

## 3. Learning Role and Experience

- Learning mode: `example`
- Hint level: `high`
- Observable learning goal: 学生能按固定四步流程写出范围内全部合法解，并说明每一步的中间结果来自哪里。
- Student action: `multi-step-input`
- Success condition: 四个关键中间结果和最终答案都正确，且最终答案完整地落在原始待求量范围内。

## 4. Learner Flow

1. Student sees: 左侧工作区同时展示单位圆、题目方程 `sin/cos/tan(omega x + phi) = value`、已知量、待求量与其范围；右侧 guide 仅展示当前步骤目标与短提示。
2. Student does: 第 1 步写出或标出满足该函数值的基准角；第 2 步把待求量范围变换成 `omega x + phi` 的范围；第 3 步在新范围内筛出全部合法角 `theta`；第 4 步分别解 `omega x + phi = theta`。
3. System feedback: 每步提交后立即判断。若错误，反馈明确指出是“角找不全”“范围变换不等价”“筛角遗漏或越界”还是“最后回代求解错误”。
4. Advance or finish condition: 当前步骤正确后才解锁下一步；最后一步必须给出全部合法解才算完成。

## 5. Workspace and UI Requirements

- Selected current prototype: 交互节奏最接近 `triangle-guided-derivation` 的多步推进，但当前原型的核心对象是直角三角形，不能直接承载本题。
- Primary workspace object: 单位圆加范围带，外加与当前步骤绑定的角集合输入区。
- Core mathematical object that must remain visible: 单位圆上的特殊角位置、当前方程 `sin/cos/tan(omega x + phi) = value`、待求量原范围、以及变换后的 `omega x + phi` 范围。
- Workspace action area: 所有输入、标角、范围填写、筛角与最终作答都必须在同一个左侧工作区完成。
- Guide responsibilities: guide 只负责说明当前步骤目标、给出短提示、承接即时反馈，不承担主要输入动作。
- Visibility or layout constraints: 单位圆与范围信息必须全程同屏可见；步骤切换时不能把核心数学对象替换成别的图；学生不应在多个面板之间来回找当前输入点。

## 6. Evaluation and Feedback

- Correctness rule: 第 1 步检查候选角是否找全；第 2 步检查范围变换是否与原范围等价；第 3 步检查是否保留且只保留了新范围内的全部合法角；第 4 步检查回代后的结果是否完整且都在原待求量范围内。
- Allowed equivalents: 角可接受弧度制或角度制，但同一题内必须统一；最终解的顺序可不同；`tan` 题可允许先用周期表达再落回指定范围列举。
- Wrong-answer pattern(s): 只写一个主值角；把 `x` 的范围直接当成 `omega x + phi` 的范围；忽略 `omega < 0` 时不等号方向变化；筛角时漏掉同周期角；最终答案超出原范围。
- Feedback tone and examples: 语气直接、简短、可继续作答。例如“你已经找到一个对应角，但这个函数值在单位圆上不止一个位置。”“先不要急着解方程，这一步要先把待求量范围换成 `omega x + phi` 的范围。”“这些角本身成立，但不都落在题目给定范围内。”

## 7. Variants and Constraints

- Variable space: 函数类型限于 `sin`、`cos`、`tan`；函数值限于高中常见特殊值；`omega` 取非零小整数；`phi` 取能保持特殊角结构的常见平移；待求对象优先从“求 `x`”版本开始，再扩展到“求 `phi`”或“求 `omega`”。
- Exercise pack source priority: `not-applicable`，本 spec 是 `example`，不是 `exercise-pack`。
- Difficulty levers: 先做 `omega > 0` 且求 `x`；再加入 `omega < 0`；再加入 `phi != 0`；最后再扩展到改变量未知对象。
- Invalid or misleading cases to avoid: 不生成需要数值近似的角；不让范围跨越过大导致角枚举失控；入门版本不要混用角度制和弧度制；不要同时把“求谁”和“范围变换方向”都做成高复杂度变体。

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

- Suggested learning-runtime mapping: 这是一个产品侧 `example`，实现容器仍可沿用当前 `practice` runtime 的多步会话、guide 与反馈节奏，但数学工作区对象需要换成“单位圆 + 范围 + 角集合”。
- Suggested `TaskDefinition` direction: 可新增一个高中目录下的任务，标题方向可为“范围约束下解三角函数方程”，难度建议 `medium`，预计需要新的 `engineKind`，命名方向可为 `angle-equation`。
- Suggested `ContentDefinition` direction: prompt 需要明确函数类型、`omega x + phi` 结构、待求对象及其范围；scene 应围绕单位圆与范围带，而不是三角形；completion policy 适合 `multi-step`；guide step 可固定为 `find-angles`、`transform-range`、`filter-angles`、`solve-target`。
- Suggested scene / flow / guide / feedback mapping: flow 可复用当前 guided example 的逐步解锁节奏；guide 继续负责步骤标题、摘要与即时反馈；correctness 需要新增“角集合是否完整”“范围变换是否等价”“筛角是否越界”这三类判定。
- Reusable current repo pieces: 多步 flow 容器、guide step 结构、correct/wrong/finish 反馈节奏、任务注册与结果持久化链路仍可复用；当前 `triangle-trig` 工作区与交互锚点不可直接复用。

## Appendix B. Tooling Gap

- Why current prototypes fail: 现有 `triangle-role-selection`、`triangle-value-placement`、`triangle-guided-derivation` 都以直角三角形为核心对象，无法把“单位圆上的角位置”“范围带”“角集合筛选”同时作为主工作对象呈现。若强行套用，会把本题误教成三角形代值题，而不是范围约束下的角方程求解。
- Minimum new capability needed: 需要一个以“单位圆 + 范围可视化 + 多个角的输入/筛选 + 分步保存中间结果”为核心的新工作区原语，至少支持多角标记、范围端点输入或选择、按范围筛角、以及逐步校验中间结果。
- What can still be reused: 现有 session/runtime 管线、多步 guide 框架、反馈状态流转、任务与内容注册模式都可以继续沿用。
