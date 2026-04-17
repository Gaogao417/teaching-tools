# Implementation Plan

## Summary

当前仓库下一阶段的主线，不再是继续做 runtime-first 大重构，而是把项目叙事与工程边界整理成稳定形态：

- 仓库收口为 Web-only
- `docs/` 成为根目录唯一文档入口
- 在线 runtime 与离线 authoring pipeline 明确分层
- 后续逐步引入 Scenario Bank

## Phase 1: Repo Cleanup

- 删除 `wxapp/`
- 将 `web/docs/` 提升为根 `docs/`
- 清理 README、CLAUDE、文档中的旧路径引用

完成标准：

- 根目录不再把项目描述成 Web + 小程序双线
- 所有主文档都从根 `docs/` 进入

## Phase 2: Documentation Realignment

- 更新产品文档为 Web runtime + offline authoring 双链路
- 明确 `ContentDefinition` 不是题库单题
- 新增 authoring pipeline 文档
- 补充 Scenario Bank 相关模型

完成标准：

- 文档能清楚回答“Python 出题侧、backend、frontend 如何分工”
- 文档不再把题库、模板、runtime 混写

## Phase 3: Scenario Bank Introduction

- 设计 `ScenarioRecord`
- 设计 `ScenarioValidationReport`
- 设计 backend `Scenario Selector`
- 明确 approved scenario 如何进入在线 session

完成标准：

- 在线 runtime 可以在不改 frontend 契约的前提下切到 bank-backed source

## Phase 4: Authoring Toolchain

- Python 生成候选题
- Python 归一化并做 deterministic validation
- 接入 Wolfram session 进行数学真值校验
- 写入题库

完成标准：

- 题库记录来源可追溯
- authoring 与 serving 两条链路彻底分离

## Risks

- 如果继续把 `ContentDefinition` 当题库存储层，后续会混乱
- 如果让 frontend 感知 authoring 细节，会破坏边界
- 如果把离线 pipeline 直接暴露成在线 API，会让运行时复杂度失控
