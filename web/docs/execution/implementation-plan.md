# Runtime-First Refactor Implementation Plan

## 摘要

当前 `web/` 主线已经完成 runtime-first 接线：

- 前端主路由固定为 `WorkspaceShell -> TaskOverviewPanel / PracticePage / ResultPage`
- 练习主路径固定消费 `PracticeSessionSnapshot + ExerciseRuntimeSpec`
- 后端主入口固定为 `sessionRuntimeService`

因此，本计划的重点不再是“把 runtime-first 接上”，而是完成最后的收口：

- 同步文档与当前 `WorkspaceShell` 信息架构
- 把 runtime host 明确拆成对象层组件
- 冻结并隔离 legacy 兼容面
- 为主路径补齐自动化验证

## 当前基线

当前 `web` 主路径可以概括为：

```text
Routes
  -> WorkspaceShell
    -> TaskOverviewPanel (/)
    -> PracticePage (/practice/:taskId)
      -> ExerciseRuntimeHost
        -> WorkspaceScene
        -> GuidePanel
        -> FeedbackController
    -> ResultPage (/result/:sessionId)
```

其中：

- `WorkspaceShell` 负责共享导航、学生身份、任务预览和 focused task context
- `PracticePage` 负责 session 启动/恢复、计时、题间推进、完成流转和页面级反馈
- `ExerciseRuntimeHost` 负责把 runtime 分发给左侧工作区与右侧引导区
- `resultsService` 负责结果快照和历史查询

## 固定边界

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
- legacy 兼容层允许存在，但不再作为新实现主路径

## 执行阶段

### 阶段 1：文档同步

已完成：

- `02-system-architecture.md`、`features/home.md`、`features/practice.md`、`features/result.md` 已按 `WorkspaceShell` 嵌套路由对齐
- 当前事实与目标态已分开描述

验收标准：

- 文档不再把 home / practice / result 写成彼此隔离的页面体系
- 文档明确 `TriangleScene` 只是过渡对象，不是最终架构终点

### 阶段 2：共享契约冻结

已完成：

- runtime-first 主契约固定为 `ExerciseRuntimeSpec`、`PracticeSessionSnapshot`、`RuntimeActionEvent`、`RuntimeActionResponse`
- legacy 契约降级为兼容面

剩余约束：

- 新字段优先服务 runtime-first
- `legacy.problems`、`ProblemRenderSchema`、`AnswerPayload` 只允许 adapter 继续消费

### 阶段 3：后端收口

已完成：

- `app.ts` 主入口已经接到 `runtime/sessionRuntimeService`
- 结果与历史查询已从旧 `practiceService.ts` 拆到 `resultsService.ts`
- `submitAnswer` 只保留 legacy adapter 角色

完成标准：

- 新 session 全量走 runtime-first pipeline
- 结果/历史查询与运行时主流程分离
- 旧练习主流程不再存在于运行路径中

### 阶段 4：前端对象层拆分

已完成：

- `ExerciseRuntimeHost` 已按 `WorkspaceScene / GuidePanel / FeedbackController` 拆分
- 左侧工作区已分出 `SceneRenderer / InteractionZoneLayer / InputAnchorLayer / OverlayLayer`
- 未接线的 `HomePage.tsx`、`renderers.tsx`、`TriangleStage.tsx` 已删除

剩余约束：

- `PracticePage` 不能重新依赖 `problem.type`
- `SceneRenderer` 只允许按 `sceneKind` / `entity.kind` 分发

### 阶段 5：自动化验证

已完成：

- 后端新增 `node:test` + `tsx` 测试入口
- 覆盖 runtime-action 主路径、legacy adapter、结果持久化、历史查询、legacy session 失效

完成标准：

- `startPractice` / `restorePractice` / `runtime-action` / `finishPractice` 可自动回归
- `/api/practice/answer` 明确只验证 adapter 行为，不再验证第二套主流程

## 测试与验收

需要持续覆盖：

- 路由与 docs 一致性：`WorkspaceShell -> overview / practice / result`
- `startPractice` / `restorePractice` / `runtime-action` / `finishPractice`
- legacy `answer` adapter 与 runtime pipeline 的一致性
- “左侧唯一操作区、右侧只读引导区”约束
- 清空、错误反馈、恢复 session、完成整组后的完整流转

## 风险与检查点

高风险点：

- 把当前 `TriangleScene` 或 `WorkspaceScene` 的实现细节误判为最终 DSL
- 让 legacy 类型重新回流进前端主路径
- 在结果/历史之外重新长出第二套服务入口

每次继续推进前都要检查：

- 这一步是在强化 runtime-first，还是在给 legacy 再包一层
- 新逻辑有没有重新塞回 page / shared special fields / compat renderer
- 文档记录的是当前事实还是目标态，是否混写
