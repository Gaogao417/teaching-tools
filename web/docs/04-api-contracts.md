# API Contracts

## 摘要

API 不应只被理解为“给页面喂数据”，而应被理解为“给教学运行时提供关卡实例与状态推进”。

因此，接口契约的核心不是某个页面要几个字段，而是：

- 后端如何下发一个可执行的教学关卡实例
- 前端如何上报标准化动作
- 后端如何返回新的运行时状态

当前项目处于过渡阶段：

- 现网契约仍以 `Problem + AnswerPayload` 为主
- 新架构目标是演进到 `ExerciseRuntimeSpec + RuntimeActionEvent`

本文件同时定义：

- 当前兼容契约
- 目标运行时契约
- 迁移约束

术语约束：

- `ExerciseRuntimeSpec` 专指服务端返回给前端的运行时规格
- 前端本地草稿态不属于 API 返回对象
- 客户端若需要组合本地快照，应在前端自行用 `ExerciseRuntimeSpec + ClientDraftState` 组合

## 契约原则

- 服务端是规则权威源
- 前端不上传标准答案，只上传动作或当前步骤的输入
- 所有字段使用语义命名，不暴露 DOM 或组件实现细节
- 允许兼容期内同时保留旧题型 payload 和新 runtime payload
- `shared/contracts.ts` 是最终类型真相源

## 资源模型

当前系统主要有 4 类 API 资源：

- `task`
  教学任务入口与任务树
- `session`
  一次练习会话
- `exercise-instance`
  session 中的单题实例
- `result`
  练习完成后的结果快照

## 当前兼容接口

### 1. 获取任务树

`GET /api/task-tree`

作用：

- 获取首页任务树与任务摘要

当前响应：

```ts
interface TaskTreeResponse {
  grades: GradeNode[]
}
```

### 2. 获取任务历史

`GET /api/task-history/:taskId?studentName=...`

作用：

- 获取学生在某任务下的历史记录

当前响应：

```ts
interface TaskHistoryResponse {
  taskId: string
  studentName: string
  items: TaskHistoryItem[]
}
```

### 3. 创建练习 session

`POST /api/practice/start`

作用：

- 创建新的练习会话
- 返回 session 与题目实例列表

当前请求：

```ts
interface StartPracticeRequest {
  taskId: string
  studentName: string
}
```

当前响应：

```ts
interface StartPracticeResponse {
  sessionId: string
  taskId: string
  studentName: string
  problems: Problem[]
  startedAt: string
}
```

### 4. 提交答案

`POST /api/practice/answer`

作用：

- 提交当前题或当前步骤的作答
- 返回后端判定结果与新的题目状态

当前请求：

```ts
interface AnswerRequest {
  sessionId: string
  problemId: string
  payload: AnswerPayload
}
```

当前响应：

```ts
interface AnswerResponse {
  correct: boolean
  allSolved: boolean
  hint?: string
  problemState: Problem
  nextIndex: number
  phase: SessionPhase
}
```

### 5. 恢复 session

`GET /api/practice/session/:sessionId`

作用：

- 刷新或重进页面时恢复当前 session

当前响应：

```ts
interface RestorePracticeResponse {
  sessionId: string
  taskId: string
  studentName: string
  currentIndex: number
  problems: Problem[]
  elapsedMs: number
  phase: SessionPhase
}
```

### 6. 完成练习

`POST /api/practice/finish`

作用：

- 结束 session
- 返回结果快照

### 7. 查询结果

`GET /api/practice/result/:sessionId`

作用：

- 获取已持久化的结果页数据

## 目标运行时契约

目标架构下，练习页应消费“运行时关卡实例”，而不是只消费题型分支数据。

### 1. Runtime Spec

后端应能返回：

```ts
interface ExerciseRuntimeSpec {
  instance: ExerciseInstance
  runtimeState: ServerRuntimeState
}
```

其中 `instance` 包含：

- `scene`
- `flow`
- `guide`
- `feedback`

这意味着前端不需要再自己从题型字段推导：

- 当前有哪些可点击区域
- 当前步骤允许哪些动作
- 右侧应该展示哪些步骤和提示

### 2. Runtime Action

前端应向后端上报标准动作，而不是让组件层直接知道题型特有 payload。

建议请求结构：

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

### 3. Runtime Patch

后端响应不应只回答“对/错”，还应返回新的运行时可见状态。

建议响应结构：

```ts
interface RuntimeActionResponse {
  accepted: boolean
  evaluation: "correct" | "wrong" | "progress"
  runtimeState: ServerRuntimeState
  instancePatch?: Partial<ExerciseInstance>
  feedback?: RuntimeFeedbackPacket
  nextIndex: number
  phase: SessionPhase
}
```

其中：

- `accepted`
  动作是否合法
- `evaluation`
  本次动作是推进、答对还是答错
- `instancePatch`
  如步骤摘要、引导文案、局部 scene 状态发生变化，可增量返回
- `feedback`
  返回语义级反馈 cue，而不是前端样式类名

## 当前到目标的迁移策略

### 阶段 1: 兼容增强

保留现有：

- `Problem`
- `AnswerPayload`
- `AnswerResponse`

同时新增但不强制启用：

- `ExerciseRuntimeSpec`
- `RuntimeActionEvent`
- `RuntimeFeedbackPacket`

允许旧页面继续工作，新页面开始按 runtime model 实现。

### 阶段 2: 双轨接口

在现有 `submitAnswer` 保持不变的情况下，新增 runtime 风格接口，例如：

- `POST /api/practice/runtime-action`

或在原接口中新增：

- `mode: "legacy" | "runtime"`

### 阶段 3: Runtime First

当 `PracticePage` 已重构为 `ExerciseRuntimeHost` 后：

- 页面内部不再基于 `problem.type` 写大分支
- 组件层只上报标准动作
- 后端以 runtime state 驱动页面更新

届时旧题型 payload 可以退化为兼容层，而不是主契约。

## 反馈契约

反馈契约必须保持语义化。

后端可以返回：

```ts
interface RuntimeFeedbackPacket {
  global: FeedbackCue[]
  workspace: FeedbackCue[]
  guide: FeedbackCue[]
}
```

后端不应返回：

- CSS class 名
- 动画时长实现细节
- DOM 选择器

前端运行时负责把 feedback cue 映射成实际：

- 音效
- 页面动效
- 边高亮
- 步骤状态闪动

## 错误语义

统一错误响应保持：

```ts
interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
```

运行时契约下，建议新增这些错误语义：

- `ACTION_NOT_ALLOWED`
  当前步骤不允许该动作
- `INSTANCE_NOT_ACTIVE`
  当前题不是激活题
- `RUNTIME_CONTRACT_INVALID`
  服务端生成的 runtime spec 非法

这些错误不一定要立刻实现，但应预留。

## 版本与兼容规则

- 新字段优先以可选字段方式加入，避免一次性打断现有实现
- 一次迁移只替换一层：
  - 先加 runtime types
  - 再加 runtime endpoint
  - 再改前端 runtime host
- 若 `docs/03-domain-model.md` 与接口设计冲突，以领域模型先修正，再更新契约

## 当前默认决策

- 当前主接口保持兼容
- 新架构按 runtime-first 设计类型
- `ProblemRenderSchema` 视为过渡结构，不是最终通用 DSL
- `RuntimeActionEvent` 是后续组件库与后端协作的标准动作模型
