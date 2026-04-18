---
spec_version: v3
spec_kind: exercise-pack
working_title: 浮力受力分析——知三求二
grade_band: 初中
topic_or_chapter: 液体压强与浮力
target_concept: 弹簧测力计吊物块部分浸入轻质杯中水里，学生对物块或"物块+杯子+水"整体进行受力分析，利用两个独立方程从三个已知量求两个未知量
primary_skill_unit: buoyancy-system-selection
related_skill_units: force-equation-substitution
learning_mode: exercise
prototype_candidate: single-input-custom
fit_level: new-tool-needed
architecture_fit: supported
interaction_ownership: guide-step
difficulty: medium
estimated_minutes: 3-5
step_mode: multi-step
repo_mapping_ready: partial
---

# 浮力受力分析——知三求二

## 1. Spec Summary

- Spec kind: `exercise-pack`
- Spec intent: 让学生在弹簧测力计吊物块部分浸入水中的经典场景下，反复练习"对谁受力分析"这一核心选择：对物块单独分析还是对"物块+杯子+水"整体分析。每一题给出 5 个物理量中的 3 个，学生需根据条件选择正确的分析对象、代入对应方程、算出 2 个未知量。
- Learner-facing seed or generation rule: 场景固定为弹簧测力计吊物块，物块部分浸入轻质杯子里的水中。题目随机给出 5 个物理量（测力计示数 F、浮力 F浮、物块重力 G物、水的重力 G水、桌面受到杯子的压力 F桌）中的 3 个，其中 G物 可替换为 m物、G水 可替换为 m水（g = 10 N/kg）。学生分步填写 2 个未知量的数值。
- Why this spec is worth building: 这类题的常见失分点不是计算能力不足，而是学生不会根据已知条件灵活选择受力分析对象——要么只盯着物块列不出整体方程，要么想列整体方程却漏掉浮力对杯底的附加压力。本练习包用短平快的多题循环把这个"选谁分析"的判断力练出来。

## 2. Skill Unit Definition

- Primary skill unit: `buoyancy-system-selection`
- Related skill units: `force-equation-substitution`
- Skill unit goal: 给定部分浸入场景的若干已知力/质量，学生能根据待求量判断该对物块单独列方程（F + F浮 = G物）还是对整体列方程（F + F桌 = G水 + G物），并正确代入求解。
- Prerequisite knowledge: 受力分析基本步骤；重力 G = mg；阿基米德原理 F浮 = ρ液 g V排；弹簧测力计原理；整体法与隔离法的概念。
- Likely misconception: 学生只会对物块做受力分析，遇到需要 F桌 时不会切换到整体法；或者反过来只列整体方程，不会利用物块方程先求出一个量再代入整体方程。另一个常见错误是把 F桌 误认为等于 G水（忽略了浮力对杯底的附加压力）。
- Mastery evidence: 连续 3–4 题中，学生均能一次性算对两个未知量，涵盖至少两种不同的"知3"组合，且错误反馈表明已不存在"选错分析对象"类型的失误。

## 3. Learning Role and Experience

- Learning mode: `exercise`
- Hint level: `medium`
- Observable learning goal: 每道题中，学生分两步填入两个未知量的数值，两个数值都正确才算通过。系统能从常见错误答案推断学生是否选错了受力分析对象。
- Student action: `multi-step-input`
- Success condition: 两个未知量数值均在允许误差范围内（绝对误差 ≤ 0.1 或相对误差 ≤ 1%）。

## 4. Learner Flow

1. Student sees: 左侧工作区展示受力示意图——弹簧测力计悬挂物块，物块部分浸入杯中水面以下，杯子置于桌面。图上标注 5 个力的箭头与符号，其中 3 个标有已知数值（含单位），2 个标为"?"。右侧 guide 展示当前步骤目标、两个核心方程的速查提示、以及简短提示语。
2. Student does:
   - **第 1 步**：在工作区的输入锚点中填入第一个未知量的数值并提交。
   - **第 2 步**：填入第二个未知量的数值并提交。
3. System feedback: 每步提交后立即判断。若数值错误，反馈根据错误模式分类——"你可能选错了分析对象，试试另一个方程"或"代入方向反了"或"计算有误"——并保留该步让学生重试。
4. Advance or finish condition: 两步都正确后题目完成，自动进入下一题。单题每步最多 3 次提交机会，超过后展示该步正确答案与所用方程。

## 5. Workspace and UI Requirements

