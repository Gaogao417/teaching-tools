# Test Plan

## Summary

测试需要同时覆盖：

- 文档与路径完整性
- 在线 runtime 主路径
- 离线 authoring schema 与校验边界

## Documentation Checks

- 根 `README.md`、`docs/README.md`、`web/README.md` 三者分工清晰
- 不再存在 `web/docs/` 的主文档引用
- 不再存在 `wxapp` / 小程序作为当前产品真相源的表述

## Online Runtime Checks

- `startPractice`
- `restorePractice`
- `runtime-action`
- `finishPractice`
- 结果页与历史查询

## Scenario Bank Readiness Checks

在正式引入题库前，至少需要为以下对象建立 schema 级验证：

- `ScenarioRecord`
- `ScenarioValidationReport`
- `AuthoringRun`

## Authoring Pipeline Checks

后续 Python / Wolfram 接入后，应覆盖：

- 候选题 schema 校验
- deterministic validation
- Wolfram 数学校验
- approved scenario 写入题库

## Regression Rules

- 新增 shared 字段后，同步更新 `docs/03` 与 `docs/04`
- 新增题型后，验证它是否仍落在统一 runtime host 内
- 引入 Scenario Bank 后，frontend 契约不得额外暴露 authoring 细节
