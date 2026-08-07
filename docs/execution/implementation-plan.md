# Scenario Architecture Implementation Plan

## 本轮目标

把当前 `topic-scenario-bundle/v1` 的专题数据升级为统一的离线 authoring / 在线 runtime 架构，并在不改变学生在线 API 的前提下完成六个已有 topic 的数据迁移。

本轮完成后，主链路应为：

```text
final explanation + ready bank
  -> importer / validator
  -> AuthoringRun + ScenarioRecord + ScenarioValidationReport
  -> approved Scenario Bank
  -> approved-only ScenarioSelector
  -> EnginePlugin private truth
  -> ExerciseRuntimeSpec safe projection
```

范围内 topic：

- `quadraticCompletion`（当前 30 道）
- `parallelLineRatios`（当前 50 道）
- `auxiliaryTwoRatios`（当前 50 道）
- `reverseASimilarity`（当前 50 道）
- `nestedSimilarity`（当前 50 道）
- `butterflySimilarity`（当前 50 道）

`auxiliaryTwoRatios` 的 `topic-experience-spec.md` 仍为 `draft`。本轮只迁移它已有的题目、真值、来源和校验元数据，不实现该草案描述的新交互、页面布局、陪练话术或状态转换；这些内容仍须经过专题体验规格的显式批准门禁。

## 当前基线与必须关闭的差距

| 能力 | 当前状态 | 本轮目标 |
| --- | --- | --- |
| 专题数据 | 单一 `topic-scenario-bundle/v1`，题面、交互和答案字段混在 `TopicScenarioRecord` | 迁移为版本化 `ScenarioRecord`，明确 prompt data、private answer key 与 public projection |
| 校验证据 | importer 直接生成 bundle，没有一等 `ScenarioValidationReport` | 每条 scenario 有可追溯、可机器判定的报告 |
| 批次追踪 | 没有一等 `AuthoringRun` | 每次导入记录来源版本、工具版本、统计和产物摘要 |
| 在线选择 | 按数组下标轮转，不检查状态 | selector 只返回与 task/content/engine 匹配的 `approved` 版本 |
| 真值边界 | `acceptedAnswers`、`expectedLatex` 等随 topic workspace contract 下发 | answer key 与判定规则只保留在 backend engine context |
| session 恢复 | state 保存 `scenarioId`，依赖当前 bundle 能继续找到该 id | session 固定 scenario id + version；新旧 state 均可恢复或得到显式兼容错误 |

## 完成度图例

- `[x]` 已在本轮开始前具备或已完成
- `[ ]` 本轮待实现
- `[~]` 明确延期，不计入本轮完成度

## Phase 0 — 冻结契约与迁移基线

- [x] 在线 runtime-first 主路径、统一 engine registry、session/action/result 已存在。
- [x] 六个 topic 及其当前题目数量已盘点：总计 280 道。
- [x] 在 shared/backend 中落地同一套版本化 schema：`ScenarioRecord`、`ScenarioValidationReport`、`AuthoringRun`。
- [x] 定义 allowlisted public projection 与 backend-only answer key，禁止用完整 record 或同一个宽类型跨边界复用。
- [x] 为旧 `TopicScenarioRecord` fixture 增加一次性迁移入口；迁移器幂等，并保留原 id、题号、来源路径和资源路径。

完成标准：schema 能独立表达记录状态、版本、来源、校验证据和私有答案键；迁移前后的题量及 stable id 有自动化对账。

## Phase 1 — 离线 authoring 领域对象

### `ScenarioRecord`

- [x] 最少包含 `id`、`version`、`taskId`、`engineKind`、`contentId`、`status`、`promptData`、`answerKey`、`metadata.authoringRunId` 和时间戳。
- [x] `status` 使用受控状态机：`draft -> validated -> approved`，失败进入 `rejected`；只有显式审批动作可进入 `approved`。
- [x] `answerKey` 承载 accepted answers、expected values、判定规则和诊断所需真值，不属于 frontend DTO；`promptData` 经过 allowlist projection。
- [x] approved bank 以新 version 原子发布；已有 session 固定原 record snapshot，不受后续 bank 更新影响。

