# Teaching Tools：可播放数学课堂 PRD

> 文档状态：Draft  
> 版本：v0.1  
> 日期：2026-08-06  
> 仓库：`Gaogao417/teaching-tools`  
> 关联仓库：`Gaogao417/teaching_skills`

---

## 1. 产品概述

Teaching Tools 当前主要用于生成和运行交互式数学教具。系统已经具备数学场景、题目步骤、学生动作、判题引擎和反馈状态等基础能力。

下一阶段需要将其扩展为一个“可播放的数学课堂”：

- 教师提供解题思路、讲解逻辑或讲题视频；
- AI 将其解析为结构化解题策略；
- 系统生成一串可审核、可编辑、可回放的教学动作；
- 浏览器按照动作顺序同步展示讲解、标图、公式书写和学生交互；
- 播放到关键节点时，可以暂停并让学生接管操作；
- 学生完成后，播放器继续后续讲解。

本产品不是通用 AI 课堂生成器，也不是让 AI 每道题重新生成一套 React 页面，而是一个：

> 将教师的数学解题思路编译为可验证、可编辑、可播放、可交互的课堂动作序列的系统。

---

## 2. 背景与问题

### 2.1 当前能力

Teaching Tools 已具备以下基础能力：

- 使用稳定 ID 表示点、边、角、公式、区域等数学对象；
- 使用 `SceneSpec` 描述数学场景；
- 使用 `FlowStep` 描述学生解题步骤；
- 使用 `ActionSpec` 声明某一步允许的学生动作；
- 使用 `RuntimeActionEvent` 表示学生实际操作；
- 使用 `EnginePlugin` 判定学生动作并推进状态；
- 使用前端 Runtime 渲染场景、指令、反馈和步骤；
- 部分图形由 Teaching Skills、TikZ 和 Wolfram Geometry Spec 管线生成。

当前架构更接近“学生做题 Runtime”：

```text
学生动作
→ Engine 判定
→ 状态推进
→ 前端更新
```

### 2.2 当前问题

现有系统还不能稳定表达以下场景：

- 老师说一句话，图上同步高亮对应对象；
- 老师逐步标长度、标角、作辅助线；
- 公式按步骤写出或变形；
- 播放器暂停、回退、跳转；
- 播放到某一步后要求学生操作；
- 学生完成后继续播放；
- 教师提供一段讲题视频，系统将其复刻为浏览器动作；
- AI 根据教师思路选择合适交互，而不是自由发明 UI。

目前 AI 生成效果不稳定的主要原因不是模型不会写前端，而是系统没有充分约束：

- `prompt` 可能同时表示题面、学生指令、教师旁白或模型提示词；
- AI 需要同时决定教学逻辑、交互形式、视觉表现和代码实现；
- 缺少固定交互模板；
- 缺少教学意图到交互模板的映射；
- 缺少对交互一致性的自动检查；
- 每道题可能生成不同的页面和行为。

---

## 3. 产品目标

### 3.1 核心目标

1. 支持将教师的文字思路编译为可播放课堂。
2. 支持将讲题视频转化为候选课堂动作序列。
3. 支持讲解、标图、板书、公式与语音同步。
4. 支持播放器暂停、上一小步、下一小步和跳转。
5. 支持在讲解过程中插入学生交互检查点。
6. 复用现有 Exercise Runtime 和数学场景。
7. 使用固定 DSL 和 Runtime 执行动作，而不是由 AI 生成任意前端代码。
8. 支持教师审核和局部修改 AI 生成结果。

### 3.2 成功标准

对于一类受控题型，教师输入：

> “先求 BD。找到包含 BD 且条件足够的三角形，再根据已知角和边建立正切关系。”

系统可以稳定生成：

- 对应的策略依赖；
- 清晰的学生指令；
- 图形高亮动作；
- 角度和线段标注；
- 公式书写；
- 学生选择三角形的交互；
- 正确与错误反馈；
- 可播放的完整课堂过程。

---

## 4. 非目标

MVP 阶段不包含：

