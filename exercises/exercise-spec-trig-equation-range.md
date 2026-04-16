---
spec_version: v2
spec_kind: example
working_title: 三角函数方程求解：范围约束下的定解
grade_band: 高中（高一）
topic_or_chapter: 三角函数与三角函数方程
target_concept: 已知 omega、x、phi 中两项并给出自变量范围时，利用单位圆与范围变换求解 sin/cos/tan(omega x + phi) = 常见函数值
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

# 三角函数方程求解：范围约束下的定解

## 1. Spec Summary

- Spec kind: `example`
- Spec intent: 训练学生把三角函数方程的求解拆成“找角、变范围、筛角、回代求未知量”的稳定流程，而不是只背通解模板。
- Learner-facing seed or generation rule: 已知 `sin/cos/tan(omega x + phi) = 常见函数值`，且 `omega`、`x`、`phi` 三者中已知两项、待求一项，并给出待求量的范围。请按步骤找出所有满足条件的解。
- Why this spec is worth building: 这类题是高中阶段三角函数方程的典型难点。学生常常会机械套公式，却不会把单位圆上的角信息与范围限制结合起来定解。

## 2. Skill Unit Definition

- Primary skill unit: `transform-expression-range`
- Related skill units: `find-reference-angles`、`filter-angles-in-range`、`solve-backsubstitution`
- Skill unit goal: 学生能够把待求量的范围正确换算成 `omega x + phi` 的范围，并把后续筛角与回代建立在这个新范围上。
- Prerequisite knowledge: 单位圆上的特殊角；`sin/cos/tan` 的常见函数值；简单一次式范围变换；一元一次方程求解。
- Likely misconception: 学生会直接写三角方程的通解或只找主值角，没有先把待求量的范围正确变换成 `omega x + phi` 的范围，导致漏解或多解。
- Mastery evidence: 学生依次给出目标函数值对应的候选角、正确的 `omega x + phi` 范围、该范围内的所有角 `theta`，并据此求出范围内全部待求量。

## 3. Learning Role and Experience

- Learning mode: `example`
- Hint level: `high`
- Observable learning goal: 学生能够按四步流程写出范围内全部合法解，并说明每一步中间结果的来源。
- Student action: `multi-step-input`
- Success condition: 四步关键中间量与最终解都正确，并且最终答案全部落在原始待求量范围内。

## 4. Learner Flow

1. Student sees: 左侧主工作区展示单位圆、函数式 `sin/cos/tan(omega x + phi) = value`、已知量与待求量、以及待求量的范围；右侧 guide 展示当前步骤说明与纠偏提示。
2. Student does: 第 1 步在单位圆上标出或输入所有满足函数值的基准角；第 2 步把待求量范围变换成 `omega x + phi` 的范围；第 3 步在新范围内筛出全部对应角 `theta`；第 4 步分别解 `omega x + phi = theta`。
3. System feedback: 每步提交后立即判断。若错误，反馈指出是“角找错了”“范围变换错了”“范围内筛角不全 / 超出范围”还是“最后一次方程回代错误”。
4. Advance or finish condition: 当前步骤正确后解锁下一步；第 4 步要求给出全部合法解后才完成整题。

## 5. Workspace and UI Requirements

- Selected current prototype: 最接近 `triangle-guided-derivation` 的多步推进思路，但不能直接复用其三角形工作区。
- Primary workspace object: 单位圆与区间范围带
- Core mathematical object that must remain visible: 单位圆上的特殊角位置、当前方程 `sin/cos/tan(omega x + phi) = value`、待求量范围、以及变换后的 `omega x + phi` 范围。
- Workspace action area: 所有输入、标角、范围填写、筛角与最终作答都必须在左侧统一工作区完成。
- Guide responsibilities: 只负责显示当前步骤目标、简短提示和针对本步的反馈，不承担主输入。
- Visibility or layout constraints: 单位圆与范围信息必须同时可见，不能在步骤切换时被遮挡或替换；学生不应在不同面板之间来回寻找“当前该在哪里操作”。

## 6. Evaluation and Feedback