### `ScenarioValidationReport`

- [x] 关联确定的 `scenarioId + scenarioVersion + authoringRunId`。
- [x] 分层记录 schema、deterministic/domain、asset、mathematical checks；每项有 `name`、`kind`、`passed`、`message` 和可选 evidence。
- [x] 总结论由必需检查确定；缺报告、报告版本不匹配或必需检查失败时不得批准。

### `AuthoringRun`

- [x] 记录 run 状态、输入来源与版本、toolchain version、开始/结束时间、候选/通过/拒绝/批准数量和错误摘要。
- [x] 同一输入与工具版本可以重跑并生成可比较结果；发布使用临时文件原子替换，失败 run 不覆盖上一次 approved 数据。

完成标准：三个对象有 runtime schema validation、TypeScript 类型、合法/非法 fixture 和版本兼容测试。

## Phase 2 — 导入、校验与题库写入

- [x] `authoring/scenario_pipeline.py` 实现“生成/归一化 -> 校验 -> 显式审批 -> 发布”；迁移 importer 保留单命令全量导入能力。
- [x] 新 candidate 必须经过匹配 report 与 reviewer 才能发布；现有 ready bank 以 `reviewed-bank-import` 作为显式迁移审批来源，禁止把“成功解析”等同于 approved。
- [x] 对 task/content/engine 一致性、step id 唯一性、动作引用、资源存在性和答案键完整性做 deterministic checks。
- [~] Wolfram 适配器和 fail-closed 路径已接入；本机 `wolframscript` 未配置 WolframKernel。现有 reviewed topics 明确记录 `not_applicable`，未伪造 Wolfram 通过。
- [x] 生成稳定排序、确定性 JSON；同输入重复运行除时间 metadata 外的语义哈希一致。
- [x] 输出 authoring summary，并在 completed `AuthoringRun` 中记录 280/280/280/0 计数。

完成标准：一次全量 authoring run 可生成 bank、reports 和 run manifest；任一关键 check 失败的记录不会进入 approved 集合。

## Phase 3 — Approved-only Selector 与 backend 真值边界

- [x] 新增独立 `ScenarioSelector` port，输入 `taskId`、`engineKind`、`contentId` 和选择 index，输出 pinned backend record。
- [x] selector 强制 `status === "approved"` 并校验 task/content/engine；无候选返回 `NO_APPROVED_SCENARIO`，不回退其他状态。
- [x] 选择策略由 task/index 确定，不使用可变全局游标。
- [x] `EnginePlugin.createState` 接收平台已选 scenario，各 engine 不再控制在线选择。
- [x] private engine context 与 public `ExerciseRuntimeSpec` 分离；frontend projection 不含 `answerKey`、`acceptedAnswers`、标准答案 `expectedLatex`、validation 或 authoring metadata。
- [x] frontend 所需目标对象、槽位、动作和已完成证据由安全 projection 明确提供；Learn 提交通过 backend action 判定。
- [x] Practice/Learn action 判定、错误诊断和 Review expected/actual projection 均由 backend 完成。

完成标准：API 快照测试证明 runtime payload 不含真值字段；selector 的所有成功结果均为 approved；六个 topic 均通过同一 selector/engine 边界启动。

## Phase 4 — 旧 session 兼容

- [x] 新 session 在 engine state 与 instance snapshot 固定 `scenarioId`、`scenarioVersion` 和 private scenario snapshot。
- [x] `restoreTopicPracticeState` 支持只有 `scenarioId`/`interactionVersion` 的旧 state；恢复不重新 selector。
- [x] 已持久化的 content/instance/result 继续可读；Review 从不可变快照读取。
- [x] retired record 通过 session 内 pinned snapshot 恢复，但不进入新 session selector。
- [x] 无法安全映射的 schema v1 session 返回 `LEGACY_SESSION_EXPIRED`，不静默换题。
- [x] 测试覆盖 legacy state、旧 v2 row、pinned snapshot 和完成 result。

