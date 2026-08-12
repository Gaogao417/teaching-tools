# System Architecture

## Summary

当前项目需要同时维护两条链路：

```text
Offline Authoring Pipeline
  Skill / CLI -> Generator -> deterministic / mathematical validation
    -> AuthoringRun + ValidationReport -> approval -> Scenario Bank

Online Student Runtime
  TaskDefinition + ContentDefinition -> approved-only ScenarioSelector
    -> ExercisePlan Projector
       ├─ Learn / Practice: reviewed local truth -> Frontend Action Runtime
       │    -> local completion -> async TrainingResult
       └─ Assessment: safe public plan -> Evidence -> Private Evaluator
```

这两条链路共享的是“题型契约与题目 schema”，但运行职责完全不同。

## Architecture Goals

- 在线做题链路保持 runtime-first
- 离线出题链路独立于学生请求
- 题库记录与 runtime 投影分离
- backend 成为 Scenario Bank 与 frontend 之间的唯一桥梁
- 新 session 只使用 approved scenario；已有 session 固定原 scenario version
- 数学真值按 mode 投影：Learn/Practice 接收审核过的 local truth；Assessment 私有真值绝不进入 frontend

## Two Pipelines

### 1. Offline Authoring Pipeline

职责：

- 调用 AI 或脚本批量生成候选题
- 用 Python 进行结构化清洗、归一化与规则过滤
- 用 Wolfram 做数学校验
- 产出可入库的 `ScenarioRecord`

特点：

- 不服务学生实时请求
- 允许长时间批处理
- 关注可复现、可追踪、可审核

### 2. Online Student Runtime

职责：

- 接收学生进入任务、恢复 session、同步训练记录或提交 Assessment evidence
- 从题库中选择已批准 scenario
- 基于 mode 投影 versioned `ExercisePlan`
- Practice 在 frontend 本地判定并推进；backend 异步保存训练记录和进度
- Assessment 在 backend 判题、推进权威步骤并保存结果

特点：

- 响应式、低延迟
- 不现场生成题目
- 不现场调用 Wolfram 出题

## Core Boundaries

### TaskDefinition

`TaskDefinition` 是任务目录与入口层，只负责：

- 任务 id
- 标题、摘要、难度
- `engineKind`
- `contentId`
- 首页展示信息

它不负责：

- 单道题内容
- 判题
- session 状态推进

### ContentDefinition

`ContentDefinition` 是运行时模板层，只负责：

- prompt / scene / flow / guide / feedback 模板
- 题型级默认配置
- engine 所需的静态模板信息

它不负责：

- 具体题库记录
- 离线 authoring 结果
- AI 生成规则

### Scenario Bank

`Scenario Bank` 是离线 authoring 产物层，负责存储：

- 单道题的题面与变量
- 标准中间答案
- 最终答案
- 校验报告与来源元数据

它不负责：

- 前端渲染逻辑
- session 生命周期
- 页面交互状态

approved 不是“成功导入”的别名。候选题必须有与其版本匹配的校验报告，并经过显式审批，才可进入新 session 的候选集合。

### Scenario Selector

`Scenario Selector` 是 backend port，负责：

- 只从 `status = approved` 的记录中选择
- 同时校验 `taskId`、`engineKind`、`contentId`
- 为 session 固定 `scenarioId + scenarioVersion`
- 在没有合格题目时返回明确错误

它不负责生成、校验或审批题目，也不能在恢复旧 session 时重新选题。

### EnginePlugin

`EnginePlugin` / Action plan projector 只存在于 backend，负责：

- 把模板与 scenario 投影成 runtime instance
- 为 Learn/Practice 投影经审核的公开 local truth
- 为 Assessment 投影不含答案的 public plan，并对 Assessment evidence 做权威判定
- 组装 versioned `ExercisePlan`；legacy engine 继续为 pinned session 组装 `ExerciseRuntimeSpec`

engine 可以读取完整 answer key 和 validation-backed truth。Learn/Practice 只接收完成本地演示/训练所需的
审核真值；Assessment 不接收答案键、accepted answers、expected values 或等价可推导字段。validation
report 与 authoring metadata 在所有模式都不属于在线 plan。

## Current State vs Next Step

### Current Implemented State

当前在线 runtime 已经具备：