- Selected current prototype: 无现有原型可用。交互节奏最接近 `single-input-custom`（每步一个输入 + 提交），但核心可视对象是物理受力示意图，当前原型无法承载。
- Architecture fit: `needs-workspace-primitive`。核心输入动作（填数值 + 提交）可复用现有 `value-input` 锚点和 `submit` action，但工作区需要一个全新的 sceneKind 来渲染物理受力示意图。输入控件不属于对力图本身的直接操作，属于 step-local answer entry。
- Interaction ownership: `guide-step`。每步的核心学习者动作是填入一个数值——这是 step-local 的回答提交，不是对可视对象的直接操作（学生不需要拖拽箭头或点选图上区域）。
- Primary workspace object: 物理场景示意图，包含弹簧测力计、物块、杯中水面、桌面，以及 5 个力的标注箭头。已知量显示数值，未知量显示"?"。学生作答后，"?"替换为正确数值或学生填入的数值。
- Core mathematical object that must remain visible: 受力示意图全程可见；两个核心方程（F + F浮 = G物 和 F + F桌 = G水 + G物）在 guide 区始终可见，作为学生的参考工具。
- Workspace responsibility: 渲染受力示意图并全程保持可见；在示意图附近提供当前步骤的 `value-input` 锚点；根据学生作答更新"?"标注的显示。不做交互式力学对象操作。
- Guide responsibility: 显示当前步骤目标（"求 [未知量名称]"）；始终显示两个核心方程作为速查提示；展示即时反馈（正确/错误/错误类别）。
- Guide-step input policy: 每步有一个数值输入 + 提交按钮。输入框显示待求量的符号名（如"F浮 = ?"）和单位提示（"N"或"kg"）。学生填入数字后点击提交，系统校验。
- Visibility or layout constraints: 受力示意图全程可见，步骤切换时不能替换或隐藏；两个核心方程全程可见；学生不应需要在不同面板之间寻找输入位置。
- Forbidden shortcuts: 不允许在工作区内搭建 exercise-local 的表单面板来承载选择和输入——如果需要选择交互，应扩展为通用的 guide-step 或 anchor 原语。

## 6. Evaluation and Feedback

- Correctness rule: 与精确计算结果的绝对误差不超过 0.1（或相对误差 1%）。系统根据学生的错误值自动推断错误类型。
- Allowed equivalents: G 与 m 互换（g = 10 N/kg）；质量的单位可用 kg 或 g，只要数值正确；力的单位默认 N。
- Wrong-answer pattern(s):
  - **选错分析对象型**：F桌 答为 G水（只用整体方程但漏了 F浮 的贡献），或 F浮 答为 G物 − F桌 + G水（把两个方程的变量搞混）。反馈方向："这个量不在你选的分析对象方程里，试试另一个分析对象。"
  - **代入方向反转型**：F浮 = F − G物（应为 G物 − F），F桌 = G物 − G水 + F（应为 G水 + F浮）。反馈方向："代入方向反了，检查一下等号两边谁减谁。"
  - **纯计算错误型**：答案接近正确值但有小偏差。反馈方向："方程对了，再算一遍。"
- Feedback tone and examples: 语气简短、可继续作答。示例：
  - "你算出的 F桌 和 G水 相等，但想想看，物块浸入水里后，水会对杯底产生额外的压力——试试整体法方程。"
  - "数值代入方向反了：F浮 = G物 − F，不是 F − G物。"
  - "接近了，再算一遍看看。"

## 7. Variants and Constraints

- Variable space:
  - 5 个物理量：F、F浮、G物、G水、F桌。
  - 8 种有效"知3"组合（排除 {F, F浮, G物} 和 {F浮, G水, F桌}，因为它们各有一个方程退化为恒等式，无法解出剩余两个未知量）。
  - G物 可替换为 m物，G水 可替换为 m水，增加辨识难度。
  - 数值生成规则：先选 G物、F浮、G水 为自由正整数参数，满足 F浮 < G物；则 F = G物 − F浮，F桌 = G水 + F浮 自动确定。建议 G物 取 3–15 N，F浮 取 1–(G物−1) N，G水 取 2–10 N，确保所有量均为正整数或简单一位小数。
- Exercise pack source priority: 每次练习生成 4–6 题，覆盖至少 3 种不同的"知3"组合，并在 G/m 替换上混搭。
- Difficulty levers:
  - 入门：两个未知量分别只出现在一个方程中（如未知量是 F浮 和 G水），选择分析对象最直观。
  - 进阶：某个未知量出现在两个方程中（如 F 或 G物），学生需判断先用哪个方程。
  - 挑战：至少一个已知量使用 m 而非 G，增加一次单位换算步骤。
