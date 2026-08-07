# Domain Model

## Summary

这个项目的领域模型要同时描述：

- 任务目录与题型模板
- 题库中的已批准 scenario
- 学生做题时的 runtime

因此不能把 `ContentDefinition` 和“题库里的单道题”混为一谈。

## Modeling Principles

- 任务目录、题型模板、题库记录、运行时实例必须分层
- backend 保存真值与状态推进
- frontend 只消费 runtime projection
- 离线 authoring 结果不是页面类型

## Core Objects

- `TaskDefinition`
- `ContentDefinition`
- `ScenarioRecord`
- `ScenarioValidationReport`
- `AuthoringRun`
- `ExerciseInstance`
- `ExerciseRuntimeSpec`
- `ServerRuntimeState`
- `ClientDraftState`
- `PracticeSessionSnapshot`
- `ResultSnapshot`

## TaskDefinition

`TaskDefinition` 是目录节点。

职责：

- 任务入口
- 标题、摘要、难度
- `engineKind`
- `contentId`
- 首页样题摘要

它不代表 session 中的某一道题。

## ContentDefinition

`ContentDefinition` 是题型级模板。

职责：

- prompt 模板
- scene 模板
- flow 模板
- guide 模板
- feedback 模板

它表达“这一类题怎样投影成 runtime”，而不是“这道题具体是什么”。

## ScenarioRecord

`ScenarioRecord` 是题库中的单道已批准题目。

建议字段：

```ts
type ScenarioRecord = {
  id: string
  version: string
  taskId: TaskId
  engineKind: ExerciseEngineKind
  contentId: string
  status: "draft" | "validated" | "approved" | "rejected"
  promptData: Record<string, unknown>
  answerKey: Record<string, unknown>
  metadata: {
    source: "manual" | "python-generator" | "ai-assisted"
    assignments: string[]
    authoringRunId: string
    difficulty?: string
    tags?: string[]
  }
  createdAt: string
  approvedAt?: string
}
```

职责：

- 保存单题变量
- 保存中间步骤答案键与最终答案键
- 保存来源与审核状态

`promptData` 是 authoring 侧的题面、场景和动作描述，`answerKey` 是 backend-only 的答案键、判定规则和诊断真值。`promptData` 也不自动等于 frontend DTO；engine 必须用 allowlist 投影公开字段，不能把完整 `ScenarioRecord` 序列化给 frontend。

approved record 是不可变版本。内容变化必须创建新 version；已有 session 继续引用原 `id + version`。

## ScenarioValidationReport

`ScenarioValidationReport` 记录离线校验结果。

建议字段：

```ts
type ScenarioValidationReport = {
  scenarioId: string
  scenarioVersion: string
  authoringRunId: string
  passed: boolean
  checks: Array<{
    name: string
    kind: "schema" | "domain" | "asset" | "mathematical"
    passed: boolean
    message?: string
    evidence?: Record<string, unknown>
  }>
  wolframSummary?: string
  createdAt: string
}
```

职责：

- 记录 schema 校验
- 记录规则过滤结果
- 记录 Wolfram 数学校验结果

## AuthoringRun

`AuthoringRun` 表示一次离线批处理。

建议字段：

```ts
type AuthoringRun = {
  id: string
  status: "running" | "completed" | "failed"
  taskIds: TaskId[]
  startedAt: string
  finishedAt?: string
  toolchainVersion: string
  inputSpecVersion: string
  counts: {
    candidate: number
    validated: number
    approved: number
    rejected: number
  }
  errorSummary?: string
}
```

职责：

- 追踪一批题从生成到入库的过程
- 让题库内容可回溯

## ExerciseInstance

`ExerciseInstance` 是 session 中当前活动题目的 runtime 投影。

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

它来自：

- `TaskDefinition`
- `ContentDefinition`
- `ScenarioRecord`
- 当前 engine state

`ExerciseInstance` 不包含 scenario id/version、answer key、accepted answers 或 validation metadata。scenario reference 保存在 backend session/engine state 中。

## ExerciseRuntimeSpec

```ts
type ExerciseRuntimeSpec = {
  instance: ExerciseInstance
  runtimeState: ServerRuntimeState
}
```

这是 frontend 真正消费的服务端对象。

## ServerRuntimeState

服务端权威状态，至少包含：

- 当前 phase
- 当前 step
- 已完成步骤
- problem status
- attempts

## ClientDraftState

前端本地草稿状态，至少包含：

- selections
- inputs
- focus target
- transient feedback

它不表达真值。

## PracticeSessionSnapshot

session 级快照，面向练习页与恢复接口。

## ResultSnapshot

Review 模式使用的不可变完成后快照。除用时、首次正确率与历史趋势外，还包含：

- `problemReviews`: 每道题的 prompt、尝试次数和首次正确状态
- `attemptLog`: 运行时已经判定过的提交动作、步骤标题、提交值和 evaluation

动作复盘来自 backend 持久化的 runtime action event。frontend 只负责展示，不重新判题，也不从汇总指标猜测过程。

## Current Reality

当前代码已经完整实现：

- `TaskDefinition`
- `ContentDefinition`
- `ExerciseRuntimeSpec`
- `PracticeSessionSnapshot`
- `ResultSnapshot`

当前代码尚未完整落地但文档已预留：

- `ScenarioRecord`
- `ScenarioValidationReport`
- `AuthoringRun`

这三者用于承接后续 Python / Wolfram authoring pipeline。

现有 `TopicScenarioRecord` 是迁移输入，不是新架构的跨层领域模型；六个 topic 需要迁移到上述统一 schema。