- 通用学科课堂生成；
- 任意题型自动识图和证明；
- 完全自由的手写识别；
- 多个 AI 学生角色；
- 自动生成完整长视频课程；
- 实时多人课堂；
- AI 每题生成独立 React 页面；
- 自研通用游戏引擎；
- 自研完整几何求解器；
- 未经教师审核的视频自动入库。

---

## 5. 目标用户

### 5.1 教师

需求：

- 将自己讲过的题快速转成课后回放；
- 保留自己的解题路线和讲解风格；
- 修改 AI 生成的动作和语言；
- 将同一数学场景用于讲解、练习和讲义输出。

### 5.2 学生

需求：

- 复习课堂上讲过的具体解题思路；
- 按自己的速度播放、暂停和回退；
- 在关键步骤回答问题或操作图形；
- 理解“为什么下一步这样做”，而不是只看最终答案。

---

## 6. 核心用户场景

### 场景 A：教师通过文字生成课堂

教师输入：

```text
先看目标是求 BD。
BD 在直角三角形 ABD 中。
这个三角形中已经知道 AD 和 ∠BAD，所以可以用正切。
先让学生自己选择应该研究哪个三角形。
```

系统输出：

- `StrategyGraph`
- `LessonSpec`
- 语音旁白
- 标图动作
- 公式动作
- 一个学生选择三角形的检查点

### 场景 B：学生播放课上讲过的题

学生进入题目后：

1. 播放器朗读题目；
2. 高亮目标线段；
3. 引导学生寻找包含目标量的三角形；
4. 暂停并要求学生点击三角形；
5. 判定学生选择；
6. 正确后继续标角、写公式和计算；
7. 学生可以回退到任意讲解步骤。

### 场景 C：教师导入讲题视频

教师上传讲题视频后，系统：

1. 提取语音和时间戳；
2. 识别关键书写和标图动作；
3. 将“这条边”“这个三角形”等指代表达对齐到数学对象；
4. 提取解题策略；
5. 生成候选 `LessonSpec`；
6. 标记低置信度对象；
7. 教师确认和修改；
8. 发布为浏览器课堂。

---

## 7. 产品原则

### 7.1 AI 生成数据，不生成应用

错误方式：

```text
教师思路
→ AI 生成 React / HTML / CSS
→ 浏览器运行
```

正确方式：

```text
教师思路
→ AI 生成 LessonSpec
→ 固定 Runtime 解释并执行
```

### 7.2 数学对象必须有稳定 ID

所有动作必须引用数学对象 ID：

```yaml
type: highlight
targetId: edge_BD
```

禁止由模型直接输出像素坐标：

```yaml
type: draw-line
x1: 320
y1: 180
x2: 520
y2: 300
```

对象布局、角弧位置、标签避让等由 Renderer 负责。

### 7.3 游戏式 Runtime，不使用通用游戏引擎

系统采用游戏式设计：

- Scene
- State
- Action
- Allowed Actions
- Rules
- Feedback
- State Transition
- Replay

但渲染仍优先使用：

- React / DOM：题面、指令、公式、步骤和控制器；
- SVG 或 JSXGraph：数学图形；
- KaTeX / MathLive：数学公式。

MVP 不迁移到 Phaser、Unity 或其他游戏引擎。

### 7.4 教学意图与交互形式分离

AI 首先识别教学意图，再从固定交互模板中选择一种：

```text
教学意图
→ 交互模板
→ 参数填充
```

而不是让 AI 自由设计交互。

---

## 8. 总体架构

```text
Teacher Input
├── 文字思路
├── 结构化步骤
├── Teaching Skills 输出
└── 讲题视频
        ↓
Lesson Authoring Pipeline
├── Strategy Extractor
├── Math Object Resolver
├── Explanation Rewriter
├── Interaction Planner
├── Lesson Compiler
├── Validator
└── Teacher Review
        ↓
LessonSpec
├── MathSceneSpec
├── LessonCue[]
├── Narration
├── PresentationAction[]
├── InteractionCheckpoint[]
└── Branches
        ↓
Teaching Tools Web
├── LessonPlaybackRuntime
├── ExerciseRuntime
├── Shared MathSceneRenderer
├── Audio / TTS
├── Lesson Editor
└── Export Adapters
```

---

## 9. 双 Runtime 设计

