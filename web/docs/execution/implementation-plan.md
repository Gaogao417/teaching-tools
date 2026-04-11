# Runtime-First Refactor Implementation Plan

## 摘要

这次重构的目标不是继续给现有实现补丁，而是把 `web/` 主线真正切到 runtime-first 架构，并让实现与 docs 保持一致。

当前项目处于“兼容增强 + 双轨接口”阶段，已经具备：

- shared 里有 runtime 相关类型
- 后端有 `runtime-action` 接口
- `PracticePage` / `ExerciseRuntimeHost` 有 runtime host 雏形

但还没有完成：

- 前端仍按 `problem.type` 分支渲染
- 后端 runtime 仍由旧 `Problem + AnswerPayload` 适配出来
- 任务目录、内容定义、规则引擎三层边界尚未真正落地

因此，这份计划的作用不是“说明大方向”，而是提供一个可以直接监督、拆解和验收的执行清单。

## 核心决策

本轮重构固定采用以下边界，后续实现不得偏离：

- `TaskDefinition`
  只管理首页任务目录、任务摘要、排序和入口信息
- `ContentDefinition`
  只管理可序列化内容模板，如 prompt、scene、flow、guide、feedback
- `EnginePlugin`
  只管理代码形式的实例生成、动作处理、状态推进和判定逻辑

对应约束：

- 适合 registry 管理的是 `TaskDefinition` 和 `ContentDefinition`
- 不允许把判题逻辑和状态推进逻辑塞进 content 表或 shared wire schema
- `PracticePage` 是 runtime page shell，不再是题型实现页
- 组件库按工作区对象层与引导反馈层分开
- 迁移期间允许兼容层，但兼容层不是新的主路径

## 范围与默认假设

- 本计划只覆盖 `web/`
- `wxapp/` 不在本轮范围内，只在后续需要时单独制定兼容计划
- 当前数据库结果数据保留，旧进行中 session 可失效
- 当前三类任务 `meaning` / `ratioToSide` / `guidedSolve` 必须全部纳入同一 runtime model
- 本轮不建设教研后台和可视化内容编辑器，`ContentDefinition` 先以代码文件维护

## 交付物

本轮重构完成后，仓库里必须明确存在以下交付物：

- 已冻结的 docs 边界文档
- runtime-first 的 shared contracts
- 任务目录与内容模板 registry
- 后端 runtime engine / session service / legacy adapter 分层
- 前端 runtime host 组件树
- 当前 3 个任务迁移到 runtime-first 主路径
- 可执行的测试清单和验收结果

## 实施顺序

顺序固定，不允许跳步：

1. 先修 docs
2. 再定 shared contracts
3. 再拆 backend runtime
4. 再重构 frontend runtime host
5. 最后收口 legacy path

原因很简单：如果先改实现，再补边界，系统会再次退回到“页面和服务里各自猜模型”。

## 阶段 1：文档冻结

### 目标

把 docs 从“描述理想架构”推进到“指导实现的唯一真相源”。

### 必做项

- 更新 `02-system-architecture.md`
- 更新 `03-domain-model.md`
- 更新 `04-api-contracts.md`
- 更新 `features/practice.md`
- 用本文件替代旧的粗粒度 implementation plan

### 文档必须明确写清的内容

- `TaskDefinition` / `ContentDefinition` / `EnginePlugin` 三层边界
- 前端目标组件树
- 后端目标责任区
- shared 中哪些是主模型，哪些是 legacy 兼容模型
- 持久化层的目标模型
- 迁移期间的兼容策略和删除条件

### 完成标准

- 文档中不再把 `Problem` / `MeaningProblem` / `RatioToSideProblem` / `GuidedSolveProblem` 当作主模型
- 文档之间没有互相冲突的口径
- 组件树、domain model、API contracts 使用同一组术语

### 验收清单

- [x] `02` 已明确前端组件树和后端责任区
- [x] `03` 已明确三层模型及运行时顶层对象
- [x] `04` 已明确目标契约与兼容契约
- [x] `features/practice` 已明确 PracticePage 不是题型实现页
- [x] 文档中没有继续把 `ProblemRenderSchema` 当最终 DSL

## 阶段 2：共享契约冻结

### 目标

让 `shared/contracts.ts` 成为 runtime-first 的类型真相源，同时把 legacy 类型显式降级为兼容层。

### 必做项

- 定义 `TaskDefinition`
- 定义 `ContentDefinition`
- 定义 `ExerciseInstance`
- 定义 `ExerciseRuntimeSpec`
- 定义 `PracticeSessionSnapshot`
- 定义 `RuntimeActionEvent` / `RuntimeActionResponse`
- 把旧 `Problem` 系列类型移入 legacy 区

