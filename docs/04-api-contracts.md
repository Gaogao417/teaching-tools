# API Contracts

## Summary

本文件只定义学生在线做题时使用的 Web API。

它不定义：

- Python 出题接口
- Wolfram 校验接口
- 内部离线 authoring 管理接口

在线 API 的目标是：为 frontend 提供任务目录、session、runtime、动作提交与结果查询。

## Contract Principles

- backend 是规则与状态的权威来源
- frontend 上传动作和当前输入，不上传标准答案
- runtime-first contract 是在线主契约
- 离线 authoring pipeline 不直接暴露给 frontend

## Resources

在线链路主要暴露 4 类资源：

- `task`
- `session`
- `exercise-runtime`
- `result`

## Task Tree

`GET /api/task-tree`

作用：

- 获取任务树
- 返回由 `TaskDefinition` 投影出的任务摘要

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

## Restore Session

`GET /api/practice/session/:sessionId`

作用：

- 恢复当前 session
- 返回最新 `PracticeSessionSnapshot`

## Runtime Action

`POST /api/practice/runtime-action`

作用：

- 接收学生动作
- 判题并推进 runtime

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
- `LEGACY_SESSION_EXPIRED`

## Explicit Non-API Scope

以下内容不属于当前在线 API：

- “生成候选题”
- “调用 Wolfram 校验”
- “查看 authoring run”
- “审核 scenario 是否 approved”

这些都是离线生产系统的职责。
