# Web Backend Design Report

## 1. Scope

本报告定义网页版教学应用后端的职责、接口契约、数据模型和部署边界。

它是首页、练习页、结果页三份页面文档的共享真相来源，重点解决这些问题：

- 哪些数据必须由服务端掌控
- 题目、session、结果的统一结构是什么
- API 如何在前后端分离部署下协作
- 后端在 Lighthouse 上如何落地

## 2. Deployment Role

后端是独立 API 服务，不负责 SSR，也不负责静态资源托管。

默认部署方式：

- 运行环境：腾讯云 Lighthouse
- 运行时：`Node.js + Express`
- 对外入口：`https://api.example.com`
- 前端来源：CloudBase 静态网站托管

后端必须满足：

- 全部接口走 HTTPS
- 只向前端域名开放 CORS
- 无状态接入层 + 有状态数据层
- 支持后续接数据库、用户体系、错题本

## 3. Backend Responsibilities

后端承担这些核心职责：

- 提供任务树与任务历史接口
- 创建练习 session
- 生成题组并保存题目真值
- 接收答案并完成判题
- 持久化进度、耗时和结果
- 返回结果快照与历史趋势

后端不承担这些职责：

- 渲染 HTML 页面
- 维护前端展示状态细节
- 依赖浏览器上报作为唯一结果真值

## 4. Service Modules

推荐模块划分：

```text
backend/
  routes/
  controllers/
  services/
    tasks/
    practice/
    results/
  repositories/
  db/
  middleware/
```

职责建议：

- `tasks`：课程树与任务元数据
- `practice`：session 创建、题目生成、判题、恢复
- `results`：结果快照、历史聚合、统计计算
- `repositories`：数据库读写
- `middleware`：CORS、请求日志、错误处理

## 5. API Principles

所有接口遵循这些约束：

- 仅使用 JSON
- 所有时间字段使用 ISO 8601 字符串
- 不使用 cookie 维持会话
- `sessionId` 通过路径参数或请求体传递
- 练习结果以后端持久化数据为准

错误响应统一为：

```ts
interface ApiErrorResponse {
  error: {
    code:
      | 'BAD_REQUEST'
      | 'INVALID_STUDENT_NAME'
      | 'TASK_NOT_FOUND'
      | 'SESSION_NOT_FOUND'
      | 'SESSION_FINISHED'
      | 'PROBLEM_NOT_FOUND'
      | 'ANSWER_INVALID'
      | 'INTERNAL_ERROR'
    message: string
  }
}
```

HTTP 语义：

- `400`：请求参数不合法
- `404`：任务、session 或题目不存在
- `409`：session 已完成但仍继续提交
- `500`：服务端内部错误

## 6. Shared Types

### 6.1 Task And Session

```ts
type TaskId = 'meaning' | 'ratioToSide' | 'guidedSolve'

type SessionPhase =
  | 'answering'
  | 'correct_pause'
  | 'wrong_feedback'
  | 'group_finished'

type ProblemStatus = 'pending' | 'correct' | 'wrong'
```

### 6.2 Problem Shape

服务端返回统一 `Problem` 数组，前端按 `type` 分发渲染：

```ts
type Problem = MeaningProblem | RatioToSideProblem | GuidedSolveProblem

interface BaseProblem {
  id: string
  taskId: TaskId
  type: TaskId
  index: number
  status: ProblemStatus
  attempts: number
  firstTryCorrect: boolean | null
}

interface MeaningProblem extends BaseProblem {
  type: 'meaning'
  prompt: string
  target: 'sin' | 'cos' | 'tan' | 'cot'
  referenceAngle: 'A'
  ui: {
    numeratorLabel: string
    denominatorLabel: string
    selectableRoles: Array<'opposite' | 'adjacent' | 'hypotenuse'>
  }
}

interface RatioToSideProblem extends BaseProblem {
  type: 'ratioToSide'
  prompt: string
  target: 'sin' | 'cos' | 'tan' | 'cot'
  referenceAngle: 'A'
  ratio: {
    numerator: string
    denominator: string
  }
  ui: {
    edges: Array<'AB' | 'BC' | 'AC'>
    draggableValues: string[]
  }
}

interface GuidedSolveProblem extends BaseProblem {
  type: 'guidedSolve'
  prompt: string
  target: 'sin' | 'cos' | 'tan' | 'cot'
  referenceAngle: 'A'
  given: Array<{
    edge: 'AB' | 'BC' | 'AC'
    value: string
  }>
  stepKeys: Array<'mark' | 'ratio' | 'third' | 'final'>
}
```

注意：

- `Problem` 中不返回用于判题的标准答案
- 前端只拿到渲染所需字段和题目状态
- 判题所需真值只保存在服务端

### 6.3 Answer Payloads

`POST /api/practice/answer` 的 `payload` 按题型区分：

```ts
type AnswerPayload =
  | MeaningAnswerPayload
  | RatioToSideAnswerPayload
  | GuidedSolveAnswerPayload

interface MeaningAnswerPayload {
  type: 'meaning'
  numeratorRole: 'opposite' | 'adjacent' | 'hypotenuse'
  denominatorRole: 'opposite' | 'adjacent' | 'hypotenuse'
}

interface RatioToSideAnswerPayload {
  type: 'ratioToSide'
  placements: Partial<Record<'AB' | 'BC' | 'AC', string>>
}

interface GuidedSolveAnswerPayload {
  type: 'guidedSolve'
  stepKey: 'mark' | 'ratio' | 'third' | 'final'
  value: Record<string, string>
}
```

## 7. Session Lifecycle