### 9.1 Exercise Runtime

现有系统继续负责学生做题：

```text
StudentAction
→ EnginePlugin
→ 判定
→ Feedback
→ 下一步
```

核心对象：

- `ExerciseRuntimeSpec`
- `RuntimeActionEvent`
- `EnginePlugin`
- `ServerRuntimeState`
- `ClientDraftState`

### 9.2 Lesson Playback Runtime

新增系统负责教师演示：

```text
LessonCue
→ PresentationAction
→ SceneReducer
→ PresentationState
→ Renderer
```

播放器状态：

```ts
type LessonPlayerStatus =
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "seeking"
  | "waiting_for_student"
  | "branching"
  | "completed"
  | "error";
```

### 9.3 两种 Runtime 的衔接

```text
LessonPlaybackRuntime 播放
→ 到达 InteractionCheckpoint
→ 暂停
→ ExerciseRuntime 接管
→ 学生完成
→ LessonPlaybackRuntime 继续
```

---

## 10. 数据模型

### 10.1 MathSceneSpec

数学场景是两个 Runtime 共用的真值层。

```ts
type MathSceneSpec = {
  id: string;
  entities: MathEntity[];
  zones?: InteractionZone[];
  anchors?: SceneAnchor[];
  metadata?: Record<string, unknown>;
};
```

支持的数学对象包括：

- point
- segment
- line
- ray
- angle
- triangle
- polygon
- circle
- formula
- text
- auxiliary_object

每个对象必须包含稳定 ID。

### 10.2 StrategyGraph

表达解题路线和依赖：

```ts
type StrategyNode = {
  id: string;
  type:
    | "goal"
    | "subgoal"
    | "fact"
    | "structure"
    | "rule"
    | "calculation"
    | "conclusion";
  label: string;
  entityIds?: string[];
};

type StrategyEdge = {
  from: string;
  to: string;
  relation:
    | "requires"
    | "produces"
    | "uses"
    | "selects"
    | "supports";
};
```

示例：

```text
求 BD
→ 选择 △ABD
→ 需要 AD、∠BAD、∠ADB
→ 使用 tan
→ 得到 BD
```

### 10.3 LessonSpec

```ts
type LessonSpec = {
  id: string;
  title: string;
  scene: MathSceneSpec;
  strategyGraph?: StrategyGraph;
  cues: LessonCue[];
  checkpoints?: InteractionCheckpoint[];
  metadata?: {
    sourceType: "text" | "structured" | "video";
    sourceId?: string;
    version: string;
  };
};
```

### 10.4 LessonCue

```ts
type LessonCue = {
  id: string;
  teacherNarration?: string;
  studentInstruction?: string;
  visualActions: PresentationAction[];
  advance:
    | { type: "auto" }
    | { type: "manual" }
    | { type: "wait_for_student"; checkpointId: string };
};
```

字段必须分离：

- `teacherNarration`：老师说什么；
- `studentInstruction`：学生现在做什么；
- `problemStatement`：题面是什么；
- `modelPrompt`：给模型的提示词。

禁止继续使用含义模糊的通用 `prompt` 字段。

---

## 11. Presentation Action DSL

MVP 支持以下动作：

```ts
type PresentationAction =
  | { type: "show"; targetId: string }
  | { type: "hide"; targetId: string }
  | { type: "focus"; targetId: string }
  | { type: "highlight"; targetId: string }
  | { type: "dim_others"; except: string[] }
  | { type: "mark_angle"; targetId: string; label?: string }
  | { type: "mark_length"; targetId: string; label: string }
  | { type: "draw_auxiliary"; entityId: string }
  | { type: "write_equation"; equationId: string; latex: string }
  | { type: "transform_equation"; equationId: string; latex: string }
  | { type: "connect"; sourceId: string; targetId: string }
  | { type: "set_camera"; targetIds: string[] }
  | { type: "reset_scene" };
```

要求：

- 所有 `targetId` 必须存在；
- 动作必须可重放；
- 动作必须可从快照恢复；
- 动作必须具有确定性；
- 同一 `LessonSpec` 在不同 Renderer 中应保持同一数学语义。

---

