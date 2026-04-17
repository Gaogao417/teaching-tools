# System Architecture

## Summary

当前项目需要同时维护两条链路：

```text
Offline Authoring Pipeline
  Skill / CLI -> Python Generator -> Wolfram Validator -> Scenario Bank

Online Student Runtime
  TaskDefinition -> ContentDefinition -> EnginePlugin -> ExerciseRuntimeSpec
    -> Frontend Runtime Host -> RuntimeActionEvent -> EnginePlugin
```

这两条链路共享的是“题型契约与题目 schema”，但运行职责完全不同。

## Architecture Goals

- 在线做题链路保持 runtime-first
- 离线出题链路独立于学生请求
- 题库记录与 runtime 投影分离
- backend 成为 Scenario Bank 与 frontend 之间的唯一桥梁

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

- 接收学生进入任务、恢复 session、提交动作
- 从题库中选择已批准 scenario
- 基于引擎和模板投影出 `ExerciseRuntimeSpec`
- 判题、推进步骤、保存结果

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

### EnginePlugin

`EnginePlugin` 只存在于 backend，负责：

- 把模板与 scenario 投影成 runtime instance
- 接收学生动作并做判定
- 推进步骤状态
- 组装 `ExerciseRuntimeSpec`

## Current State vs Next Step

### Current Implemented State

当前在线 runtime 已经具备：

- `TaskDefinition -> ContentDefinition -> EnginePlugin -> ExerciseRuntimeSpec`
- 多引擎注册与统一 runtime host
- Web 前端统一 session / action / feedback 流程

### Next Step

下一阶段要补齐：

- `Scenario Bank`
- backend `Scenario Selector`
- Python / Wolfram authoring pipeline

也就是说，当前代码主路径已经是 runtime-first；接下来不是再发明第二套 runtime，而是把“题目来源”从内置模板实例进一步升级为“离线入库 scenario”。

## Backend Responsibilities

- 读取 `TaskDefinition` 与 `ContentDefinition`
- 读取或选择 approved `ScenarioRecord`
- 通过 `engineKind` 路由到对应 `EnginePlugin`
- 管理 session、runtime state、result snapshot

## Frontend Responsibilities

- 消费 `ExerciseRuntimeSpec`
- 管理本地 draft state
- 提交 `RuntimeActionEvent`
- 渲染工作区、引导区、反馈层与结果页

## Hard Constraints

- frontend 不直接读取题库
- frontend 不知道 Python / Wolfram 细节
- 在线 API 不暴露离线 authoring 内部流程
- `Scenario Bank` 不能退化成“前端直接读的一堆页面字段”

## Current Engine Reality

当前代码已经存在多种 engine：

- `triangle-trig`
- `demo-counter`
- `angle-equation`
- `coordinate-isosceles-right`

主文档必须以“多引擎统一 runtime”为前提，而不是继续按最早 3 个 trig 任务写死。