- Invalid or misleading cases to avoid:
  - 不生成 F浮 = 0（物块未浸入）或 F浮 = G物（违反"部分浸入"设定）的极端值。
  - 不生成 F桌 = G水（这会暗示 F浮 = 0）。
  - 所有数值应保证"部分浸入"条件成立：0 < F浮 < G物。

## 8. Review Checklist

- [x] Spec kind is explicit
- [x] Primary skill unit is explicit
- [x] Learning mode is explicit or marked `not-applicable`
- [x] One observable learning goal
- [x] One dominant learner action per step
- [x] Current prototype choice is justified or marked `not-applicable`
- [x] Core diagram or math object stays visible when applicable
- [x] Guide/workspace ownership is explicit
- [x] Step-local inputs are assigned to the right surface
- [x] Feedback matches the likely misconception
- [x] Success condition is directly testable

## Appendix A. Repo Mapping

- Suggested learning-runtime mapping: 这是一个产品侧 `exercise-pack`，实现容器可沿用当前 `practice` runtime 的多步会话、guide 与反馈状态机。但工作区的核心可视对象需从三角形/单位圆换成物理受力示意图。
- Runtime primitive mapping:
  - `value-input` 锚点（复用）：每步的数值输入。
  - `submit` / `clear` action（复用）：提交与清空。
  - 新 sceneKind `force-diagram`（新增）：渲染受力示意图，标注 5 个力的箭头与数值/问号。
  - 无需新的 anchor 类型或 action 类型。
- Architecture fit rationale: 输入交互完全落在 guide-step ownership 下（step-local value entry），与 `demoCounter` 的交互模式一致。唯一的新增是 `force-diagram` sceneKind——它是一个只读的可视对象，不承载交互锚点，因此不引入新的 ownership 矛盾。输入锚点可放在 scene 的 entities 列表中（与 `demoCounter` 的做法一致），不需要 exercise-local form panel。
- Suggested `TaskDefinition` direction: 可在初中物理目录下新增任务，标题方向"浮力受力分析——知三求二"，难度 `medium`，需要新 `engineKind`，命名方向 `buoyancyForceAnalysis`。
- Suggested `ContentDefinition` direction: prompt 模板需说明场景、已知量、待求量；scene 以受力示意图为核心；completion policy 为 `multi-step`（2 步）；guide step 可固定为 `solve-unknown-1`、`solve-unknown-2`，每步包含一个数值输入。
- Suggested scene / flow / guide / feedback mapping:
  - scene: 新 sceneKind `force-diagram`，entities 包含弹簧测力计、物块、杯、水面、桌面图形，加上 5 个力的标注（3 个显示数值，2 个显示"?"），以及每步的 `value-input` 锚点。
  - flow: 2 步，每步 allowedActions 包含 `input`（填数值）、`clear`、`submit`。
  - guide: 逐步显示目标、两个核心方程速查、提示与反馈。
  - feedback: correctness 检查数值精度；wrong 时根据错误模式分类反馈（选错分析对象 / 代入方向反 / 纯计算错误）。
- Reusable current repo pieces: 多步 flow 容器、guide step 结构、correct/wrong/finish 反馈状态机、`value-input` 锚点与 `submit`/`clear` action、session/runtime 管线、EnginePlugin 接口、任务注册与结果持久化链路均可复用。scene rendering（受力示意图）需要新写。

## Appendix B. Tooling Gap

- Why current prototypes fail: 现有原型（`triangle-role-selection`、`triangle-value-placement`、`triangle-guided-derivation`、`single-input-custom`）全部以三角形或极简单输入为核心可视对象。本题需要一个全新的可视对象类型——物理受力示意图，包含弹簧测力计、物块、杯中水面、桌面，以及 5 个力的标注箭头。强行套用三角形原型会把浮力受力分析误导为几何代值题。
- Minimum new capability needed:
  1. 新 sceneKind `force-diagram`：渲染物理场景示意图及力的标注箭头。这是一个只读可视对象，不承载交互锚点。标注内容（数值 / "?"）由 runtime snapshot projector 根据 engine state 动态填充。
  2. 新 scenario bank：随机生成满足物理约束的"知3求2"题目参数，包括 G↔m 替换和 8 种有效"知3"组合的枚举。
  3. 新 step evaluator：判定数值是否在允许误差内，并根据错误值推断错误类型（选错分析对象 / 代入方向反 / 纯计算错误）。
- What can still be reused: 现有 session/runtime 管线、多步 flow 容器、guide step 结构、`value-input` 锚点、`submit`/`clear` action、反馈状态机（correct_pause / wrong_feedback）、EnginePlugin 接口（createState / restoreState / buildRuntime / reduceAction）、任务与内容注册模式、instance/result 持久化链路均可继续沿用。
