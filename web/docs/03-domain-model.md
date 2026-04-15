# Domain Model

## 摘要

这个项目的领域模型不应只描述“题目数据”，而应描述“教学关卡运行时”。

因此，顶层模型不再围绕 `MeaningProblem` / `RatioToSideProblem` / `GuidedSolveProblem` 展开，而围绕下面 8 类对象展开：

- `TaskDefinition`
- `ContentDefinition`
- `ExerciseInstance`
- `ExerciseRuntimeSpec`
- `ServerRuntimeState`
- `ClientDraftState`
- `PracticeSessionSnapshot`
- `ResultSnapshot`

其中最关键的不是再发明一个大表，而是把任务目录、内容模板、规则引擎三层边界先划清。

## 建模原则

- 题型是内容实例，不是页面类型
- 目录信息、可序列化内容、规则逻辑必须分层
- 后端保存规则真值，前端消费运行时描述
- DSL 只描述语义，不描述 DOM 和样式实现
- runtime-first types 是主模型

## 三层边界

| 层 | 作用 | 允许包含 | 不允许包含 |
| --- | --- | --- | --- |
| `TaskDefinition` | 任务目录与入口 | 标题、摘要、难度、样题、`engineKind`、`contentId` | 判题逻辑、step 推进、运行时状态 |
| `ContentDefinition` | 可序列化内容模板 | prompt、scene、flow、guide、feedback、初始变量 | 函数、规则判断、组件实现细节 |
| `EnginePlugin` | 代码形式规则引擎 | 实例生成、动作处理、状态推进、运行时组装 | shared wire schema、页面实现细节 |

`EnginePlugin` 是领域模型的关键边界，但它只存在于 backend code，不属于 shared contract。

## TaskDefinition

`TaskDefinition` 是任务目录节点。

建议结构：

```ts
type TaskDefinition = {
  id: TaskId
  title: string
  summary: string
  difficulty: "easy" | "medium" | "hard"
  engineKind: ExerciseEngineKind
  contentId: string
  sample: {
    prompt: string
    answerPreview?: string
  }
  steps: string[]
  catalogMeta: {
    gradeId: string
    gradeName: string
    chapterId: string
    chapterName: string
    color?: string
  }
}
```

它用于首页任务树和会话入口，不直接代表 session 中的一题。

## ContentDefinition

`ContentDefinition` 是内容模板。

建议结构：

```ts
type ContentDefinition = {
  id: string
  engineKind: ExerciseEngineKind
  taskId: TaskId
  version: string
  promptTemplate: string
  sceneTemplate: unknown
  flowTemplate: unknown
  guideTemplate: unknown
  feedbackTemplate: unknown
  initialVariables?: Record<string, string>
}
```

当前阶段最重要的约束不是字段长什么样，而是：

- 必须可序列化
- 必须可版本化
- 必须不包含规则代码

## ExerciseInstance

`ExerciseInstance` 是一次具体关卡实例，属于 session 中的一题。

建议结构：

```ts
type ExerciseInstance = {
  instanceId: string
  taskId: string
  engineKind: string
  contentId: string
  prompt: string
  scene: SceneSpec
  flow: FlowSpec
  guide: GuideSpec
  feedback: FeedbackSpec
}
```

它是前端运行时直接消费的内容对象。

## ExerciseRuntimeSpec

`ExerciseRuntimeSpec` 是服务端返回给前端的运行时规格。

建议结构：

```ts
type ExerciseRuntimeSpec = {
  instance: ExerciseInstance
  runtimeState: ServerRuntimeState
}
```

前端本地草稿态不属于服务端返回对象。

如果前端需要表达“当前看到的完整快照”，应使用：

```ts
type ClientRuntimeSnapshot = {
  spec: ExerciseRuntimeSpec
  draft: ClientDraftState
}
```

## SceneSpec

`SceneSpec` 描述左侧工作区有哪些对象，以及这些对象如何被操作。

建议结构：

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

`SceneEntity` 表示工作区对象本体。

建议类型：