## 12. 固定交互模板

MVP 限制为六种模板：

### 12.1 `select-object`

适用于：

- 选择目标线段；
- 选择三角形；
- 选择角；
- 选择已知条件。

### 12.2 `enter-expression`

适用于：

- 填写公式；
- 输入代数式；
- 输入数值。

### 12.3 `assign-label`

适用于：

- 把“对边、邻边、斜边”拖到图形对象；
- 把数值分配到边；
- 把条件分配到对应对象。

### 12.4 `compose-expression`

适用于：

- 拼接比例式；
- 拼接等式；
- 组合计算步骤。

### 12.5 `order-steps`

适用于：

- 排列解题步骤；
- 排列倒推链；
- 排列证明过程。

### 12.6 `choose-strategy`

适用于：

- 选择先求哪个量；
- 选择进入哪个图形；
- 选择正切、相似、勾股等路线。

交互 UI 不由 AI 自由生成。AI 只负责：

- 选择模板；
- 填写参数；
- 生成指令；
- 填写正确答案；
- 生成错误反馈。

---

## 13. 教学意图到交互模板的映射

```text
识别数学对象
→ select-object

建立对象与名称或数量的对应
→ assign-label

建立数学关系
→ compose-expression

填写计算结果
→ enter-expression

选择解题路线
→ choose-strategy

理解步骤依赖
→ order-steps

仅需要观察
→ 不创建学生交互，只生成 PresentationAction
```

该映射应以代码或配置形式保存，不只存在于 Prompt 文本中。

---

## 14. 视频复刻流程

### 14.1 输入

- 视频文件；
- 可选原题图片/PDF；
- 可选标准答案；
- 可选已有 `MathSceneSpec`。

### 14.2 处理流程

```text
视频
→ ASR 与时间戳
→ 关键帧检测
→ 书写与标图事件识别
→ 数学对象对齐
→ 策略提取
→ 候选 LessonSpec
→ 一致性校验
→ 教师审核
```

### 14.3 不确定项

所有低置信度结果必须显式暴露：

```yaml
uncertainties:
  - cueId: choose_triangle
    type: object_reference
    candidates:
      - triangle_ABD
      - triangle_BCD
    confidence: 0.64
```

教师可以：

- 选择正确对象；
- 删除错误动作；
- 修改旁白；
- 调整动作顺序；
- 重新生成局部 cue。

---

## 15. Lesson Editor

MVP 教师编辑器需要支持：

- 播放/暂停；
- 上一步/下一步；
- cue 列表；
- 修改老师旁白；
- 修改学生指令；
- 增删动作；
- 选择动作目标对象；
- 调整 cue 顺序；
- 插入学生检查点；
- 查看低置信度项；
- 预览最终课堂；
- 保存版本。

不要求第一版提供自由时间轴或复杂视频剪辑能力。

---

## 16. Renderer 设计

定义统一接口：

```ts
interface MathSceneRenderer {
  loadScene(scene: MathSceneSpec): void;
  applyAction(action: PresentationAction): void;
  restore(snapshot: PresentationState): void;
  getSnapshot(): PresentationState;
  reset(): void;
}
```

第一阶段：

- 复用已有 SVG/React Renderer；
- 支持基本高亮、隐藏、标注和公式；
- 不立即全面迁移 JSXGraph。

第二阶段：

- 增加 `JSXGraphRenderer`；
- 用于几何依赖、动态点线关系和交互几何。

长期支持：

```text
MathSceneSpec
├── ExistingSvgRenderer
├── JSXGraphRenderer
├── TikZRenderer
└── VideoExporter
```

TikZ 保留为讲义、PDF 和打印后端，不再承担课堂 Runtime。

---

## 17. 状态与回放

播放器不能依赖“反向执行动作”回退。

推荐做法：

- 每个 cue 结束后保存 `PresentationState` 快照；
- 跳转时恢复最近快照；
- 再重放目标 cue 之前的动作；
- 所有动作使用纯 reducer 更新状态。

```ts
function reducePresentationAction(
  state: PresentationState,
  action: PresentationAction
): PresentationState;
```

要求：