- `TaskDefinition -> ContentDefinition -> EnginePlugin -> ExerciseRuntimeSpec`
- 多引擎注册与统一 runtime host
- Web 前端统一 session / action / feedback 流程

### 本轮实现差距

下一阶段要补齐：

- `Scenario Bank`
- backend `Scenario Selector`
- Python / Wolfram authoring pipeline
- public runtime projection 与 private truth 的类型隔离
- 旧 topic session 的 version pinning 与兼容读取

也就是说，当前代码主路径已经是 runtime-first；接下来不是再发明第二套 runtime，而是把“题目来源”从内置模板实例进一步升级为“离线入库 scenario”。

## Backend Responsibilities

- 读取 `TaskDefinition` 与 `ContentDefinition`
- 读取或选择 approved `ScenarioRecord`
- 通过 `engineKind` 路由到对应 `EnginePlugin`
- 管理 session、runtime state、result snapshot
- 保存 scenario id/version；恢复时解析固定版本而不是重新选择
- 接收 Practice 的 versioned TrainingCheckpoint/TrainingResult，更新历史、趋势与熟练度但不重判数学正确性
- 仅对 Assessment/Challenge evidence 运行 private evaluator

## Frontend Responsibilities

- 消费 versioned `ExercisePlan`
- 管理本地 Action draft、Practice local guard、world、attempt recorder 和 Action timer
- 异步排队 TrainingCheckpoint/TrainingResult；Assessment 才提交待权威判定的 evidence
- 渲染工作区、引导区、反馈层与结果页

## Hard Constraints

- frontend 不直接读取题库
- frontend 不知道 Python / Wolfram 细节
- 在线 API 不暴露离线 authoring 内部流程
- `Scenario Bank` 不能退化成“前端直接读的一堆页面字段”
- Assessment frontend 不接收 answer key、accepted answers 或其他可用于提前判题的真值
- Learn/Practice 只能接收 approved scenario 投影出的、当前 exercise 所需的 reviewed local truth
- Practice 客户端记录不能作为可信 Assessment 成绩；需要权威结论必须进入 Assessment
- draft/validated/rejected scenario 不得作为“无 approved 数据”时的回退

## Current Engine Reality

当前代码已经存在多种 engine：

- `triangle-trig`
- `demo-counter`
- `angle-equation`
- `coordinate-isosceles-right`

主文档必须以“多引擎统一 runtime”为前提，而不是继续按最早 3 个 trig 任务写死。

## Frontend Presentation Layer Evolution

当前前端展示层是“一个题型一套手写 SVG”：`SceneRenderer.tsx` 硬编码 `sceneKind` 分支，
`WorkspaceScene.tsx` 按题型内联渲染，`AngleEquationWorkspace.tsx` 自行解析 scene JSON。
这套手写 SVG 是过渡态。

新 engine 的前端展示层采用 geometry-actions 架构（POC 已验证，见
[ADR-002](./adr/ADR-002-geometry-actions-architecture.md)）：

- `Action` 状态机表达交互语义（不依赖 React / JSXGraph）
- 通用 `Runtime` 驱动 Action 序列（零业务 switch）
- `WorldState` 只存纯数学依赖，不持渲染对象
- `GeometryCanvas` 通过 JSXGraph adapter 投影 WorldState，`GeometryEvent` 转发回 Runtime

这套架构是 ADR-001 的**分层演进**，不是替换：

- backend 仍是 scenario/version 与 Assessment 私有真值的权威；Practice 数学正确性按 ADR-006 移到
  frontend local-training guard
- 前端展示层从手写 SVG 迁移到 Action + WorldState + JSXGraph
- approved-only scenario、version pinning 和 Assessment truth isolation 全部保留

现有 SVG renderer 保留至对应 engine 迁移完成。后续 triangle-trig /
coordinate-isosceles-right / angle-equation 的前端展示层重写按 ADR-002 的路径推进，
后端 `EnginePlugin` 继续服务 Assessment 与 pinned legacy session；Practice 新 session 按 ADR-006 逐步切到
本地 Action training path。

Practice/Assessment 的最新 mode boundary 见
[ADR-006](./adr/ADR-006-local-practice-training-runtime.md)；迁移期 pinned legacy session 继续走原
`ExerciseRuntimeSpec -> RuntimeActionEvent -> EnginePlugin` compatibility path。