```ts
type SceneEntity =
  | TriangleSceneEntity
  | EdgeSceneEntity
  | VertexSceneEntity
  | FormulaSceneEntity
  | TextSceneEntity
```

### InteractionZone

`InteractionZone` 表示命中区，而不是具体 DOM。

建议结构：

```ts
type InteractionZone = {
  id: string
  zoneKind: "edge" | "vertex" | "region" | "slot" | "input"
  targetRef: string
  shape: ZoneShape
  accepts?: RuntimeActionType[]
}
```

### SceneAnchor

`SceneAnchor` 表示输入锚点、标签锚点或公式槽。

建议结构：

```ts
type SceneAnchor = {
  id: string
  anchorKind: "value-input" | "label" | "formula-slot" | "badge"
  entityRef?: string
  x: number
  y: number
}
```

### SceneOverlay

`SceneOverlay` 表示不直接参与输入，但会随状态变化的视觉层。

建议结构：

```ts
type SceneOverlay = {
  id: string
  overlayKind: "highlight" | "mask" | "guide-line" | "badge"
  targetRef?: string
}
```

## FlowSpec

`FlowSpec` 描述关卡如何推进。

建议结构：

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

`meaning` 的先选分子再选分母、`guidedSolve` 的多步骤解锁，都属于这层，而不是页面内分支逻辑。

## ActionSpec

`ActionSpec` 是运行时 DSL 的动作原语。

建议结构：

```ts
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
      type: "clear"
      target?: string
    }
  | {
      type: "submit"
      stepId: string
    }
```

动作原语表达语义，不表达前端实现细节。

## GuideSpec

`GuideSpec` 描述右侧引导区的内容。

建议结构：

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

右侧引导区必须是只读层，不承载主输入控件。

## FeedbackSpec

`FeedbackSpec` 描述动作结果会触发什么语义反馈。

建议结构：

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

后端只返回语义 cue，前端负责映射到音效、动画和高亮。

## ServerRuntimeState

`ServerRuntimeState` 是服务端权威运行时状态。

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

## ClientDraftState

`ClientDraftState` 是前端本地草稿态。

建议结构：

```ts
type ClientDraftState = {
  selections: Record<string, string[]>
  inputs: Record<string, string>
  focusTarget?: string
  transientFeedback?: string[]
}
```

它只表达当前输入，不表达规则真值。

## PracticeSessionSnapshot

`PracticeSessionSnapshot` 是练习页消费的 session 级快照。

建议结构：

```ts
type PracticeSessionSnapshot = {
  sessionId: string
  taskId: string
  studentName: string
  currentIndex: number
  instanceCount: number
  elapsedMs: number
  phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished"
  runtime?: ExerciseRuntimeSpec
}
```

当前页面真正依赖的是当前活动实例的 runtime。

## ResultSnapshot

`ResultSnapshot` 是完成后结果页消费的数据。

它属于持久化结果层，不参与运行时判题。

## 当前 3 个任务如何落入通用模型

### meaning

- `TaskDefinition`
  首页任务入口
- `ContentDefinition`
  选择两条边、按顺序组成分子/分母
- `EnginePlugin`
  根据参考角判断选边顺序是否正确

### ratioToSide

- `TaskDefinition`
  首页任务入口
- `ContentDefinition`
  三边输入锚点、整题提交
- `EnginePlugin`
  校验三边长度并推进状态

### guidedSolve

- `TaskDefinition`
  首页任务入口
- `ContentDefinition`
  多步骤 flow、逐步解锁、最终公式槽
- `EnginePlugin`
  维护步骤状态并推进到完成

这说明当前 3 个任务不是 3 套架构，只是同一 runtime model 的 3 个内容实例。

## 非目标

本模型当前不覆盖：

- 像素级布局策略
- 组件样式实现
- 动画参数
- 前端框架细节
- 教研后台编辑器

## 当前默认决策

- 先冻结本文件中的 runtime-first model
- 再让 `shared/contracts.ts` 对齐本文件
- 再让 backend / frontend 主路径切到该模型
- legacy problem types 已从当前主代码路径中移除