- Correctness rule: 系统按四个中间结果链条判分。第 1 步检查是否找全与函数值对应的角；第 2 步检查范围变换是否正确；第 3 步检查是否只保留且保留了范围内全部角；第 4 步检查解方程结果是否完整且都落在原始待求量范围内。
- Allowed equivalents: 角可接受弧度制或角度制，但同一题内必须统一；最终解的排列顺序可不同；对于 `tan` 题允许使用周期表达后再落到范围内列举。
- Wrong-answer pattern(s): 只写一个主值角；把 `x` 的范围直接当作 `omega x + phi` 的范围；忘记 `omega < 0` 时不等号方向变化；在筛角时漏掉周期展开后的角；最终解超出原范围。
- Feedback tone and examples: 语气直接但支持性强。例如“你已经找到了一个对应角，但这个函数值在单位圆上还有别的位置。” “先不要急着解方程，当前需要把待求量的范围换成 `omega x + phi` 的范围。” “这些角本身成立，但不都落在本题给定范围内。”

## 7. Variants and Constraints

- Variable space: 函数类型取 `sin`、`cos`、`tan`；函数值限定在高中常见特殊值，如 `0`、`1/2`、`sqrt(2)/2`、`sqrt(3)/2`、`1`、`-1/2`、`-sqrt(2)/2`、`-sqrt(3)/2`、`-1`；`omega` 取小整数且避免 `0`；`phi` 取能保持特殊角的常见偏移；待求对象可为 `omega`、`x`、`phi` 中的一项，但建议先以“求 `x`”为主版本。
- Exercise pack source priority: `not-applicable`；本 spec 是 `example`，不是 `exercise-pack`。
- Difficulty levers: 先做 `omega > 0` 且求 `x`；再加入 `omega < 0`；再加入 `phi` 非零和平移；最后再扩展到求 `phi` 或求 `omega` 的变式。
- Invalid or misleading cases to avoid: 不要生成需要数值近似的角；不要让范围跨越过大导致列举角数量失控；不要在入门版本中混用角度制与弧度制；不要同时把“求谁”和“范围换算方向”都做成高复杂度变体。

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

- Suggested learning-runtime mapping: 这是一个产品侧 `example`，实现上仍会落到当前 `practice` runtime 容器中；后续可围绕四个相关 `skill-unit` 派生更低提示的 `exercise-pack`。
- Suggested `TaskDefinition` direction: 可新增一个高中目录下的任务，标题方向类似“范围约束下解三角函数方程”，难度建议 `medium`，`engineKind` 不能沿用当前 `triangle-trig`，更像新的“angle-equation”类引擎，`contentId` 可朝 `angle-equation.range-solve.v1` 命名。
- Suggested `ContentDefinition` direction: prompt 需要明确函数类型、`omega x + phi` 结构、待求对象与其范围；scene 应围绕单位圆和范围带设计，而不是三角形；completion policy 适合 `multi-step`；guide steps 可固定为 `find-angles`、`transform-range`、`filter-angles`、`solve-target`。
- Suggested scene / flow / guide / feedback mapping: flow 延续当前 guided example 的逐步解锁思路；guide 继续承担步骤标题、摘要、反馈提示；反馈检查则需要新增“角集合是否完整”和“范围变换是否等价”这两类判定。
- Reusable current repo pieces: 多步 flow、guide step 文案结构、correct/wrong/finish 反馈节奏、整题完成策略都可借鉴 `guidedSolve`；任务目录与内容注册方式可参考 [web/shared/tasks.ts](/D:/GitHub/teaching-tools/web/shared/tasks.ts:1)。

## Appendix B. Tooling Gap

- Why current prototypes fail: 现有 `triangle-role-selection`、`triangle-value-placement`、`triangle-guided-derivation` 都以直角三角形为主对象，无法把单位圆角位置、范围区间和角集合筛选同时作为主工作对象展示；如果强行套用，会把“解三角函数方程”误教成“在三角形里代值”。
- Minimum new capability needed: 一个以“单位圆 + 区间范围 + 多步角集合输入”为核心的新工作区原语。最低需要支持：在单位圆上标记多个角；输入或选择区间端点；对角集合进行范围内筛选；按步骤保存中间答案并逐步判定。
- What can still be reused: 现有多步 guide 流程、任务注册模型、基础反馈框架和 session/runtime 管线仍然可以复用。