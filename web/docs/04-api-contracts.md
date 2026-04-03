# API Contracts

## 摘要

API 的目标不是“给页面喂题目字段”，而是“给教学运行时提供实例、动作入口和状态推进”。

因此，接口主模型应围绕下面 3 类对象展开：

- `TaskDefinition` / `TaskTreeResponse`
- `PracticeSessionSnapshot` / `ExerciseRuntimeSpec`
- `RuntimeActionEvent` / `RuntimeActionResponse`

当前项目仍处在兼容阶段，所以本文件同时定义：

- 目标 runtime-first 契约
- 当前保留的 legacy 契约
- 迁移与兼容规则

## 契约原则

- 服务端是规则权威源
- 前端上传动作或当前步骤输入，不上传标准答案
- shared contract 只暴露语义字段，不暴露 DOM / CSS 细节
- `EnginePlugin` 是后端内部实现边界，不进入 shared wire schema
- legacy contract 允许短期保留，但不是新的主路径

## 资源模型

系统主要暴露 4 类资源：

- `task`
  首页任务树和任务摘要
- `session`
  一次练习会话
- `exercise-runtime`
  当前活动关卡实例及其状态
- `result`
  完成后的结果快照

## 目标运行时契约

### 1. 获取任务树

`GET /api/task-tree`

作用：

- 获取首页任务树
- 返回由 `TaskDefinition` 投影出来的任务摘要

响应：

```ts
interface TaskTreeResponse {
  grades: GradeNode[]
}
```

说明：

- `TaskTreeResponse` 是目录投影，不是 authored source
- authored source 应是 `TaskDefinition`

### 2. 创建练习 session

`POST /api/practice/start`

作用：

- 创建新的练习会话
- 生成首题 runtime

请求：

```ts
interface StartPracticeRequest {
  taskId: TaskId
  studentName: string
}
```

目标响应：

```ts
interface StartPracticeResponse {
  sessionId: string
  taskId: TaskId
  studentName: string
  currentIndex: number
  instanceCount: number
  elapsedMs: number
  phase: SessionPhase
  runtime?: ExerciseRuntimeSpec
}
```

### 3. 恢复 session

`GET /api/practice/session/:sessionId`

作用：

- 刷新或重进时恢复当前 session

目标响应：

```ts
interface RestorePracticeResponse {
  sessionId: string
  taskId: TaskId
  studentName: string
  currentIndex: number
  instanceCount: number
  elapsedMs: number
  phase: SessionPhase
  runtime?: ExerciseRuntimeSpec
}
```

### 4. Runtime Spec

`ExerciseRuntimeSpec` 是服务端返回给前端运行时的核心对象。

```ts
interface ExerciseRuntimeSpec {
  instance: ExerciseInstance
  runtimeState: ServerRuntimeState
}
```

其中 `instance` 至少包含：

- `scene`
- `flow`
- `guide`
- `feedback`

### 5. Runtime Action

`POST /api/practice/runtime-action`

作用：

- 接收前端标准动作
- 返回新的 runtime state 与反馈

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

### 6. Runtime Action Response

目标响应：

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

约束：

- 默认优先返回完整 `runtime`
- 若未来引入 patch，patch 只能是优化，不是主路径依赖

### 7. 完成练习

`POST /api/practice/finish`

作用：

- 结束 session
- 返回结果快照

### 8. 查询结果

`GET /api/practice/result/:sessionId`

作用：

- 获取完成后的结果页数据

## 反馈契约

反馈必须保持语义化。

```ts
interface RuntimeFeedbackPacket {
  global: FeedbackCue[]
  workspace: FeedbackCue[]
  guide: FeedbackCue[]
}
```

后端可以返回：

- 正确提示
- 错误提示
- 完成提示
- 局部高亮目标

后端不应返回：

- CSS class
- 动画时长
- DOM selector

## 错误语义

统一错误响应：

```ts
interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
```

运行时主路径必须预留这些错误语义：

- `ACTION_NOT_ALLOWED`
- `INSTANCE_NOT_ACTIVE`
- `RUNTIME_CONTRACT_INVALID`
- `LEGACY_SESSION_EXPIRED`

其中 `LEGACY_SESSION_EXPIRED` 用于旧 session 在迁移后不再可恢复的情况。

## Legacy 兼容契约

当前保留的 legacy contract 包括：

- `Problem`
- `AnswerPayload`
- `AnswerRequest`
- `AnswerResponse`
- `ProblemRenderSchema`
- `POST /api/practice/answer`

### Legacy 接口定位

`POST /api/practice/answer` 在迁移期内可以保留，但角色固定为：

- 接收旧 payload
- 适配为 runtime action
- 复用同一条 runtime-first backend pipeline

它不再应该承载独立判题逻辑。

### Legacy session 恢复策略

- 旧结果快照保留
- 旧进行中 session 可失效
- 若恢复失败，应返回显式错误，而不是静默产出半兼容 runtime

## 迁移顺序

迁移顺序固定如下：

1. 先冻结 docs
2. 再冻结 shared contracts
3. 再让 backend start / restore / runtime-action 切到 runtime-first
4. 最后让 frontend 主路径切到 runtime-first

兼容原则：

- 一次只替换一层
- legacy contract 可以暂留，但不得继续扩展
- 若 `03-domain-model.md` 与接口定义冲突，以领域模型为准先修正，再同步接口文档

## 当前默认决策

- `ExerciseRuntimeSpec + RuntimeActionEvent` 是目标主契约
- `Problem + AnswerPayload` 是兼容契约
- `ProblemRenderSchema` 是过渡结构，不是最终 DSL
- `StartPracticeResponse` / `RestorePracticeResponse` 应收敛到 `PracticeSessionSnapshot`
- 新增任务不得绕开 runtime-first contract 直接加专属接口字段