### 具体要求

- `TaskDefinition` 只出现目录和入口相关字段
- `ContentDefinition` 只出现可序列化模板字段
- `EnginePlugin` 不进入 shared wire contract
- `StartPracticeResponse` / `RestorePracticeResponse` 对齐到 session snapshot 思路
- 允许短期保留 legacy 字段，但新代码不得以 legacy 字段为核心

### 完成标准

- shared 中主路径类型不依赖 `problem.type`
- frontend / backend 新主路径都能只消费 runtime-first types
- legacy 类型只服务兼容接口、老数据适配或结果兼容

### 验收清单

- [x] `TaskDefinition` 已存在并可驱动首页任务树
- [x] `ContentDefinition` 已存在并表达当前 3 类任务内容
- [x] `PracticeSessionSnapshot` 已存在
- [x] `Problem` 系列类型已明确标记为 legacy
- [x] shared 主路径命名与 docs 一致

## 阶段 3：后端 runtime engine 重构

### 目标

把 `practiceService.ts` 从“大一统混合文件”拆成可演进的 runtime architecture。

### 目标结构

后端至少拆成这些责任区：

- `tasks/`
  任务目录读取与投影
- `runtime/contentRegistry`
  内容模板注册
- `runtime/engineRegistry`
  引擎插件注册
- `runtime/sessionRuntimeService`
  session 启动、恢复、动作推进、完成
- `runtime/legacyAdapter`
  把旧 answer payload 适配到 runtime action

### 必做项

- 从 `practiceService.ts` 拆出任务目录逻辑
- 从 `practiceService.ts` 拆出实例生成逻辑
- 从 `practiceService.ts` 拆出动作处理逻辑
- 从 `practiceService.ts` 拆出 session persistence 逻辑
- 保留 `submitAnswer`，但内部只做 adapter

### 运行时要求

- 当前 3 个任务共享 `triangle-trig` engine plugin
- `EnginePlugin` 负责：
  - 生成实例
  - 验证内容
  - 处理动作
  - 推进步骤
  - 组装 runtime state
- 后端主路径不再通过 `Problem -> buildRuntime()` 二次适配生成 runtime

### 持久化要求

- 新 session 使用新表或新结构持久化 runtime instance / engine state / runtime state
- 旧结果快照保留
- 旧进行中 session 可以失效，但必须有明确错误语义

### 完成标准

- 新 session 全量走 runtime-first pipeline
- `runtime-action` 成为主动作接口
- `answer` 接口只是兼容入口，不再承载独立判题逻辑
- 后端生成的 runtime 数据不依赖 legacy `renderSchema`

### 验收清单

- [ ] `practiceService` 已拆分出 runtime 责任区
- [ ] 当前 3 个任务已接入同一个 engine plugin
- [ ] `startPractice` 走任务定义 + 内容定义 + plugin 创建实例
- [ ] `submitRuntimeAction` 不再依赖旧题型分支判题主流程
- [ ] 旧 session 失效时有明确错误响应

## 阶段 4：前端 runtime host 重构

### 目标

把前端从“按题型写页面分支”重构为“按 runtime spec 渲染的宿主 + 组件库”。

### 目标组件树

