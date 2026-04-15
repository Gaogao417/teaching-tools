# System Architecture

## 摘要

这个项目按“教学关卡运行时”建模，而不是按“若干题型页面”建模。

系统主链路固定为：

```text
TaskDefinition -> ContentDefinition -> EnginePlugin -> ExerciseRuntimeSpec
  -> ExerciseRuntimeHost -> RuntimeActionEvent -> EnginePlugin
  -> ServerRuntimeState / Feedback -> 页面更新
```

当前实现已经不再处于“只有概念、尚未接线”的阶段，而是处于“runtime-first 主路径已接通、对象层与 legacy 收口仍在进行”的阶段。

## 架构目标

系统必须同时满足以下目标：

- 新增任务时，不让 `PracticePage` 和旧服务继续膨胀
- 明确拆开任务目录、内容模板和规则引擎三层
- 让后端成为规则与状态推进的权威来源
- 让前端通过通用 runtime host 和对象层承接多类任务
- 让产品壳层、练习运行时、结果展示运行在同一 workspace 体系内

## 核心边界

### TaskDefinition

`TaskDefinition` 是任务目录层，只负责：

- 任务树
- 标题、摘要、难度、样题
- `engineKind`
- `contentId`

它不负责：

- 判题
- step 推进
- 运行时状态
- 页面实现细节

### ContentDefinition

`ContentDefinition` 是可序列化内容模板层，只负责：

- prompt 模板
- scene 模板
- flow 模板
- guide 模板
- feedback 模板
- 初始变量

它不负责：

- 规则函数
- 判题逻辑
- session 生命周期
- DOM / CSS / 组件细节

### EnginePlugin

`EnginePlugin` 只存在于后端代码中，负责：

- 校验 content
- 生成实例
- 处理标准动作
- 推进步骤与状态
- 组装 `ExerciseRuntimeSpec`

它不进入 shared wire contract。

## 分层结构

推荐按以下层次理解系统：

```text
Product Rules
  -> Task Catalog
  -> Content Registry
  -> Shared Runtime Contracts
  -> Backend Runtime Engine
  -> Frontend Workspace Shell
  -> Frontend Runtime Host
```

### Shared Runtime Contracts

这一层是前后端共享真相源，包含：

- `ExerciseInstance`
- `ExerciseRuntimeSpec`
- `ServerRuntimeState`
- `ClientDraftState`
- `RuntimeActionEvent`
- `RuntimeActionResponse`

兼容期允许保留 legacy types，但它们不是主模型。

### Backend Runtime Engine

这一层负责：

- 从 task + content 生成实例
- 保存 engine state 和 runtime state
- 处理标准动作
- 推进 session
- 持久化结果

### Frontend Workspace Shell

这一层是 `web` 端共享产品壳层，负责：

- 共享导航
- 学生身份确认
- focused task context
- 任务预览与任务树
- 为 overview / practice / result 提供统一外层结构

### Frontend Runtime Host

这一层是真正的练习运行时，负责：

- 挂载当前 session
- 管理客户端 draft state
- 分发 runtime spec 给左侧工作区和右侧引导区
- 上报标准动作
- 根据 feedback cue 调度页面反馈

## 前端结构

当前前端主路径为：

```text
Routes
  -> WorkspaceShell
    -> TaskOverviewPanel
    -> PracticePage
      -> ExerciseRuntimeHost
        -> WorkspaceScene            (目标态)
          -> SceneRenderer
          -> InteractionZoneLayer
          -> InputAnchorLayer
          -> OverlayLayer
        -> GuidePanel
          -> ActionBanner
          -> StepTracker
          -> HintCard
          -> FeedbackCard
        -> FeedbackController
    -> ResultPage
```

当前代码的现实状态是：

- `WorkspaceShell`、`TaskOverviewPanel`、`PracticePage`、`ResultPage` 已接入主路由
- `ExerciseRuntimeHost` 主路径已经不再按 `problem.type` 分支
- `WorkspaceScene / GuidePanel / FeedbackController` 已拆出稳定边界
- 当前三角形特化仍保留在 `SceneRenderer` 内部，不等于最终 DSL 已完全抽象完成

### 前端职责分配

`WorkspaceShell` 负责：

- 共享导航壳层
- 学生身份输入与确认
- focused task context
- 任务预览与任务树

`TaskOverviewPanel` 负责：

- 当前 focused task 概览
- 历史记录与开始/继续入口

`PracticePage` 负责：

- session 创建与恢复
- 顶层计时与题间流转
- 页面级完成弹层
- feedback orchestration

`ExerciseRuntimeHost` 负责：

- 接收 `ExerciseRuntimeSpec`
- 分发 runtime 数据给工作区和引导区
- 收集组件动作并转换成 `RuntimeActionEvent`

### 前端硬约束

- `WorkspaceShell` 是共享产品壳层，不承载判题与题型分支
- `PracticePage` 不是题型实现页
- 左侧工作区是唯一操作世界
- 右侧引导区是只读 HUD
- `ExerciseRuntimeHost` 不允许按 `problem.type` 分支
- `SceneRenderer` 只允许按 `sceneKind` / `entity.kind` 分发

## 后端结构

后端目标结构为：

```text
routes/
services/
  tasks/
  resultsService
  runtime/
    contentRegistry
    engineRegistry
    sessionRuntimeService
  results/
repositories/
db/
```

### 后端职责分配

`tasks/` 负责：

- 任务目录读取
- `TaskDefinition` 投影

`runtime/contentRegistry` 负责：

- `ContentDefinition` 注册和读取

`runtime/engineRegistry` 负责：

- `engineKind -> plugin` 映射

`runtime/sessionRuntimeService` 负责：

- start
- restore
- runtime-action
- finish

`resultsService` 负责：

- 结果快照读取
- 任务历史查询

### 后端硬约束

- 后端主路径不再通过 `Problem -> buildRuntime()` 二次适配
- 新 session 必须直接走 runtime-first pipeline
- 结果/历史查询与运行时状态推进分离，不再复用旧练习主流程服务

## 持久化边界

持久化层至少分离以下数据：

- session 元数据
- content 快照
- engine state
- runtime state

默认决策：

- 保留结果数据
- 旧进行中 session 可以失效，但必须有显式错误语义
- 新 session 使用 runtime-first 持久化结构

## DSL 边界

DSL 可以描述：

- 场景对象
- 交互区域
- 输入锚点
- 步骤流程
- 提示文案
- 反馈 key

DSL 不应直接描述：

- DOM 结构
- CSS class
- 前端脚本实现
- 像素级布局策略

否则系统会退化成“后端遥控前端模板”。

## 当前默认决策

- 项目按教学关卡运行时建模
- `TaskDefinition`、`ContentDefinition`、`EnginePlugin` 是唯一有效的三层边界
- `WorkspaceShell` 是 `web` 的共享产品壳层
- `PracticePage` 是 runtime route shell，不是题型实现页
- 新任务必须优先落入 runtime-first contracts，而不是继续新增页面分支
