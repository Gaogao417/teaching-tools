# ADR-002 Offline Authoring / Online Runtime Split

## Background

随着题型增加，项目不再只有“在线做题页面”这一条链路。

现在还需要一条内部内容生产链路，用于：

- 批量生成候选题
- 调用 Wolfram 做数学校验
- 将题目写入题库

如果不把这条链路与学生运行时分开，容易出现：

- frontend 感知题库内部细节
- backend 同时承担 serving 与 authoring 的混杂职责
- `ContentDefinition` 被误当成题库单题存储层

## Decision

项目明确采用“两条链路、一个共享 schema 边界”的结构：

- Offline authoring pipeline
  - Skill / CLI
  - Python generator
  - Wolfram validator
  - Scenario Bank
- Online student runtime
  - TS backend
  - TS frontend
  - runtime-first contract

backend 是 Scenario Bank 与 frontend 之间的唯一桥梁。

## Consequences

- frontend 不需要知道 Python 或 Wolfram 的存在
- 在线 API 不暴露 authoring 细节
- 题库记录可以独立演进而不破坏 runtime 契约
- 后续可以单独演进 authoring pipeline，而不影响学生端主流程

## Rejected Alternatives

### Alternative A: 在线做题时实时调用 AI / Wolfram

不采用原因：

- 响应不可控
- 成本不可控
- 运行时可靠性差

### Alternative B: frontend 直接读取题库并自行组装题目

不采用原因：

- 泄漏后端规则
- 破坏 runtime-first 边界
- 难以维护与测试
