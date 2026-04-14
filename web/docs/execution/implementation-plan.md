# Runtime-First Refactor Implementation Plan

## 摘要

这份计划不再描述 `eae3921` 时点的“预备重构状态”，而是记录当前 `web/` 主线已经完成到哪里、还剩哪些收口工作。

目前已经成立的事实：

- `shared/contracts.ts` 已经以 runtime-first 模型为主
- 后端主入口已经走 `runtime/sessionRuntimeService`
- 前端练习主路径已经只消费 `PracticeSessionSnapshot + ExerciseRuntimeSpec`
- `ExerciseRuntimeHost` 主路径已经去掉 `problem.type` 分支

因此，当前剩余工作不再是“把 runtime-first 接上”，而是：

- 同步 docs 与新的 `WorkspaceShell` 信息架构
- 把前端 runtime host 从“运行时驱动但仍带三角形特化”继续拆到对象层
- 收口 legacy 类型、旧服务和未接线页面文件

## 当前基线

当前 `web` 主路径可以概括为：

```text
Routes
  -> WorkspaceShell
    -> TaskOverviewPanel (/)
    -> PracticePage (/practice/:taskId)
      -> ExerciseRuntimeHost
    -> ResultPage (/result/:sessionId)
```

其中：

- `WorkspaceShell` 负责共享导航、学生身份输入、任务预览和 focused task context
- `TaskOverviewPanel` 负责当前聚焦任务的概览、历史和开始入口
- `PracticePage` 负责 session 启动/恢复、计时、题间推进、完成流转和页面级反馈
- `ExerciseRuntimeHost` 负责消费 runtime spec 并渲染练习主界面
- `ResultPage` 负责读取后端持久化结果快照并回挂到同一 workspace 壳层中

## 固定边界

本轮及后续收口仍然遵守以下边界：

- `TaskDefinition`
  只管理任务目录、摘要、入口和分类信息
- `ContentDefinition`
  只管理可序列化模板，如 prompt、scene、flow、guide、feedback
- `EnginePlugin`
  只管理实例生成、动作处理、状态推进和判定逻辑

约束保持不变：

- registry 只管理 `TaskDefinition` 和 `ContentDefinition`
- 判题逻辑和状态推进逻辑不能回流进 content 表达层或 shared wire schema
- `PracticePage` 是 runtime route shell，不是题型实现页
- 兼容层允许存在，但不再作为新实现的主路径

## 范围与旁线

- 本计划继续只覆盖 `web/` 主路径
- `wxapp/` 当前可以有视觉或交互跟随改动，但属于并行旁线，不计入 runtime-first 主线里程碑
- 当前结果数据继续保留，旧进行中 session 可以显式失效
- 当前三类任务 `meaning` / `ratioToSide` / `guidedSolve` 继续共享同一 runtime model

## 阶段状态

## 阶段 1：文档冻结与同步

状态：进行中

已完成：

- 核心 runtime-first docs 已存在
- `TaskDefinition / ContentDefinition / EnginePlugin` 三层边界已经写清
- shared/domain/API 基础术语已经统一

剩余工作：

- 同步 `02-system-architecture.md` 到 `WorkspaceShell` 嵌套路由结构
- 同步 `features/home.md`、`features/practice.md`、`features/result.md` 到当前页面壳层
- 在本文档中把“当前事实”和“目标态”分开，避免继续引用过时状态

完成标准：

- docs 不再把 home / practice / result 写成彼此隔离的独立页面体系
- docs 明确当前 `TriangleScene` 只是过渡实现，不等于最终对象层目标态
- 文档之间不再同时出现两套前端主结构口径

## 阶段 2：共享契约冻结

状态：基本完成

已完成：

- `TaskDefinition`
- `ContentDefinition`
- `ExerciseInstance`
- `ExerciseRuntimeSpec`
- `PracticeSessionSnapshot`
- `RuntimeActionEvent / RuntimeActionResponse`
- legacy problem types 已降级并集中到兼容区

剩余工作：

- 继续限制 legacy 字段扩张，避免新代码重新依赖 `legacy.problems`
- 在兼容窗口结束后，把 `ProblemRenderSchema` 等旧结构从主快照依赖中移除

完成标准：

- frontend / backend 主路径继续只消费 runtime-first types
- shared 中新增字段优先服务 runtime-first，而不是补 legacy 旁路

## 阶段 3：后端 runtime engine 重构

