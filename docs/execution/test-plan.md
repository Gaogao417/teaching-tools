# Scenario Architecture Test Plan

## 测试目标

验证统一 scenario 架构的四条硬约束：只有 approved 内容能创建新 session；题目真值不下发 frontend；旧 session 不被静默换题；六个 topic 的迁移不改变已批准的在线行为。

## 1. Schema 与状态机

- `ScenarioRecord`、`ScenarioValidationReport`、`AuthoringRun` 的合法 fixture 可解析，缺少版本、来源、状态或关联 id 的 fixture 被拒绝。
- 只允许 `draft -> validated -> approved` 及显式 rejection 路径；解析成功不能自动视为 approved。
- report 的 scenario version、run id 或必需 check 不匹配时不能批准。
- approved record 更新内容必须产生新 version，不能原地覆盖。

## 2. Authoring Pipeline

- 六个源 bank 的输入数分别对账为 30/50/50/50/50/50，总计 280。
- 同输入、同工具版本重复运行，除 run metadata 外产物语义一致。
- schema、domain/math、asset 任一关键检查失败都会生成可读报告，并从 approved 输出排除。
- authoring run 正确汇总 candidate/validated/approved/rejected 数量；中途失败不覆盖上一次可用 bank。
- `nestedSimilarity` 的 `convert-collinear` 已存在于产物，不由 online read path 临时修改。
- `auxiliaryTwoRatios` 迁移前后行为 snapshot 一致；不得出现 draft 体验规格的新步骤、布局或 coaching 字段。

## 3. Approved-only Selector

为每个 topic 构造 approved、validated、draft、rejected、版本不匹配、task/content/engine 不匹配记录：

- selector 只可能返回 approved 且三类归属完全匹配的记录。
- 无 approved 候选时返回稳定错误，不回退到其他状态或内置样例。
- 固定 seed/index 的选择结果确定；并发 session 不共享可变隐式游标。
- retired/legacy 版本可供 pinned session 恢复，但不会进入新 session。

## 4. Runtime 真值隔离

对 Learn、Practice start/restore/action 和未完成 snapshot 做递归字段断言：

- 不出现 `answerKey`、`acceptedAnswers`、作为标准答案的 `expectedLatex`、validation report 或 authoring run 内部信息。
- frontend 所需的 scene、allowed actions、public labels、当前状态仍完整。
- wrong/correct evaluation 由 backend 决定；修改 frontend draft 不能伪造完成状态。
- Review 只在动作已判定或 session 完成后返回面向学生的 expected/actual projection，不复用未完成题的私有 answer key DTO。

## 5. Session 兼容矩阵

| Fixture | 预期 |
| --- | --- |
| 当前 v1 topic state，仅含 `scenarioId` | 映射到兼容 version，保留题号/步骤/已完成步骤 |
| 当前 schema v2 session | 按原 instance/state 恢复，不重新 selector |
| 新 session，含 `scenarioId + scenarioVersion` | bank 更新后仍固定原版本 |
| pinned scenario 已不再 approved | 旧 session 可恢复，新 session 不会选择它 |
| 无法映射的 legacy scenario | 返回 `LEGACY_SESSION_EXPIRED`，不静默换题 |
| 已完成 result | Review 从不可变快照读取，不依赖当前 bank 重判 |

## 6. 六 Topic 回归矩阵

每个 topic 至少覆盖第一题、中间题、最后一题和一个诊断分支：

| Topic | Start | 正确/错误 action | Restore | Finish/Review | 数据对账 |
| --- | --- | --- | --- | --- | --- |
| `quadraticCompletion` | [x] | [x] | [x] | [x] | [x] |
| `parallelLineRatios` | [x] | [x] | [x] | [x] | [x] |
| `auxiliaryTwoRatios` | [x] | [x] | [x] | [x] | [x] |
| `reverseASimilarity` | [x] | [x] | [x] | [x] | [x] |
| `nestedSimilarity` | [x] | [x] | [x] | [x] | [x] |
| `butterflySimilarity` | [x] | [x] | [x] | [x] | [x] |

额外断言：资源路径有效、step id 唯一、next step 引用存在、accepted answer 只在 backend validator/engine 可见、原 stable scenario id 可追溯。

## 7. API 与构建回归

- `GET /api/learn/:taskId`
- `POST /api/practice/start`
- `GET /api/practice/session/:sessionId`
- `POST /api/practice/runtime-action`
- `POST /api/practice/finish`
- `GET /api/practice/result/:sessionId`
- `GET /api/task-history/:taskId`
- shared、backend、frontend 类型检查与 build
- authoring importer 全量运行、schema validation、determinism diff
- `git diff --check`

## 发布门禁

以下任一条件失败时不能切换默认 bank：

- 任一新 session 可选中非 approved record。
- 任一未完成 runtime payload 暴露私有真值。
- 六个 topic 任一题量、stable id 或来源对账失败。
- 可兼容旧 session 被换题、丢步骤或重新判定。
- `auxiliaryTwoRatios` 出现未经批准的交互行为变更。
- 全量 bank 不是由完成状态的 `AuthoringRun` 和匹配的 validation reports 生成。
