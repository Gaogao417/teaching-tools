# API Contracts

## Summary

本文件只定义学生在线做题时使用的 Web API。

它不定义：

- Python 出题接口
- Wolfram 校验接口
- 内部离线 authoring 管理接口

在线 API 的目标是：为 frontend 提供任务目录、session、mode-safe plan、训练记录同步、Assessment 提交与
结果查询。

## Contract Principles

- backend 是 approved content、session、Assessment 真值和持久进度的权威来源
- Learn/Practice plan 可下发 reviewed local truth；Assessment plan 永不下发答案
- Practice 上传 versioned training event/summary，不逐 Action 请求数学判题
- Assessment 上传 evidence，由 backend private evaluator 权威判定
- runtime-first contract 是在线主契约
- 离线 authoring pipeline 不直接暴露给 frontend

## Resources

在线链路主要暴露以下资源：

- `task`
- `learning-projection`
- `session`
- `exercise-plan`
- `training-record`
- `assessment-submission`
- `result`

## Task Tree

`GET /api/task-tree`

作用：

- 获取任务树
- 返回由 `TaskDefinition` 投影出的任务摘要

## Learning Projection

`GET /api/learn/:taskId`

作用：

- 由对应 engine 生成确定性的只读示范实例
- 返回 `LearningProjectionSpec`，其中 `sampleRuntime` 继续使用共享 `ExerciseRuntimeSpec`
- 返回当前教学步骤的叙述、聚焦目标与下一动作，不在 frontend 重新实现题型场景

## Learn Runtime Action

`POST /api/learn/runtime-action` 是 pinned legacy Learn 的 compatibility endpoint，对当前步骤做 backend 判定。请求只包含
`taskId`、`stepId` 和学生提交值，响应只返回 `correct` / `wrong`；answer key 不进入
`LearningProjectionSpec`。该接口不创建 Practice session，也不持久化练习结果。

## Start Session

`POST /api/practice/start`

作用：

- 创建新的做题 session
- 由 backend 在内部选择一个 approved scenario
- 返回该 scenario 投影出的首题 runtime

请求：

```ts
interface StartPracticeRequest {
  taskId: TaskId
  studentName: string
}
```

响应：

```ts
interface StartPracticeResponse extends PracticeSessionSnapshot {}
```

说明：

- frontend 不知道被选中的 scenario id
- 是否使用内置样例、数据库 scenario、或其他来源，属于 backend 内部实现
- backend selector 只允许选择 `approved` 且 task/content/engine 匹配的 scenario
- session 在 backend 固定 scenario id/version；restore 不重新选题
- start response 不直接序列化完整 `ScenarioRecord`、validation report 或 authoring run metadata；后续
  mode-safe plan endpoint 为 Practice 下发 reviewed local truth，为 Assessment 省略全部 local truth

## Restore Session

`GET /api/practice/session/:sessionId`

作用：

- 恢复当前 session
- 返回最新 `PracticeSessionSnapshot`

## Exercise Plan

`GET /api/practice/action-plan/:sessionId`

目标作用：

- 为当前 exercise 返回完整、versioned `ExercisePlan`
- Practice plan 包含每个 Action 的 reviewed `LocalActionTruth`，题内 Action 切换不重新请求 plan
- Assessment plan 只包含 public input/shape，所有 local truth 与等价可推导字段都省略
- restore 只返回与 pinned session mode/plan revision 兼容的 plan/checkpoint

## Training Checkpoint and Result

`POST /api/practice/training-checkpoint`

`POST /api/practice/training-result`

目标作用：

- 接收 Practice 的 versioned attempt、Action summary、evidence 和本地 completion；
- 校验 session/exercise/Action membership、schema/version、非负计数、sequence、idempotency 和 revision；
- 保存跨设备 checkpoint、训练历史和 mastery 输入；
- 返回 `Stored | Duplicate | IncompatibleRevision | InvalidEnvelope` receipt；
- 不调用 private evaluator 重新判定数学正确性，也不阻塞前端当前 Action。

## Assessment Submission

`POST /api/practice/action-evaluation`（迁移后只服务 Assessment/Challenge 与 pinned legacy session）

作用：

- 接收 structurally ready 的 typed evidence；
- 使用 backend private answer 权威返回 accepted/rejected/conflict；
- accepted 后提交 world/revision/result；
- response diagnosis 不泄漏未授权正确答案。

## Legacy Runtime Action

`POST /api/practice/runtime-action`

仅用于 pinned legacy session：

- 接收学生动作，在 backend 判题并推进 legacy runtime
- 将动作与 backend evaluation 一并保存，供完成后的 Review 使用

请求：

```ts
interface RuntimeActionRequest {
  sessionId: string
  instanceId: string
  action: RuntimeActionEvent
}
```

其中：

```ts
interface RuntimeActionEvent {
  type: "select" | "input" | "assign" | "compose" | "clear" | "submit"
  targetId?: string
  sourceId?: string
  value?: string
  stepId?: string
}
```

`allowedActions` 可携带可选 `presentation` 元数据，为共享 `RuntimeActionDock` 提供标签与槽位名称。frontend 不根据 action target 或 engine kind 猜测“分子 / 分母”等语义。

新 `LocalTraining` session 不得调用此 endpoint；删除条件和回滚策略见 migration plan。

响应：

```ts
interface RuntimeActionResponse {
  accepted: boolean
  evaluation: "correct" | "wrong" | "progress"
  runtimeState: ServerRuntimeState
  runtime?: ExerciseRuntimeSpec
  feedback?: RuntimeFeedbackPacket
  nextIndex: number
  phase: SessionPhase
}
```

## Finish Session

`POST /api/practice/finish`

作用：

- 结束 session
- 返回 `ResultSnapshot`

## Query Result

`GET /api/practice/result/:sessionId`

作用：

- 获取完成后的结果页快照
- Training 返回 Action duration、semantic hit accuracy、Action first-try accuracy、assistance 和错误分布
- Assessment 返回权威 `problemReviews`、diagnosis、结构化实际/期望答案与 accepted/rejected log
- frontend 只呈现复盘投影，不从原始提交日志推断错误类型

## Task History

`GET /api/task-history/:taskId`

每条历史记录包含 `sessionId`。Review 使用它切换已完成快照；切换历史记录不会创建或恢复 Practice session。

## Error Semantics

统一错误响应：

```ts
interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
```

在线主路径必须覆盖：

- `ACTION_NOT_ALLOWED`
- `INSTANCE_NOT_ACTIVE`
- `RUNTIME_CONTRACT_INVALID`
- `TRAINING_RECORD_INVALID`
- `TRAINING_REVISION_INCOMPATIBLE`
- `ASSESSMENT_TRUTH_LEAK_BLOCKED`
- `LEGACY_SESSION_EXPIRED`
- `NO_APPROVED_SCENARIO`

## Explicit Non-API Scope

以下内容不属于当前在线 API：

- “生成候选题”
- “调用 Wolfram 校验”
- “查看 authoring run”
- “审核 scenario 是否 approved”

这些都是离线生产系统的职责。

新 Training API 的精确事件与 receipt contract 见
[ADR-006](./adr/ADR-006-local-practice-training-runtime.md)。当前 endpoint 命名可在 Phase 1 contract freeze
时调整，但 Practice/Assessment 的判定边界不能重新合并。