```text
PracticePage
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

### 必做项

- `PracticePage` 只保留 session orchestration
- `ExerciseRuntimeHost` 只消费 runtime-first spec
- `WorkspaceScene` 负责左侧操作世界
- `GuidePanel` 负责右侧只读引导
- `FeedbackController` 统一接 runtime feedback cue

### 组件约束

- `PracticePage` 不允许再出现题型专属输入逻辑
- `ExerciseRuntimeHost` 不允许按 `problem.type` 分支渲染
- `SceneRenderer` 只允许按 `sceneKind` / `entity.kind` 分发
- 右侧不允许出现主输入控件
- 左侧必须是唯一操作区

### 迁移要求

- `renderers.tsx` 视为 legacy 文件
- `ExerciseRuntimeHost.tsx` 当前题型分支实现必须逐步被 runtime object layers 替换
- 三角形专用渲染进入 feature-level object library，不继续混在项目级 runtime host 里

### 完成标准

- 新的前端主路径不再 import legacy `Problem` 类型
- 当前 3 类任务都能由 runtime spec 驱动
- 新增同类任务时不需要修改 `PracticePage`

### 验收清单

- [ ] `PracticePage` 只负责 session / feedback / finish flow
- [ ] `ExerciseRuntimeHost` 已无 `problem.type` 分支
- [ ] 左侧工作区组件已拆层
- [ ] 右侧引导组件已拆层
- [ ] `renderers.tsx` 不再被主页面依赖

## 阶段 5：当前 3 个任务迁移

### 目标

把 `meaning`、`ratioToSide`、`guidedSolve` 从“3 套旧题型逻辑”迁移为“同一 runtime model 的 3 个内容实例”。

### 必做项

- 为每个任务定义 `TaskDefinition`
- 为每个任务定义 `ContentDefinition`
- 为三者提供统一的 `triangle-trig` plugin 支撑
- 将内容差异落到 scene / flow / guide / feedback
- 将判题与推进逻辑落到 engine plugin

### 任务级验收重点

#### meaning

- 左侧通过标准动作完成“有序选边”
- 右侧只展示“先选分子 / 再选分母”引导
- 不再依赖页面内 meaning 专属渲染分支

#### ratioToSide

- 左侧边锚点输入由 scene anchors 驱动
- 提交由 runtime action 驱动
- 不再依赖 `renderSchema.workspace` 旧结构

#### guidedSolve

- 多步骤推进由 flow state 驱动
- 引导摘要由 runtime state 驱动
- 最终公式槽由 scene / anchor / action 模型驱动

### 完成标准

- 当前 3 类任务都通过统一 runtime pipeline 跑通
- 新增第 4 个同引擎任务时，不需要再新增一套页面分支和服务分支

### 验收清单

- [ ] `meaning` 已迁移到 runtime-first 主路径
- [ ] `ratioToSide` 已迁移到 runtime-first 主路径
- [ ] `guidedSolve` 已迁移到 runtime-first 主路径
- [ ] 三者共享同一 engine plugin
- [ ] 三者差异仅体现在 task/content/engine state，不体现在页面结构

## 阶段 6：legacy 收口

### 目标

把兼容层从“主路径依赖”降到“仅存量接口和数据兼容”。

### 必做项

- 清理主页面对 legacy 类型的依赖
- 清理主服务对 legacy 判题逻辑的依赖
- 只保留必要的 `submitAnswer` adapter
- 清理废弃注释、过渡函数和无效 runtime adapter 代码

### 删除条件

以下条件全部满足后，才允许进一步删除 legacy 实现：

- runtime-first 前端主路径稳定
- runtime-first 后端主路径稳定
- 当前 3 个任务已迁移完毕
- e2e 和回归测试已通过

### 验收清单

- [ ] 主路径已不依赖 `ProblemRenderSchema`
- [ ] 主路径已不依赖 `Problem + AnswerPayload`
- [ ] legacy 文件和类型已经集中标识
- [ ] 删除不会影响结果页和历史数据

## 测试与验收方案

### 单元测试

- engine plugin 的实例生成
- engine plugin 的动作合法性
- step 推进
- 正确 / 错误 / 完成三类反馈

### 集成测试

- `startPractice`
- `restorePractice`
- `runtime-action`
- `finishPractice`
- legacy `answer` adapter

### 前端组件测试

- 左侧是唯一输入区
- 右侧不含主输入控件
- feedback cue 能正确映射到页面反馈
- session restore 后界面状态正确

### 端到端场景

- 开始新 session
- 连续正确作答
- 作答错误并修正
- 中途刷新恢复
- 完成整组并查看结果页

### 总体验收标准

达到以下条件时，视为这轮重构完成：

- docs、shared、backend、frontend 对同一 runtime model 有一致实现
- `PracticePage` 不再是题型实现页
- `practiceService` 不再是所有逻辑的单点堆积
- 新增同引擎任务时，不需要新增页面架构和后端主流程
- 当前 3 个任务全部跑在 runtime-first 主路径上

## 风险与检查点

### 高风险点

- 文档未冻结就继续写实现
- shared contracts 改得太快，导致前后端一起失稳
- 前端只换壳，不真正移除题型分支
- 后端只换接口名，内核仍停留在旧题型判题

### 每阶段都要检查的问题

- 这一步是在强化 runtime-first，还是只是包装旧模型？
- 这一步是否把新的业务逻辑继续塞回 page / practiceService / shared special fields？
- 这一步完成后，新增任务是否更容易复用，而不是更依赖分支？

## 建议执行方式

建议按阶段提交和验收，不要整包合并：

1. docs 冻结
2. shared contracts 冻结
3. backend runtime 跑通
4. frontend runtime host 跑通
5. 3 个任务迁移完
6. legacy 收口

每一阶段结束后，都应该有一次单独评审，检查是否已经可以进入下一阶段。