状态：主路径完成，legacy 收口待做

已完成：

- `app.ts` 主入口已经接到 `runtime/sessionRuntimeService`
- `runtime/contentRegistry`、`runtime/engineRegistry`、`runtime/sessionRuntimeService`、`runtime/legacyAdapter` 已落地
- 当前 3 个任务已经共享 `triangle-trig` engine plugin
- `startPractice` / `restorePractice` / `runtime-action` / `finishPractice` 已走 runtime-first pipeline
- 旧 session 失效已有显式 `LEGACY_SESSION_EXPIRED` 语义

剩余工作：

- 继续收缩旧 `practiceService.ts` 中仍残留的旧练习主流程逻辑
- 让 `submitAnswer` 只保留 adapter 角色，不再和另一套主流程并存
- 补齐 runtime-action 与 legacy adapter 的回归测试

完成标准：

- 新 session 全量走 runtime-first pipeline
- 旧练习主流程不再与 runtime 主流程双向演进
- `practiceService.ts` 最终只保留结果/历史等必要职责，或被进一步拆解

## 阶段 4：前端 runtime host 重构

状态：主路径完成，组件拆层待做

已完成：

- `PracticePage` 主路径已经不再依赖 legacy `Problem`
- `ExerciseRuntimeHost` 主路径已经去掉 `problem.type` 分支
- `renderers.tsx` 已退出主页面依赖
- 当前 3 类任务都能由 runtime spec 驱动

剩余工作：

- 把当前 `ExerciseRuntimeHost` 中的 `TriangleScene` 继续拆成目标对象层
- 把三角形专用渲染从 project-level host 下沉到 feature-level object library
- 补齐 runtime-action 的清空、恢复、反馈同步等前端回归校验

目标对象层仍保持为：

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

说明：

- 当前代码已经实现“runtime-first 主路径”
- 但还没有完成“通用对象层 fully extracted”的目标态
- 现有 `TriangleScene` 应视为过渡实现，而不是新的最终架构

## 阶段 5：当前 3 个任务迁移

状态：已跑通，验收补齐中

已完成：

- `meaning`、`ratioToSide`、`guidedSolve` 已通过统一 runtime pipeline 跑通
- 三者共享同一个 `triangle-trig` plugin
- 内容差异已经主要落到 scene / flow / guide / feedback 与 engine state

剩余工作：

- 补齐“新增第 4 个同引擎任务时不改 `PracticePage`”的复用性验证
- 补齐 ordered selection、scene anchor 输入、guidedSolve 多步推进、final formula、restore flow 的测试
- 检查当前 scene DSL 是否过早携带过多三角形特化布局假设

完成标准：

- 三类任务差异只体现在 task/content/engine state，不回到页面结构分支
- 新增同引擎任务时，无需再为页面或主服务新开分支

## 阶段 6：legacy 收口

状态：未完成

剩余工作：

- 清理主路径对 `legacy.problems`、`ProblemRenderSchema`、`Problem + AnswerPayload` 的最终依赖
- 清理或归档未接线的 `HomePage.tsx` 等遗留文件
- 收拢 legacy-only renderer / service / adapter 代码
- 仅保留必要的 `submitAnswer` adapter 与历史结果兼容逻辑

删除条件：

- runtime-first 前端主路径稳定
- runtime-first 后端主路径稳定
- 当前 3 个任务迁移验收通过
- 关键回归测试通过

## 测试与验收

需要重点覆盖：

- 路由与 docs 一致性：`WorkspaceShell -> overview / practice / result`
- `startPractice` / `restorePractice` / `runtime-action` / `finishPractice`
- legacy `answer` adapter 与 runtime-action 的行为一致性
- 练习页“左侧唯一操作区、右侧只读引导区”约束
- 清空、错误反馈、恢复 session、完成整组后的完整流转

## 风险与检查点

高风险点：

- 把当前 `TriangleScene` 误判为最终架构，导致对象层拆分停滞
- 旧 `practiceService.ts` 继续承载新的练习主逻辑
- 因为 `wxapp/` 有并行改动，误判 `web/` runtime-first 主线已经全部收口

每次继续推进前都要检查：

- 这一步是在强化 runtime-first，还是在给 legacy 再包一层
- 新逻辑有没有重新塞回 page / old service / shared special fields
- docs 记录的是当前事实、目标态，还是把两者混写到一起
