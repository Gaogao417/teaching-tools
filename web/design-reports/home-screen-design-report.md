# Web Home Screen Design Report

## 1. Scope

本报告描述网页版任务选择页在“前后端分离 Web 应用”形态下的产品目标、页面结构和 API 边界。

这里的“网页版”不是老师本机运行的单体服务，而是：

- 前端构建为静态资源
- 部署到腾讯云 CloudBase 静态网站托管
- 学生通过公网 HTTPS 页面访问
- 后端 API 独立部署在腾讯云 Lighthouse
- 前端通过 HTTPS 调用独立 API 服务

## 2. Deployment Goal

目标形态是“静态前端 + 独立后端”的教学站点。

默认部署方式：

- 前端：CloudBase 静态网站托管
- 后端：Lighthouse 上运行 `Node.js + Express`
- 前端域名：例如 `https://math.example.com`
- API 域名：例如 `https://api.math.example.com`
- 前后端分域部署，使用 HTTPS 通信

首页文档需要默认考虑：

- 静态资源通过 CDN 分发
- API 通过环境变量 `API_BASE_URL` 配置
- 后端需要正确配置 CORS，仅允许前端域名访问

## 3. Product Goal

首页从“单网页入口”升级成“教学任务门户”。

核心目标：

- 学生先填写姓名，再定位课程任务并进入练习
- 老师可以把任务组织成“年级 -> 章节 -> 任务”
- 首页即可看到任务说明、样题和当前学生的最近训练记录
- 页面视觉与练习体验延续 `trigonometry-practice.html` 的课堂教具板风格

## 4. Information Architecture

```text
首页 /tasks
  ├─ 顶部：站点标题 + 学生姓名入口
  ├─ 左侧课程树
  │   └─ 年级 -> 章节 -> 任务
  └─ 右侧任务详情
      ├─ 标题
      ├─ 难度
      ├─ 样题
      ├─ 解题步骤
      ├─ 最近历史
      └─ 开始练习
```

路由建议：

- `/` 或 `/tasks`：任务选择页
- `/practice/:taskId`：练习页
- `/result/:sessionId`：结果页

## 5. User Model

本阶段按单一学生视角设计页面，但正式把学生姓名纳入首版流程。

默认前提：

- 学生通过浏览器直接进入首页
- 暂不要求登录
- 学生开始练习前必须填写 `studentName`
- 历史记录按 `studentName + taskId` 聚合
- 后续如需升级身份体系，可追加 `studentId`、邀请码或班级码

## 6. Visual Direction

首页不能退回成普通管理后台风格，需延续 `trigonometry-practice.html` 的视觉基线：

- 温暖纸面背景
- 白色教具板卡片
- 深墨色正文
- 橙 / 绿 / 蓝的稳定角色色彩
- 卡片圆角、柔和阴影、明确主次层级

首页作为入口页，信息密度比练习页低，但要与练习页保持同一品牌感。

## 7. Page Layout

### 7.1 Desktop

桌面端使用左右双栏：

```text
┌────────────────────┬──────────────────────────────────────┐
│ 课程树             │ 任务详情                             │
│ 年级 / 章节 / 任务 │ 标题 / 难度 / 样题 / 历史 / CTA      │
└────────────────────┴──────────────────────────────────────┘
```

顶部补充一个学生信息条：

- 当前学生姓名
- 修改姓名入口
- 当前环境提示，例如“已连接练习服务”

### 7.2 Mobile

移动端规则：

- 课程树改成抽屉
- 默认显示任务详情
- 顶部保留“切换任务”按钮
- 姓名输入优先显示在顶部区域
- CTA 固定在底部安全区域附近

首页必须优先保证手机浏览器可用。

## 8. Interaction Design

### 8.1 Student Name Flow

