# System Architecture

## 摘要

这个项目应按“教学关卡引擎”来设计，而不是按“若干题型页面”来设计。

学生在练习页里做的事情，本质上和游戏里的任务推进一致：

- 后端生成一个关卡实例
- 前端加载一个运行时
- 学生在工作区里执行动作
- 系统即时反馈动作结果
- 运行时根据规则推进到下一步或下一题

因此，系统的核心不是 `PracticePage` 里有多少 JSX 分支，而是是否建立了下面这条主链路：

```text
教学内容定义 -> 关卡实例 -> 前端运行时 -> 标准化动作 -> 后端判定 -> 状态推进 -> 反馈与流转
```

## 架构目标

系统架构需要同时满足这 4 个目标：

- 支持不断增加的新题型，而不让 `PracticePage` 持续膨胀
- 把“教学规则”和“前端表现”解耦
- 让后端成为题目真值和流程推进的权威来源
- 让前端通过通用运行时复用工作区组件和引导组件

## 核心视角

### 1. 题型不是页面，题型是关卡内容

`meaning`、`ratioToSide`、`guidedSolve` 不应被理解为 3 个页面实现，而应被理解为 3 种关卡内容实例。

页面只有一个练习运行时页面。

它接收不同的关卡定义和运行时状态，渲染出不同的教学体验。

### 2. 前端不是判题器，前端是运行时宿主

前端的职责不是知道每种题型的正确答案，而是：

- 呈现场景
- 接收学生动作
- 维护局部草稿态
- 调用后端判定
- 接收状态更新
- 呈现反馈

### 3. 后端不是页面 API，后端是规则服务器

后端不仅返回题目文案，还负责：

- 生成关卡实例
- 保存规则真值
- 判定动作结果
- 推进 step / phase / completion
- 返回前端下一帧所需状态

## 系统分层

推荐用下面 6 层理解整个系统：

```text
Product Rules
  -> Teaching Content Layer
    -> Shared Runtime Contracts
      -> Backend Rule Engine
      -> Frontend Exercise Runtime
        -> Workspace Object Library
        -> Guide / Feedback Library
```

### 1. Product Rules

这一层定义教学目标和交互原则，例如：

- 左侧负责操作，右侧负责引导
- 一次只强调一个当前任务
- 正误必须即时反馈
- 题目推进采用步骤式而不是自由编辑式

这一层不包含实现细节，但决定整个系统的边界。

### 2. Teaching Content Layer

这一层描述“题目内容”本身，而不是 UI 代码。

它定义：

- 场景里有哪些教学对象
- 当前题的教学目标是什么
- 学生被允许做哪些动作
- 这些动作如何组织成步骤
- 成功与失败分别触发哪些反馈

这一层的输出应是可序列化的内容定义，可以由后端生成，也可以在未来由教研工具生产。

### 3. Shared Runtime Contracts

这一层是前后端共享的运行时契约，负责描述：

- 场景 schema
- 动作 schema
- 流程 schema
- 反馈 schema
- 运行时状态
- API 请求与响应

这层才是整个系统的单一数据真相源。

`shared/contracts.ts` 最终应承接这层。

### 4. Backend Rule Engine

这一层是服务端规则引擎，负责：

- 生成关卡实例
- 保存题目真值
- 验证学生动作
- 更新步骤状态
- 维护 session 生命周期
- 持久化结果

后端是 authoritative source。

前端不能最终认定：

- 哪一步完成了
- 题目是否答对
- 当前是否应进入下一题

### 5. Frontend Exercise Runtime

这一层是前端练习运行时，是整个页面的真正核心。

它负责：

- 加载 session 和关卡实例
- 把后端返回的 runtime spec 分发给工作区与引导区
- 接收组件抛出的标准化动作
- 管理本地 draft state
- 触发提交
- 接收服务端状态 patch
- 调度音效、动画、自动流转

`PracticePage` 应被重构成这层的宿主，而不是题型实现页。