- 同一初始状态和同一动作序列得到同一结果；
- seek 后画面与顺序播放一致；
- 刷新页面后可以恢复当前位置。

---

## 18. 自动校验与 Lint

### 18.1 Schema 校验

- 所有 ID 唯一；
- 所有 target ID 存在；
- checkpoint 引用存在；
- equation ID 唯一；
- action 参数满足类型约束。

### 18.2 交互一致性校验

例如 `select-object`：

- 必须存在 `studentInstruction`；
- expected target 必须属于 selectable 集合；
- selectable 对象必须可见；
- hover 和 selected 状态必须可感知；
- immediate 模式不得同时显示提交按钮；
- 错误提示不得直接泄露答案。

### 18.3 语言与动作一致性校验

示例规则：

- 旁白包含“点击”时，当前 cue 必须存在学生交互；
- 指令要求选择三角形时，selectable 类型必须是 triangle；
- 旁白提到 BD 时，场景中必须存在对应对象；
- 旁白说“高亮”不要求学生操作；
- `studentInstruction` 必须是可执行指令，不能只是解释性语言。

### 18.4 数学一致性校验

- 公式引用对象必须存在；
- 目标量与公式中的未知量一致；
- 使用定理所需条件必须已知或已推导；
- 视频中提取的公式与标准解法冲突时标记审核。

---

## 19. AI Authoring Pipeline

### 19.1 阶段一：策略提取

输入：

- 题目；
- 场景；
- 教师思路；
- 可选答案。

输出：

- 目标；
- 子目标；
- 关键图形；
- 已知条件；
- 缺失条件；
- 所用规则；
- 依赖关系。

### 19.2 阶段二：教学脚本

将策略图转换为：

- 老师旁白；
- 学生指令；
- 视觉动作；
- 检查点；
- 错误提示。

### 19.3 阶段三：编译与校验

- 生成 `LessonSpec`；
- 运行 schema 校验；
- 运行交互 lint；
- 运行数学检查；
- 只对失败 cue 局部重试。

### 19.4 阶段四：教师审核

教师确认后才能发布。

---

## 20. MVP 范围

### 20.1 题型范围

第一版只支持一类受控题型：

- 初中几何；
- 优先选择解直角三角形或相似三角形；
- 原图和数学对象已结构化；
- 不要求从图片完全自动识图。

### 20.2 动作范围

支持：

- focus
- highlight
- dim
- mark-angle
- mark-length
- draw-auxiliary
- write-equation
- transform-equation
- show/hide
- pause
- wait-for-student

### 20.3 交互范围

支持：

- select-object
- enter-expression
- assign-label
- choose-strategy

### 20.4 输入范围

支持：

- 教师文字思路；
- 已有 Teaching Skills 分析结果；
- 视频导入作为实验能力，不作为 MVP 必达项。

---

## 21. 验收标准

### 21.1 功能验收

对于至少 10 道同类几何题：

1. 能加载同一份 `MathSceneSpec`；
2. 能生成完整 `LessonSpec`；
3. 能逐 cue 播放；
4. 能暂停、上一 cue、下一 cue；
5. 能从任意 cue 跳转；
6. 能同步显示旁白和视觉动作；
7. 能插入至少一种学生交互；
8. 学生交互完成后能继续播放；
9. 刷新后能恢复播放位置；
10. 教师能编辑旁白、指令和目标对象。

### 21.2 质量验收

抽样 10 道题，要求：

- 数学对象引用准确率 ≥ 95%；
- 动作目标不存在的情况为 0；
- 学生指令与交互类型不一致的情况为 0；
- 教师无需修改即可播放的 cue 比例 ≥ 70%；
- 教师平均修订时间低于手工制作同类演示的 30%；
- 回退和 seek 后画面一致率为 100%。

### 21.3 教学验收

每个学生检查点必须满足：

- 学生知道要做什么；
- 可操作对象有明确 affordance；
- 正确答案存在唯一或明确接受集合；
- 错误反馈针对具体误区；
- 不因 UI 细节导致答错；
- 不直接泄露下一步答案。

---

## 22. 里程碑

### M0：现状审计

