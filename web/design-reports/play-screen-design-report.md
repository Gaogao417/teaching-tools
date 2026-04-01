# Web Play Screen Design Report

## 1. Scope

本报告描述网页版练习页在“前端静态托管、后端独立 API 服务”场景下的职责和实现约束。

这不是把单文件 HTML 直接搬上浏览器，而是把练习流程落成真实的 Web 路由、会话系统和跨域 API 协作。

## 2. Product Goal

练习页负责承接首页选中的任务，并完成一次完整训练会话。

核心目标：

- 学生进入后可以立即开始作答
- 页面刷新后会话状态仍可恢复
- 多个学生设备同时访问时，不互相污染状态
- 页面视觉和交互节奏继承 `trigonometry-practice.html`

## 3. Route And Session Model

建议路由：

- `/practice/:taskId`：进入指定任务

进入流程：

1. 页面读取 `taskId`
2. 页面从本地缓存读取 `studentName`
3. 调用后端创建 session
4. 后端返回 `sessionId + problems`
5. 前端按当前题渲染

会话模型要求：

- 每次练习生成独立 `sessionId`
- 答题、计时、当前进度与正确率以 session 为单位存储
- 页面刷新后可通过 `sessionId` 恢复当前状态
- 会话与 `studentName` 绑定

## 4. Visual And Interaction Baseline

练习页直接继承 `trigonometry-practice.html` 的核心体验，不退回成普通表单式练习页。

必须保留的基线：

- 温暖纸面背景和教具板式卡片
- 顶部状态栏
- 三角形主舞台
- 强引导型操作面板
- 正误即时反馈
- 答对后自动下一题
- 一组做完先弹成绩 modal，再进入结果页

## 5. Page Layout

### 5.1 Desktop

```text
顶部状态栏
主舞台
  左：三角形图形
  右：当前题交互区
底部反馈区
```

### 5.2 Mobile

手机浏览器使用纵向布局：

- 顶部状态栏
- 图形区
- 答题区
- 反馈区
- 底部主要按钮

不允许出现横向滚动作为主要交互方式。

## 6. Kept Exercise Types

当前保留三类任务：

- `meaning`
- `ratioToSide`
- `guidedSolve`

网页端保持题型语义不变，但题目生成、判题与结果持久化都以后端为准。

## 7. Backend Contract

练习页不采用 SSR。

实现边界固定为：

- 页面骨架由前端静态应用提供
- 题目数据由服务端在会话开始时下发
- 答案必须提交到服务端判定
- session 状态、当前进度和结果统计以服务端为准
- 前端负责渲染、交互反馈和页面流转

这样可以保留 CloudBase 静态托管前端的部署方式，同时保证题目真值、判题逻辑和历史结果不暴露在浏览器端。

共享类型、错误响应、session 生命周期和持久化约束，以 `backend-design-report.md` 为准。

### 7.1 Start Practice

`POST /api/practice/start`

```ts
interface StartPracticeRequest {
  taskId: 'meaning' | 'ratioToSide' | 'guidedSolve'
  studentName: string
}

interface StartPracticeResponse {
  sessionId: string
  taskId: string
  studentName: string
  problems: Problem[]
  startedAt: string
}
```

其中 `Problem` 的统一结构和三种题型的差异字段，由 `backend-design-report.md` 定义。

### 7.2 Submit Answer

`POST /api/practice/answer`

```ts
interface AnswerRequest {
  sessionId: string
  problemId: string
  payload: Record<string, any>
}

interface AnswerResponse {
  correct: boolean
  allSolved: boolean
  hint?: string
  problemState: Problem
  nextIndex: number
  phase: 'answering' | 'correct_pause' | 'wrong_feedback' | 'group_finished'
}
```

### 7.3 Restore Session

`GET /api/practice/session/:sessionId`

```ts
interface RestorePracticeResponse {
  sessionId: string
  taskId: string
  studentName: string
  currentIndex: number
  problems: Problem[]
  elapsedMs: number
  phase: 'answering' | 'correct_pause' | 'wrong_feedback' | 'group_finished'
}
```

### 7.4 Finish Practice

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

## 8. Frontend State

前端保留界面态，但不承担最终真值。

```ts
interface PlayPageState {
  loading: boolean
  apiBaseUrl: string
  taskId: string
  studentName: string
  sessionId: string
  problems: Problem[]
  currentIndex: number
  currentProblem: Problem | null
  elapsedMs: number
  phase: 'answering' | 'correct_pause' | 'wrong_feedback' | 'group_finished'
  selectedRoles: Record<string, string>
  edgeInputs: Record<string, string>
  knownMap: Record<string, string>
  ratioMap: Record<string, string>
  thirdInput: string
  finalInputs: {
    numerator: string
    denominator: string
  }
}
```

前端本地最多只缓存：

- `studentName`
- 最近一次 `sessionId`
- 恢复页面所需的最小路由上下文

题目真值、判题结果、统计结果和完成状态以后端返回为准。

如果前端本地缓存的 `sessionId` 与服务端状态不一致，应以恢复接口返回值覆盖本地状态。

## 9. Network, Concurrency And Reliability

因为前后端分域部署，练习页必须同时考虑并发与网络异常。

最低要求：

- 不把 session 只放浏览器内存
- 服务端按 `sessionId` 隔离数据
- 同一学生重复刷新，不应丢题
- 一个学生的提交，不应覆盖另一个学生的进度
- 跨域请求失败时有明确错误提示
- API 超时或 5xx 时允许重试当前请求

如果页面拿不到 `studentName`，应先跳回首页而不是创建匿名 session。

## 10. API Service Requirements

Lighthouse 上的 API 服务需要满足：

- 提供 HTTPS API
- 正确配置 CORS
- 支持练习 session 持久化
- 将 session 和结果写入数据库
- 允许后续接数据库、用户体系、错题本

建议补充：

- 请求日志
- 错误恢复
- 健康检查接口

## 11. Implementation Direction

推荐把练习页拆成：

- `practice-header`
- `triangle-stage`
- `practice-panel`
- `feedback-strip`

无论前端框架如何选，重点是：

- 组件负责渲染
- session 流程以 API 为中心
- 页面风格延续现有原型
- 自动流转逻辑与结果 modal 行为保持一致

## 12. Resolved Decisions

- 网页版练习页使用独立路由，不再依赖单文件原型直接交付
- 会话状态以服务端为准
- 页面刷新可恢复
- 默认部署方式是 CloudBase 静态前端 + Lighthouse API
- `studentName` 是首版正式字段
