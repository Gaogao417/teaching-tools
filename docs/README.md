# Project Docs

本目录是当前仓库唯一有效的项目文档入口。

这里管理的是整个项目的真相源，而不只是 `web/` 目录下的局部设计说明。当前项目需要同时讲清楚两条链路：

- 在线链路：学生使用 Web 应用做题
- 离线链路：内部使用 skill / CLI / Python / Wolfram 生成、校验并入库题目

## Reading Order

1. `01-product-spec.md`
2. `02-system-architecture.md`
3. `03-domain-model.md`
4. `04-api-contracts.md`
5. `05-interaction-model.md`
6. `06-authoring-pipeline.md`
7. `features/`
8. `execution/`
9. `adr/`

## Document Map

- `01-product-spec.md`
  产品范围、用户、目标、非目标
- `02-system-architecture.md`
  离线 authoring 与在线 runtime 的系统边界
- `03-domain-model.md`
  题库、模板、运行时、session、结果等核心模型
- `04-api-contracts.md`
  学生做题时使用的在线 API 契约
- `05-interaction-model.md`
  Web 做题运行时的统一交互原则
- `06-authoring-pipeline.md`
  离线出题、校验、入库流水线
- `features/`
  页面或功能级职责说明
- `execution/`
  实施顺序、测试计划、迁移重点
- `adr/`
  关键架构决策记录
- `prd/teacher-directed-learning-system/`
  教师诊断驱动的学生复习、作业编排与基础技能训练草案
- `prd/action-driven-learning-workspace/`
  backend 教学计划、frontend Action Runtime、AI Coach 与统一页面工具的目标产品规格
- `execution/action-driven-workspace-migration-plan.md`
  从 `ExerciseRuntimeSpec`/primitive switch 迁移到 versioned ExercisePlan 与 typed evidence 的实施路线
- `adr/ADR-005-action-presentation-and-conversational-media.md`
  Action transient emphasis、固定朗读、普通 Coach 与全双工语音的分层边界
- `execution/action-presentation-voice-issue-inventory.md`
  当前 Presentation/Voice 实现的问题分级与保留决策
- `execution/action-presentation-voice-migration-plan.md`
  分阶段迁移、并行 worktree 所有权、提交顺序与回滚门禁

## Writing Rules

- 一份文档只回答一个主问题
- `docs/` 记录项目级真相，不记录临时讨论过程
- 在线运行时与离线出题链路必须分开描述，避免职责混写
- `shared/contracts.ts` 的变更，至少同步更新 `03-domain-model.md` 与 `04-api-contracts.md`
- 如果架构边界发生变化，优先写 ADR，再回写主文档
- 新题型接入时，先更新架构与模型文档，再补 feature 文档

## Current Defaults

- 项目当前只维护 Web 学生端
- 离线 authoring pipeline 属于内部生产工具，不暴露给学生端
- `TaskDefinition`、`ContentDefinition`、`EnginePlugin` 仍是当前在线 runtime 的核心边界
- 下一阶段要补齐的关键层是 `Scenario Bank`，用来承接 Python/Wolfram 离线出题结果
- Action Runtime v2 已用于新建 Topic session；已有 pinned v1 session 继续兼容读取，边界见 ADR-004
