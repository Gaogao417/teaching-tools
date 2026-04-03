# System Architecture

## 摘要

这个项目应按“教学关卡运行时”设计，而不是按“若干题型页面”设计。

系统的主链路固定为：

```text
TaskDefinition -> ContentDefinition -> EnginePlugin -> ExerciseRuntimeSpec
  -> ExerciseRuntimeHost -> RuntimeActionEvent -> EnginePlugin
  -> ServerRuntimeState / Feedback -> 页面更新
```

当前实现还处于“兼容增强 + 双轨接口”阶段，因此本文件的目标不是描述理想图景，而是冻结后续实现必须遵守的边界。

## 架构目标

系统必须同时满足下面 4 个目标：

- 新增任务时不让 `PracticePage` 和 `practiceService` 持续膨胀
- 把任务目录、内容模板、规则引擎明确拆开
- 让后端成为规则和状态推进的权威来源
- 让前端通过通用 runtime host 和对象库承接多类任务

## 核心边界

### 1. TaskDefinition

`TaskDefinition` 是任务目录层。

它只负责：

- 首页任务树
- 任务标题、摘要、难度、样题
- 任务归属的 `engineKind`
- 任务绑定的 `contentId`

它不负责：

- 判题
- step 推进
- 运行时状态
- 具体场景交互细节

### 2. ContentDefinition

`ContentDefinition` 是内容模板层。

它只负责可序列化内容：

- prompt 模板
- scene 模板
- flow 模板
- guide 模板
- feedback 模板
- 初始变量

它不负责：

- 函数逻辑
- 判题逻辑
- session 生命周期
- DOM / CSS / 组件实现细节

### 3. EnginePlugin

`EnginePlugin` 是规则引擎层。

它只存在于后端代码中，负责：

- 校验 content
- 生成实例
- 接收并处理标准动作
- 推进步骤和状态
- 组装 `ExerciseRuntimeSpec`

它不进入 shared wire contract。

### 边界结论

适合 registry 管理的是：

- `TaskDefinition`
- `ContentDefinition`

不应进入 registry 的是：

- 判题逻辑
- 状态推进逻辑
- 引擎内部状态机

## 系统分层

推荐按下面 6 层理解整个系统：

```text
Product Rules
  -> Task Catalog
  -> Content Registry
  -> Shared Runtime Contracts
  -> Backend Runtime Engine
  -> Frontend Runtime Host
```

### Product Rules

这层定义产品级原则：

- 左侧负责操作，右侧负责引导
- 一次只突出一个当前目标
- 正误必须即时反馈
- 页面只承接运行时，不承接题型特化实现

### Task Catalog

这层由 `TaskDefinition` 驱动。

它输出首页树结构和会话入口信息，不输出规则逻辑。

### Content Registry

这层由 `ContentDefinition` 驱动。

它输出纯序列化模板，不直接驱动具体组件实现。

### Shared Runtime Contracts

这层是前后端共享真相源，负责：

- `ExerciseInstance`
- `ExerciseRuntimeSpec`
- `ServerRuntimeState`
- `ClientDraftState`
- `RuntimeActionEvent`
- `RuntimeActionResponse`

兼容期内也允许保留 legacy types，但它们不是主模型。

### Backend Runtime Engine

这层是服务端规则运行时，负责：

- 从 task + content 生成实例
- 保存 engine state 和 runtime state
- 处理标准动作
- 推进 session
- 持久化结果

### Frontend Runtime Host

这层是前端真正的练习内核，负责：

- 挂载 session
- 管理客户端 draft state
- 分发 runtime spec 给左侧工作区和右侧引导区
- 上报标准动作
- 根据反馈 cue 调度页面反馈

## 前端结构

前端目标结构固定为：

```text
Route
  -> PracticePage
    -> ExerciseRuntimeHost
      -> WorkspaceScene
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
```

### 前端职责分配

`PracticePage` 负责：

- session 创建与恢复
- 顶层计时与题间流转
- 页面级结果弹层
- feedback orchestration

`ExerciseRuntimeHost` 负责：

- 接收 `ExerciseRuntimeSpec`
- 维护 `ClientDraftState`
- 把 runtime 数据分发给工作区和引导区
- 收集组件动作并转成 `RuntimeActionEvent`

Workspace Object Library 负责：

- 渲染 scene entities
- 绑定 interaction zones
- 渲染 input anchors
- 产生标准动作

Guide / Feedback Library 负责：

- 展示当前目标
- 展示步骤和摘要
- 展示提示与反馈
- 不承载主输入控件

### 前端硬约束

- `PracticePage` 不是题型实现页
- 左侧工作区是唯一操作世界
- 右侧引导区是只读 HUD
- `ExerciseRuntimeHost` 不允许按 `problem.type` 分支
- `SceneRenderer` 只允许按 `sceneKind` / `entity.kind` 分发

## 后端结构

后端目标结构固定为：

```text
routes/
services/
  tasks/
  runtime/
    contentRegistry
    engineRegistry
    sessionRuntimeService
    legacyAdapter
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

- `engineKind` 到 plugin 的映射

`runtime/sessionRuntimeService` 负责：

- start
- restore
- runtime-action
- finish

`runtime/legacyAdapter` 负责：

- 兼容 `Problem + AnswerPayload`
- 把旧请求转换成标准动作

### 后端硬约束

- 后端主路径不再通过 `Problem -> buildRuntime()` 二次适配
- `submitAnswer` 只能是 adapter，不再承载独立判题主流程
- 新 session 必须直接走 runtime-first pipeline

## 持久化边界

持久化层至少要分清 4 类数据：

- session 元数据
- content 快照
- engine state
- runtime state

当前默认决策：

- 保留结果数据
- 旧进行中 session 可以失效
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
- `PracticePage` 是 runtime page shell，不是题型实现页
- `ProblemRenderSchema` 是过渡结构，不是最终通用 DSL
- 新任务必须优先落入 runtime-first contracts，而不是直接新增页面分支
