# Domain Model

## 摘要

这个项目的领域模型不应只描述“题目数据”，而应描述“教学关卡运行时”。

也就是说，模型不仅要覆盖：

- 题目是什么
- 答案是什么

还要覆盖：

- 场景里有哪些对象
- 学生可以做哪些动作
- 这些动作如何按步骤推进
- 系统如何把反馈传给前端运行时

因此，领域模型的核心对象应是 `ExerciseRuntimeSpec`，而不是仅仅是 `MeaningProblem` / `RatioToSideProblem` / `GuidedSolveProblem`。

## 建模原则

- 题型是内容实例，不是页面类型
- 场景、动作、流程、反馈必须可以独立建模
- 后端保存真值，前端消费运行时描述
- DSL 必须描述语义，不描述 DOM
- 通用模型优先于题型特化字段

## 顶层对象

推荐最终围绕下面 7 类对象建模：

- `Task`
- `ExerciseInstance`
- `SceneSpec`
- `FlowSpec`
- `GuideSpec`
- `FeedbackSpec`
- `RuntimeState`

## ExerciseRuntimeSpec

`ExerciseRuntimeSpec` 是前端运行时消费的顶层对象，用来把场景、流程、引导、反馈组合成一个可执行关卡。

建议结构：

```ts
type ExerciseRuntimeSpec = {
  instance: ExerciseInstance
  runtimeState: ServerRuntimeState
  draftState?: ClientDraftState
}
```

当前阶段也可以把 `draftState` 保留在前端，不直接放入服务端响应；但从概念上，它属于同一运行时对象的一部分。

## Task

`Task` 是教学内容入口，用于首页任务树和会话创建，不直接代表一次练习中的关卡实例。

建议结构：

```ts
type Task = {
  id: string
  title: string
  summary: string
  difficulty: "easy" | "medium" | "hard"
  category: string
  engineKind: string
}
```

其中：

- `id` 是任务标识
- `engineKind` 表示该任务由哪种运行时模板承接

`meaning`、`ratioToSide`、`guidedSolve` 当前可以先继续作为 `TaskId`，但模型上应理解为具体任务，而不是固定死的页面分支。

## ExerciseInstance

`ExerciseInstance` 是一次具体关卡实例，属于 session 中的一题。

建议结构：

```ts
type ExerciseInstance = {
  instanceId: string
  taskId: string
  engineKind: string
  prompt: string
  scene: SceneSpec
  flow: FlowSpec
  guide: GuideSpec
  feedback: FeedbackSpec
}
```

它是后端发给前端运行时的核心内容对象。

## SceneSpec

`SceneSpec` 描述左侧工作区里有哪些对象，以及这些对象如何被识别和操作。

### 作用

- 定义工作区中的几何对象
- 定义可交互区域
- 定义输入锚点
- 定义只读标签和视觉标记

### 建议结构

```ts
type SceneSpec = {
  sceneKind: "triangle" | "number-line" | "coordinate-plane" | "custom"
  entities: SceneEntity[]
  zones: InteractionZone[]
  anchors: SceneAnchor[]
  overlays?: SceneOverlay[]
}
```

### SceneEntity

```ts
type SceneEntity =
  | TriangleEntity
  | EdgeEntity
  | VertexEntity
  | FormulaEntity
  | TextEntity
```

例如三角形类题目可以至少包含：

- `TriangleEntity`
- 3 个 `EdgeEntity`
- 3 个 `VertexEntity`

### SceneOverlay

`SceneOverlay` 用于定义不直接参与点击、但会跟随运行时状态变化的可视层。

```ts
type SceneOverlay = {
  id: string
  overlayKind: "highlight" | "mask" | "guide-line" | "badge"
  targetRef?: string
}
```

### InteractionZone

`InteractionZone` 用于抽象命中区，而不是直接依赖某个具体 SVG 实现。

```ts
type InteractionZone = {
  id: string
  zoneKind: "edge" | "vertex" | "region" | "slot" | "input"
  targetRef: string
  shape: ZoneShape
  accepts?: AllowedActionType[]
}

type ZoneShape =
  | { type: "lineCorridor"; from: string; to: string; width: number }
  | { type: "polygon"; points: Array<{ x: number; y: number }> }
  | { type: "anchor"; x: number; y: number; radius?: number }
```

这层定义是为了保证：

- 斜边可以有独立命中区定义
- 工作区交互不绑死在某一版 DOM 结构上

### SceneAnchor

`SceneAnchor` 用于定义值输入、标签、公式槽等挂载点。

```ts
type SceneAnchor = {
  id: string
  anchorKind: "value-input" | "label" | "formula-slot" | "badge"
  entityRef?: string
  x: number
  y: number
}
```

## FlowSpec

`FlowSpec` 描述关卡如何推进，等价于游戏任务系统里的 mission flow。

### 作用

- 定义步骤列表
- 定义当前激活步骤
- 定义每一步允许的动作
- 定义提交模式
- 定义解锁条件

### 建议结构

```ts
type FlowSpec = {
  steps: FlowStep[]
  currentStepId: string
  completionPolicy: "single-step" | "multi-step" | "whole-problem"
}

type FlowStep = {
  id: string
  title: string
  goal: string
  status: "locked" | "active" | "done"
  allowedActions: ActionSpec[]
  submitMode: "immediate" | "explicit"
}
```

`guidedSolve` 的分步推进、`meaning` 的先选分子再选分母，都应落在这层，而不是散在页面分支里。

