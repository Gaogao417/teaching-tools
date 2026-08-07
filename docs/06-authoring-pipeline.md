# Authoring Pipeline

## Summary

离线 authoring pipeline 负责把“候选题”变成“已批准题库题目”。

它不是学生在线做题链路的一部分。

目标流水线：

```text
Skill / Codex CLI
  -> Python generator
  -> deterministic validation
  -> Wolfram validation
  -> ScenarioValidationReport
  -> explicit approval
  -> Scenario Bank
```

## Responsibilities

### Skill / CLI

职责：

- 组织批处理流程
- 调用 Codex CLI 或其他生成工具
- 统一输入输出目录
- 汇总成功与失败结果

不负责：

- 作为题库真值来源
- 直接决定前端如何渲染

### Python Generator

职责：

- 生成候选题
- 归一化 AI 输出
- 检查 schema
- 调用本地规则过滤
- 写入 `ScenarioRecord`

生成器只写 candidate，不直接授予 approved 状态。

### Deterministic Validation

职责：

- 校验字段完整性
- 校验题型约束
- 校验答案表达是否落在系统支持范围内
- 过滤掉不适合作为产品题目的候选题

### Wolfram Validation

职责：

- 对数学真值做兜底校验
- 验证题面与答案键是否自洽
- 生成可追溯的校验摘要

不负责：

- 决定题目是否“教学上优质”
- 决定前端步骤文案

## Scenario Bank

`Scenario Bank` 存的是已批准 scenario，而不是 AI 原始输出。

每条记录至少应包含：

- 归属 `taskId`
- 归属 `engineKind`
- 归属 `contentId`
- 题面变量
- 中间答案键
- 最终答案键
- 校验状态
- 来源元数据
- record version 与 authoring run id
- 供 engine 投影的 prompt data（仍需 frontend allowlist）
- 只供 backend engine 使用的 answer key

每个 approved record 必须存在同 `scenarioId + scenarioVersion` 的通过报告，并可追溯到完成状态的 `AuthoringRun`。发布采用完整 bank 的原子切换；失败 run 不覆盖上一次可用 bank。

## Boundary With Online Runtime

在线 runtime 只做这些事：

- 按任务选择 approved scenario
- 将 scenario 投影为 runtime
- 接收学生动作并判题

选择器同时校验 task、content 和 engine。已有 session 使用固定 scenario version 恢复，不参与重新选择；未完成题目的 answer key 不进入 frontend runtime payload。

在线 runtime 不做这些事：

- 现场调用 AI 出题
- 现场调用 Wolfram 生成题目
- 审批 scenario

## Recommended Implementation Order

1. 定义 `ScenarioRecord`、`ScenarioValidationReport`、`AuthoringRun` schema
2. 分离 prompt data、private answer key 与 public runtime projection
3. 写生成、归一化和 deterministic validation
4. 接入 Wolfram validation adapter
5. 通过显式审批发布版本化 bank
6. 在 backend 中新增 approved-only `Scenario Selector`
7. 迁移六个已有 topic，并验证旧 session version pinning

## Current Status

当前仓库已经具备在线 runtime 主路径。

本文件记录的是下一阶段 authoring pipeline 的明确边界，供后续 Python / Wolfram 实现落地使用。

`auxiliaryTwoRatios` 当前体验规格仍是 draft；pipeline 可以迁移其现有 50 条数据，但不能借数据迁移实现草案交互。