完成标准：可恢复的旧 session 保留当前题号、步骤、已完成步骤和答案判定；不可恢复场景只走显式错误分支。

## Phase 5 — 六个 topic 数据迁移（可并行）

六条迁移流共享 Phase 0–3 的 schema、validator 和 selector，在共享契约稳定后并行执行；每条流独立产出数据 diff、validation summary 和 focused regression。

| Topic | 基线 | 迁移要求 | 本轮状态 |
| --- | ---: | --- | --- |
| `quadraticCompletion` | 30 | 保留配方法步骤、答案别名、来源和 stable id | [x] |
| `parallelLineRatios` | 50 | 保留几何对象、比例/份数动作、Q001 Learn 投影和资源引用 | [x] |
| `auxiliaryTwoRatios` | 50 | 只迁移现有数据/真值/资源；不实现 draft 体验规格中的新交互 | [x] |
| `reverseASimilarity` | 50 | 保留相似判定、对应关系和诊断来源 | [x] |
| `nestedSimilarity` | 50 | 把 runtime 临时补入的 `convert-collinear` 步骤固化到 authoring 产物，避免读取时修改 record | [x] |
| `butterflySimilarity` | 50 | 保留相似判定、对应关系和诊断来源 | [x] |

每个 topic 的完成标准：

- 题目总数与源 bank 对账，stable id 不丢失。
- 每条 approved record 有匹配版本的通过报告和有效 authoring run。
- 随机/边界样题可启动、作答、恢复、完成和 Review。
- public runtime snapshot 不含 private answer truth。
- 单 topic 失败不阻止其他迁移流产出报告，但不得发布不完整的全量 bank。

## Phase 6 — 集成收口

- [x] 删除 runtime 对 v1 bundle 的正常启动依赖；只保留受测试覆盖的 legacy adapter。
- [x] 更新 shared/backend/frontend 的契约快照和文档，术语统一。
- [x] 运行 backend 全量测试、frontend build、authoring 单测/确定性检查与六 topic 首/中/尾 smoke matrix。
- [x] 本文件已按实际验收结果更新；唯一环境限制是本机 WolframKernel 未配置。

## 本轮验收证据

- `npm run import:topics`：六 topic 对账为 `30/50/50/50/50/50`，共 280 条。
- normalized bundle 连续两次导入的 SHA-256 均为 `41da77811f25121ea8eeaedd31b60bdb4c9130f9eea1c0a9ad10a49ca531fe99`。
- backend `npm test`：selector、session pinning、legacy restore、Learn backend evaluation、六 topic 首/中/尾完成流全部通过。
- frontend `npm run build`：通过，仅保留 Vite 的既有 chunk-size warning。
- `python3 -m unittest authoring.tests.test_scenario_pipeline`：通过。

本轮 Definition of Done：Phase 0–6 的必需项完成，六个 topic 全部从 approved bank 启动，真值不下发，旧 session 兼容矩阵通过；`auxiliaryTwoRatios` 草案交互保持未实现。

## 明确延期

- [~] `auxiliaryTwoRatios` draft 体验规格中的布局、赛博老师、呼吸提示和新动作流。
- [~] 学生请求中的实时 AI/Wolfram 出题或校验。
- [~] authoring 管理后台、在线审批 API、部署和运营分析。
- [~] 与本次 schema/selector/迁移无关的新题型或教学目标。

## 风险与控制

- 真值泄漏：以 DTO allowlist + 序列化快照测试控制，不能依赖字段命名约定。
- 旧 session 漂移：以 scenario version pinning 和 legacy id map 控制，禁止恢复时重新选题。
- 批量迁移误批准：审批与校验分离，发布前按 topic 对账并采用 all-or-nothing bank swap。
- 并行迁移冲突：共享 schema/importer 先冻结；topic worker 只改各自数据/adapter/fixture，最后统一集成。
- draft 越权实现：`auxiliaryTwoRatios` 只允许 schema-compatible data transform；行为 diff 视为回归。