## ActionSpec

`ActionSpec` 是 DSL 的核心，定义“学生现在可以做什么”。

它应是语义动作，而不是前端实现动作。

### 建议动作原语

```ts
type AllowedActionType =
  | "select"
  | "input"
  | "assign"
  | "compose"
  | "clear"
  | "submit"

type ActionSpec =
  | {
      type: "select"
      target: string
      selectionKind: "single" | "ordered"
    }
  | {
      type: "input"
      target: string
      valueKind: "text" | "integer" | "length" | "ratio-part"
    }
  | {
      type: "assign"
      source: string
      target: string
    }
  | {
      type: "compose"
      target: string
      slots: string[]
    }
  | {
      type: "submit"
      stepId: string
    }
```

这套原语是为了抽象出所有题型共享的教学交互范式：

- `select`
  识别对象
- `input`
  对对象输入值
- `assign`
  把值放到目标上
- `compose`
  组成表达式或关系
- `submit`
  推进当前步骤

## GuideSpec

`GuideSpec` 描述右侧引导区应该向学生展示什么。

### 作用

- 呈现当前目标
- 呈现步骤列表
- 呈现教师口令
- 呈现错误提示与下一步提示

### 建议结构

```ts
type GuideSpec = {
  banner: string
  stepItems: GuideStepItem[]
  hint?: string
  statusCopy?: string
}

type GuideStepItem = {
  stepId: string
  title: string
  status: "locked" | "active" | "done"
  summary?: string
}
```

右侧引导区使用这层模型，不直接绑定具体题型组件。

## FeedbackSpec

`FeedbackSpec` 描述动作结果在前端应该触发什么反馈类型。

### 作用

- 统一正确 / 错误 / 完成反馈
- 统一局部高亮与全局反馈 key
- 让组件库和运行时通过 key 协作

### 建议结构

```ts
type FeedbackSpec = {
  correct: FeedbackCue[]
  wrong: FeedbackCue[]
  finish: FeedbackCue[]
}

type FeedbackCue = {
  key: string
  scope: "global" | "workspace" | "guide"
  targetRef?: string
}
```

这里的 `key` 只表达语义，例如：

- `pulse-correct`
- `shake-wrong`
- `highlight-edge`
- `play-correct-sound`

前端运行时负责把 key 映射到具体动画和音效实现。

## RuntimeState

`RuntimeState` 是当前关卡实例在某一时刻的可见状态。

它由后端主状态与前端局部草稿态共同组成。

### 服务端主状态

建议结构：

```ts
type ServerRuntimeState = {
  phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished"
  currentStepId: string
  completedStepIds: string[]
  problemStatus: "pending" | "correct" | "wrong"
  attempts: number
}
```

### 前端局部草稿态

建议结构：

```ts
type ClientDraftState = {
  selections: Record<string, string[]>
  inputs: Record<string, string>
  focusTarget?: string
  transientFeedback?: string[]
}
```

这两部分必须分开建模。

前端可以修改 `ClientDraftState`，但不能伪造 `ServerRuntimeState`。

## Session

`Session` 是一次练习会话容器。

建议结构：

```ts
type Session = {
  sessionId: string
  studentName: string
  taskId: string
  exerciseInstances: ExerciseInstance[]
  currentIndex: number
  phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished"
  elapsedMs: number
}
```

`Session` 属于 runtime host，负责在多个关卡实例之间推进。

## 标准动作事件

前端组件库与运行时之间不应直接传业务 payload，而应传标准动作事件。

建议结构：

```ts
type RuntimeActionEvent = {
  type: AllowedActionType
  targetId?: string
  value?: string
  sourceId?: string
  stepId?: string
}
```

运行时再把这些动作转换为 API payload。

这样组件层就不需要理解：

- 当前是 Group 1 还是 Group 3
- 当前要调哪个后端接口字段

## 题型如何落入通用模型

### meaning

- `SceneSpec`
  三角形、三条边、两个公式槽
- `FlowSpec`
  先选分子，再选分母
- `ActionSpec`
  `select + compose`

### ratioToSide

- `SceneSpec`
  三角形、边输入锚点
- `FlowSpec`
  填完三边后提交
- `ActionSpec`
  `input + submit`

### guidedSolve

- `SceneSpec`
  三角形、步骤输入锚点、最终分式槽
- `FlowSpec`
  多步骤顺序解锁
- `ActionSpec`
  `input + compose + submit`

这说明当前 3 个题型不是 3 套架构，只是同一 runtime model 的 3 种内容实例。

## 非目标

本模型当前不覆盖：

- 像素级布局策略
- 组件样式实现
- 动画具体参数
- 前端框架细节
- 教研后台编辑器

这些都应在领域模型之下单独解决。

## 与 `shared/contracts.ts` 的关系

后续应按下面顺序推进：

1. 先在本文件冻结通用 runtime model
2. 再把 `shared/contracts.ts` 改造成 runtime-first 的契约
3. 最后把现有 `MeaningProblem` / `RatioToSideProblem` / `GuidedSolveProblem` 迁移为该模型的具体实例

在迁移完成前，可以暂时保留现有题型字段，但新增设计应优先围绕：

- `SceneSpec`
- `FlowSpec`
- `GuideSpec`
- `FeedbackSpec`
- `RuntimeActionEvent`

来扩展，而不是继续给单个题型堆专属字段。