- 首次进入首页时优先显示姓名输入
- 未填写 `studentName` 时，“开始练习”按钮不可用
- 学生姓名提交后写入前端本地缓存，供后续创建 session 使用
- 学生可在首页重新修改姓名，修改后历史区随之刷新

### 8.2 Tree Behavior

- 点击年级：展开/收起
- 点击章节：展开/收起
- 点击任务：刷新详情面板
- 首次进入默认展开第一个年级、第一个章节，并选中第一个任务

### 8.3 Detail Panel

任务详情固定包含：

- 任务标题
- 难度标签
- 一条任务摘要
- 一个样题题干
- 解题步骤列表
- 当前学生最近 5 次训练记录
- “开始练习”按钮

### 8.4 Start Practice

- 点击后进入 `/practice/:taskId`
- 路由跳转后立即调用 `POST /api/practice/start`
- 请求体必须带上 `taskId + studentName`

## 9. Backend Contract

首页接口保持清晰，不把练习判题逻辑掺进来。

共享类型、错误响应、session 生命周期和持久化约束，以 `backend-design-report.md` 为准。

### 9.1 Task Tree

`GET /api/task-tree`

```ts
interface TaskTreeResponse {
  grades: GradeNode[]
}

interface GradeNode {
  id: string
  name: string
  chapters: ChapterNode[]
}

interface ChapterNode {
  id: string
  name: string
  tasks: TaskNode[]
}

interface TaskNode {
  id: 'meaning' | 'ratioToSide' | 'guidedSolve'
  title: string
  summary: string
  difficulty: 'easy' | 'medium' | 'hard'
  sample: {
    prompt: string
    answerPreview?: string
  }
  steps: string[]
  color?: string
}
```

### 9.2 Task History

`GET /api/task-history/:taskId?studentName=...`

```ts
interface TaskHistoryResponse {
  taskId: 'meaning' | 'ratioToSide' | 'guidedSolve'
  studentName: string
  items: TaskHistoryItem[]
}

interface TaskHistoryItem {
  studentName: string
  elapsedMs: number
  clearedAt: string
  problemCount: number
  firstTryAccuracy: number
}
```

当前首页默认只拉取最近 5 条记录，`studentName` 在当前版本为必填查询参数。

### 9.3 Environment Contract

前端运行时需要：

- `API_BASE_URL`
- API 服务启用 HTTPS
- API 服务允许首页域名跨域访问

## 10. API Service Responsibilities

Lighthouse 上的 API 服务至少承担这些职责：

- 提供 `/api/task-tree`
- 提供 `/api/task-history/:taskId`
- 提供练习会话相关接口
- 持久化学生练习历史
- 基于 `studentName` 聚合结果数据

静态资源托管不由 API 服务承担。

## 11. Data Storage

首版建议：

- 开发环境可用 SQLite
- 生产环境优先考虑 MySQL

如果首版直接部署到 Lighthouse，也可以先用 SQLite 落地，但文档需明确：

- 这是轻量起步方案
- 后续可迁移到 MySQL
- 数据模型要预留多学生并发访问能力

## 12. Implementation Direction

建议把 Web 版明确拆成前后端两个独立工程。

推荐结构：

```text
web/
  frontend/
    pages/
    components/
    styles/
  backend/
    routes/
    services/
    db/
```

最低可行技术路线：

- 前端：静态 Web 应用，构建后部署到 CloudBase
- 后端：Node.js + Express
- 数据：开发期 SQLite，生产建议 MySQL

关键要求：

- 前端可独立构建和发布
- 后端只负责 API 与数据
- 接口字段在首页、练习页、结果页三份文档中保持一致

## 13. Resolved Decisions

- `web` 版目标从“原型页”升级为“前后端分离教学 Web 应用”
- 默认前端部署环境是腾讯云 CloudBase 静态网站托管
- 默认后端部署环境是腾讯云 Lighthouse
- 首页继续采用课程树 + 详情面板，不回退到卡片入口
- 首版正式纳入 `studentName`