### 6. Workspace / Guide Libraries

这一层是组件库，但不是普通展示组件库，而是教学运行时使用的对象库。

分成两部分：

- Workspace Object Library
  负责左侧交互世界里的对象。
- Guide / Feedback Library
  负责右侧引导和全局反馈。

## 关键边界

### 后端和运行时的边界

后端负责：

- 规则
- 真值
- 关卡实例
- 运行时主状态推进
- 标准反馈结果

前端运行时负责：

- 局部输入态
- 焦点管理
- 命中交互
- 动画和音效表现
- 页面级自动流转表现

判断标准：

- 如果某个逻辑会影响“学生是否答对、步骤是否解锁”，它属于后端
- 如果某个逻辑只影响“学生如何看到、如何点击、如何输入”，它属于前端运行时

### PracticePage 和组件库的边界

`PracticePage` 负责：

- session 宿主
- runtime 初始化
- API 协调
- 标准事件收发
- feedback orchestration

组件库负责：

- 渲染场景对象
- 渲染步骤与提示
- 采集学生交互
- 上报标准动作

组件库不负责：

- 保存题目真值
- 判题
- 决定下一步解锁

### 组件库和 DSL 的边界

DSL 负责描述语义，不负责描述底层渲染细节。

DSL 可以描述：

- 场景对象
- 当前目标
- 可执行动作
- 步骤推进
- 提示文案
- 反馈 key

DSL 不应直接描述：

- 某个 DOM 结构
- 某个 CSS class
- 某段前端脚本
- 某个像素级布局

这条边界很关键。否则系统会退化成“后端远程操控前端模板”。

## 前端结构

推荐前端最终落成下面的结构：

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

这里最重要的是 `ExerciseRuntimeHost`。

它比页面更稳定，比题型更抽象，是新增题型时最应该复用的核心。

## 后端结构

后端建议按“内容 + 规则 + 持久化”拆开：

```text
routes/
controllers/
services/
  tasks/
  practice/
  runtime/
  results/
repositories/
db/
```

建议增加一个显式的 `runtime` 或 `engine` 责任区，负责：

- 关卡实例生成
- action 判定
- step 推进
- runtime state 组装

这样可以避免所有逻辑继续堆在 `practiceService.ts`。

## 组件库职责

### Workspace Object Library

这不是纯展示层，而是“可交互场景对象层”。

典型对象包括：

- `SceneRenderer`
- `InteractionZone`
- `InputAnchor`
- `SceneLabel`
- `SceneOverlay`
- `FormulaComposer`

这些对象接收 schema 和 state，输出标准事件。

针对具体场景的对象库，例如三角形专用对象，应属于某个场景插件或 feature 实现，不应在项目级架构文档中被视为通用运行时本体。

### Guide / Feedback Library

这一层负责教学引导，不承载核心操作。

典型对象包括：

- `GuidePanel`
- `ActionBanner`
- `StepTracker`
- `HintPanel`
- `FeedbackCard`
- `CompletionOverlay`

右侧引导区必须是只读引导层，而不是第二个工作区。

## 为什么要引入 DSL

引入 DSL 不是为了“炫技”或“后端遥控前端”，而是为了明确：

- 什么是教学内容
- 什么是关卡流程
- 什么是学生动作
- 什么是运行时可复用能力

如果没有 DSL，新增题型时通常会发生两件事：

- 后端新加一组字段
- 前端新写一套 `if (problem.type === ...)`

这会让边界越来越模糊，最终无法抽象出通用运行时。

## 当前阶段的默认决策

- 项目按“教学关卡引擎”建模
- `PracticePage` 是 runtime host，不是题型实现页
- 新题型必须优先落入通用 runtime contract，而不是直接加页面分支
- 左侧工作区是唯一操作世界
- 右侧面板是任务日志、步骤引导和反馈 HUD
- 组件库分成工作区对象库和引导反馈库
- 后端输出语义级 DSL，不直接输出前端实现细节