### 7.1 Start

- 前端传入 `taskId + studentName`
- 后端校验任务是否存在、姓名是否非空
- 后端创建新 `sessionId`
- 后端生成固定数量题目并保存答案真值
- 返回不含答案的 `problems`

### 7.2 Answer

- 前端提交 `sessionId + problemId + payload`
- 后端读取当前 session 和题目真值
- 后端判题并更新：
  - `attempts`
  - `firstTryCorrect`
  - `status`
  - `currentIndex`
  - `phase`
- 若本题全部完成且还有下一题，返回下一个索引
- 若最后一题完成，返回 `phase = 'group_finished'`

### 7.3 Restore

- 页面刷新后通过 `sessionId` 拉取当前状态
- 恢复接口返回当前题目列表、当前索引、耗时和 phase
- 如果 session 已完成，前端可直接跳结果页或继续展示完成态

### 7.4 Finish

- 练习页完成后调用 `POST /api/practice/finish`
- 后端按 session 生成结果快照并持久化
- `finish` 必须幂等
- 如果同一 `sessionId` 重复调用，返回同一份结果快照，并带 `alreadyFinished: true`

## 8. Public APIs

### 8.1 Task Tree

`GET /api/task-tree`

返回课程树与任务元数据。

### 8.2 Task History

`GET /api/task-history/:taskId?studentName=...&limit=5`

规则：

- 当前版本 `studentName` 必填
- 默认 `limit = 5`
- 仅返回该学生在该任务下的最近记录

### 8.3 Start Practice

`POST /api/practice/start`

```ts
interface StartPracticeRequest {
  taskId: TaskId
  studentName: string
}

interface StartPracticeResponse {
  sessionId: string
  taskId: TaskId
  studentName: string
  problems: Problem[]
  startedAt: string
}
```

### 8.4 Submit Answer

`POST /api/practice/answer`

```ts
interface AnswerRequest {
  sessionId: string
  problemId: string
  payload: AnswerPayload
}

interface AnswerResponse {
  correct: boolean
  allSolved: boolean
  hint?: string
  problemState: Problem
  nextIndex: number
  phase: SessionPhase
}
```

### 8.5 Restore Session

`GET /api/practice/session/:sessionId`

```ts
interface RestorePracticeResponse {
  sessionId: string
  taskId: TaskId
  studentName: string
  currentIndex: number
  problems: Problem[]
  elapsedMs: number
  phase: SessionPhase
}
```

### 8.6 Finish Practice

`POST /api/practice/finish`

```ts
interface FinishPracticeRequest {
  sessionId: string
}

interface FinishPracticeResponse {
  sessionId: string
  resultSnapshot: ResultSnapshot
  alreadyFinished?: boolean
}
```

### 8.7 Result

`GET /api/practice/result/:sessionId`

```ts
interface ResultSnapshot {
  sessionId: string
  taskId: TaskId
  studentName: string
  startedAt: string
  clearedAt: string
  title: string
  groupLabel: string
  elapsedMs: number
  bestMs: number | null
  avgMs: number | null
  copy: string
  problemCount: number
  firstTryAccuracy: number
  firstTryCorrectCount: number
  color: string
  deltaVsPreviousMs: number | null
  history: Array<{
    elapsedMs: number
    clearedAt: string
  }>
}
```

## 9. Persistence Model

最小数据表建议：

```text
tasks
practice_sessions
practice_problems
practice_results
```

建议字段：

### 9.1 `practice_sessions`

- `id`
- `task_id`
- `student_name`
- `phase`
- `current_index`
- `started_at`
- `finished_at`
- `elapsed_ms`

### 9.2 `practice_problems`

- `id`
- `session_id`
- `task_id`
- `type`
- `problem_index`
- `prompt_json`
- `answer_key_json`
- `status`
- `attempts`
- `first_try_correct`

### 9.3 `practice_results`

- `session_id`
- `task_id`
- `student_name`
- `elapsed_ms`
- `problem_count`
- `first_try_accuracy`
- `first_try_correct_count`
- `started_at`
- `cleared_at`
- `snapshot_json`

说明：

- `answer_key_json` 只存在服务端数据库，不返回前端
- `snapshot_json` 用于结果页快速读取与幂等返回
- 如果生产环境切 MySQL，表结构保持同名即可

## 10. Security And Validation

当前版本不做登录，但后端仍需具备最小保护：

- `studentName` 去首尾空格并限制长度
- 所有输入做 JSON schema 或等价校验
- CORS 只允许前端正式域名
- 禁止前端直接决定 `elapsedMs`、`accuracy` 等结果真值

首版不要求：

- 用户登录
- RBAC
- 多租户隔离

## 11. Operational Requirements

Lighthouse 上至少需要：

- 进程守护，例如 `pm2` 或 systemd
- Nginx 反向代理到 Node 服务
- HTTPS 证书
- 应用日志与错误日志

推荐环境变量：

```text
PORT=
NODE_ENV=
API_BASE_URL=
FRONTEND_ORIGIN=
DATABASE_URL=
SQLITE_PATH=
```

如果使用 CloudBase 静态托管前端，还需要前端配置 SPA 路由回退，保证 `/tasks`、`/practice/:taskId`、`/result/:sessionId` 都能回到静态入口文件。

## 12. Resolved Decisions

- 后端默认实现为 `Node.js + Express`
- 后端只提供 API，不承担 SSR
- 题目真值、判题逻辑和结果快照以后端为准
- `finishPractice` 必须幂等
- 当前版本按 `studentName + taskId` 聚合历史
- 开发可用 SQLite，生产建议 MySQL