- 梳理现有 `SceneSpec`；
- 梳理现有 Action 和 Runtime；
- 区分 StudentAction 与 PresentationAction；
- 确认可复用 Renderer 能力。

### M1：Lesson Playback Runtime

- 定义 `LessonSpec`；
- 定义 `LessonCue`；
- 定义 Presentation Action；
- 实现 reducer；
- 实现播放、暂停、前后跳转；
- 使用手写 LessonSpec 跑通一道题。

### M2：Exercise Runtime 接入

- 添加 checkpoint；
- 播放器切换到学生交互；
- 完成后恢复播放；
- 复用现有 EnginePlugin。

### M3：AI Lesson Compiler

- 教师文字思路转 StrategyGraph；
- StrategyGraph 转 LessonSpec；
- 添加 schema 和 lint；
- 支持局部重新生成。

### M4：教师编辑器

- cue 编辑；
- 动作目标选择；
- 指令修改；
- 预览和版本保存。

### M5：视频复刻实验

- ASR；
- 关键帧；
- 对象对齐；
- 候选动作；
- 不确定项审核。

---

## 23. 风险与应对

### 风险 1：AI 仍自由发明交互

应对：

- 固定交互模板；
- AI 只能选择模板和填写参数；
- 交互设计规则进入代码。

### 风险 2：数学语义和显示层耦合

应对：

- 所有动作引用稳定对象 ID；
- MathSceneSpec 与 Renderer 解耦；
- 不允许模型输出像素位置。

### 风险 3：视频复刻成本过高

应对：

- 视频只生成候选结果；
- 优先要求提供原题和场景；
- 按 cue 局部审核；
- MVP 不依赖视频能力。

### 风险 4：同时改造过多基础设施

应对：

- 第一版复用现有 SVG Renderer；
- 暂不全面迁移 JSXGraph；
- 暂不引入游戏引擎；
- 先手写 LessonSpec 验证 Runtime。

### 风险 5：动作 DSL 不断膨胀

应对：

- 动作保持原子化；
- 复杂教学行为由多个动作组合；
- 新增动作必须证明无法由已有动作组合表达。

### 风险 6：生成材料看似完整但教学质量低

应对：

- StrategyGraph 先于讲解生成；
- 教师审核为发布前必经步骤；
- 建立真实学生使用反馈；
- 记录哪些 cue 被教师频繁修改。

---

## 24. 关键指标

### 生产效率

- 教师制作一题所需时间；
- AI 初稿生成时间；
- 教师修改 cue 数；
- 局部重新生成次数；
- 视频转课堂的平均审核时间。

### 生成质量

- 对象引用准确率；
- Schema 通过率；
- Lint 通过率；
- 数学验证通过率；
- 无修改可发布 cue 比例。

### 学生体验

- 播放完成率；
- 回退次数；
- 检查点正确率；
- 错误后再次尝试成功率；
- 学生在指令栏停留时间；
- 因不理解操作而产生的无效点击数。

---

## 25. 待确认问题

1. 第一批 MVP 题型选解直角三角形，还是相似三角形？
2. 当前 `SceneSpec` 是否足以表达三角形、角、辅助线和公式对应关系？
3. 现有 Renderer 是否支持对象级高亮、隐藏和恢复？
4. `prompt` 当前在代码中的所有实际含义有哪些？
5. 第一版语音使用浏览器 TTS，还是预生成音频？
6. 教师编辑器是否需要支持自由拖动时间轴？
7. 视频复刻是否要求保留教师原声？
8. LessonSpec 是否与题库版本绑定？
9. 是否需要保存不同教师对同一道题的不同讲法？
10. 学生能否在播放开始前选择某一种解题路线？

---

## 26. 最终产品定义

Teaching Tools 不再只是一个“AI 生成教具”的工具。

它将成为：

> 一个以数学场景和动作 DSL 为基础，把教师解题思路、结构化教学步骤或讲题视频，编译为可审核、可编辑、可播放、可交互的浏览器数学课堂的系统。

系统采用双 Runtime：

- `ExerciseRuntime`：学生操作数学世界；
- `LessonPlaybackRuntime`：老师和播放器演示数学世界。

二者共享同一份 `MathSceneSpec`，并通过学生检查点相互切换。
