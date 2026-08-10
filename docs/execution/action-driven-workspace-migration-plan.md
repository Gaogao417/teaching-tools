# Action 驱动学习工作台迁移计划

## 文档状态

- 状态：Proposed
- 日期：2026-08-10
- 对应 PRD：[Action 驱动的学习与练习工作台](../prd/action-driven-learning-workspace/PRD-01-action-driven-workspace.md)
- 对应 ADR：[ADR-004 前端 Action Runtime 与后端教学计划边界](../adr/ADR-004-frontend-action-runtime.md)

## 1. 迁移目标

将当前

```text
backend ExerciseRuntimeSpec
    → React/primitive switches + ClientDraftState
    → Canvas-only XState tool
    → nested string answer
    → backend reduceAction
```

逐步迁移为

```text
backend ExercisePlan v2
    → frontend PageMachine
    → current ActionMachine
    → WorkspaceView
    → typed Evidence / StudentTrace
    → backend Evaluation / Coach / Checkpoint
```

迁移采用 strangler pattern：新旧协议与 renderer 并存，按 action/题型逐条切换，不进行一次性全量重写。

## 2. 迁移原则

1. 当前可运行分支和未提交成果先安全 checkpoint，再在独立 worktree 开展 v2。
2. 每个阶段必须产生一个可运行、可回退的纵向切片。
3. v2 不读取 v1 primitive answer string；兼容转换只能存在于明确标记的边界 adapter。
4. backend 私有 answer key、scenario pinning、session 和 result review 在迁移期保持权威。
5. 新 contract 先 versioned coexist，再迁移数据，最后删除 legacy；不得原地改变旧 session 含义。
6. 优先迁移能同时验证 Canvas、answer、coach、AI trace 和 evaluator 的真实流程。
7. 每一阶段都要验证 Learn、Guided、Assessment 三种 validation policy，而不是只测 happy path。

## 3. 分支与 Worktree 策略

### 3.1 开始前

- 为当前 `POCXState` 工作区建立可恢复 checkpoint；不依赖共享 stash 作为长期保存手段。
- 记录当前通过的 typecheck、unit、integration、browser acceptance 基线。
- 从包含生产 Canvas 接管成果的 commit 创建独立分支，例如 `codex/action-runtime-v2`。
- 将本地 `master` 的 geometry-actions POC 作为参考或选择性移植，不把 `poc/` 代码直接发布为生产模块。

### 3.2 目录隔离

目标代码先进入新的稳定边界，避免继续扩张 legacy 目录：

```text
web/shared/actionRuntime/
  plan.ts
  actions.ts
  evidence.ts
  coach.ts
  protocol.ts

web/frontend/src/action-runtime/
  page/
  actions/
  projection/
  persistence/
  react/
  adapters/legacy/

web/backend/src/services/actionRuntime/
  plan/
  evaluation/
  coach/
  checkpoint/
  adapters/legacy/
```

实际落盘前允许根据现有 module convention 调整目录名，但 shared/frontend/backend 三个边界必须保持。

## 4. Phase 0：冻结基线与写出契约样例

### 工作

- 为当前 `auxiliaryTwoRatios` 记录一份 v1 start/restore/submit fixture。
- 记录 `construct-parallel` 每个 partial draft、wrong response、correct response 与 resume 行为。
- 建立 `ExercisePlan v2`、`ActionEvidence`、`StudentTrace`、`CoachDirective` 的 JSON fixtures。
- 建立 contract version 与 action version 规则。
- 明确 Learn/Guided/Assessment 对相同 action 的公开字段差异。

### 退出条件

- v1 行为有 golden fixtures，可用于迁移等价测试。
- v2 fixtures 不包含函数、XState config、actorRef 或私有 Assessment answer。
- `make-parallel` 与 `intersect-carriers` 已是两个独立 action fixture。

## 5. Phase 1：Shared v2 Contracts 与 Runtime Validation

### 工作

- 新增 `ExercisePlan`、`ActionContract`、`ValidationPolicy`、`WorldProjection`。
- 新增 typed action input/evidence union。
- 新增 `StudentTrace`、`CoachDirective`、`AgentCommand`。
- 新增 bootstrap、evaluation、checkpoint、coach request/response。
- frontend 与 backend 均使用 runtime schema validation；不只依赖 TypeScript assertion。
- action kind 与 version 建立 capability negotiation。

首批 action：

```text
make-parallel@1
intersect-carriers@1
mark-segment-value@1
enter-equation@1
```

### 退出条件

- shared typecheck 通过。
- 每个 schema 有 valid/invalid/unknown-version contract tests。
- Assessment fixture 通过 answer-leak grep/fixture assertion。
- evidence 不再需要 `value: string` 二次 JSON 编码。

## 6. Phase 2：Frontend Page Runtime 骨架

### 工作

- 建立一个 page machine，管理 plan lifecycle、current action、feedback、help、checkpoint、evaluation 与恢复。
- 建立 `ActionMachineRegistry`，按 `kind + version` 创建 child actor。
- 同时只运行当前 action actor；完成后保存 `ActionCompletion`，再进入下一 action。
- 建立纯 `WorkspaceView` projector，包含 canvas、answer、coach、controls 四个切片。
- 建立统一 `WorkspaceEvent`，接收 pointer adapter、keyboard、answer、coach、AI 与 replay 的语义事件。
- pointer/hover/animation 继续留在 renderer，不进入 page machine。
- 将现有 GeometryCanvas 改为消费 CanvasView/WorldProjection，不感知 session 或 action kind。

### v1 兼容

新增 `LegacyRuntimeSpecAdapter`：

```text
ExerciseRuntimeSpec v1
    → temporary ExercisePlan v2
    → new frontend runtime
```

该 adapter 只用于迁移，不成为新题型入口。

### 退出条件

- 一个静态 fixture 可驱动 Canvas、answer、coach 和 controls。
- 普通语义点击零网络请求。
- React component 不读取 machine state name 推断步骤。
- page actor 与当前 action actor 数量有测试保证。
- unknown action/version 显示明确错误并可退回 legacy renderer。

## 7. Phase 3：首个生产纵向切片

首个切片选择真实 `auxiliaryTwoRatios` 的辅助线步骤：

```text
make-parallel
    ↓
intersect-carriers
    ↓
typed evidence
    ↓
legacy backend evaluator adapter
```

### 工作

- 将旧四阶段 `construct-parallel` machine 拆为两个 action machines。
- `make-parallel` 只收 point + reference line，输出平行线 command/evidence。
- `intersect-carriers` 只收 carrier endpoints，输出求交 command/evidence。
- page machine 串联两个 action，并投影统一 answer/coach 状态。
- 暂时将两个 typed evidence 转换为旧 `topic-answer` 字符串，在 backend 边界复用原判题。
- adapter 文件必须带删除条件和 legacy telemetry。
- 保留 feature flag：按 session/contract version 选择 v1 或 v2 workspace。

### 退出条件

- 正确、错误、BACK、CLEAR、刷新恢复、键盘操作全部与 v1 等价。
- GeometryCanvas 无 action-specific branch。
- v2 frontend 内不存在 `point:...|parallel:...|carrier:...` serializer。
- legacy string 只存在于单一 backend/transport compatibility adapter。
- 可以一键关闭 feature flag 回到 v1。

## 8. Phase 4：ExercisePlan v2 Backend Projection

### 工作

- backend 从 pinned scenario + public content 生成 `ExercisePlan v2`。
- start/restore 通过 versioned response 或新 endpoint 返回 v2 plan。
- plan projector 只输出领域 metadata、world、coach profile 与 action list。
- 不再为 v2 构造完整 scene/flow/guide/feedback UI projection。
- 保留 v1 `buildRuntime`，直到所有活跃 session 和 renderer 迁移完成。
- plan 添加 revision、capabilities 和 currentActionId。

### 退出条件

- frontend 首个切片不再依赖 `LegacyRuntimeSpecAdapter`。
- Learn plan 可一次加载后本地完成完整 action list。
- Assessment plan 不包含 private accepted answers。
- pinned scenario/version 的恢复测试仍通过。

## 9. Phase 5：Typed Evaluation、Checkpoint 与 Review

### 工作

- 新增 typed evaluation port，接收 `ActionEvidence`，不接收 nested `value` string。
- evaluator 按 session、exercise、action、revision 校验并幂等 commit。
- session 持久化 completed action evidence、committed world、revision 与 evaluation。
- action 完成后异步 checkpoint；正式 Assessment 提交阻塞该 action 的推进。
- result review 从 typed evidence 构造 `actualAnswer` 与诊断，不解析 legacy answer string。
- 旧 session 继续使用 v1 action log；新 session 固定 v2 contract version。

### 退出条件

- make/intersect 流程不再经过任何 legacy string。
- 重试同一 idempotency key 不重复推进。
- revision conflict 可以返回最新 plan 并由 frontend 恢复。
- v1/v2 review snapshot 都能打开。

## 10. Phase 6：AI Coach 与受限 Agent Tools

### 工作

- frontend 生成 bounded StudentTrace：当前 action、状态标签、selection、answer draft、最近事件和错误次数。
- 新增 ask-coach port；第一版可用 request/response，SSE/WebSocket 延后。
- backend AI 输出结构化 CoachDirective，不输出 UI markup 或代码。
- page machine 应用 message、tone、highlight、focus、suggestion。
- 建立 AgentCommand allowlist 与 mode policy：Learn 可自动执行；Guided 默认确认；Assessment 禁止代做。
- AI 命令与学生操作通过同一 WorkspaceEvent/DomainCommand 端口。
- 记录 directive/command 审计信息，但不把 AI 内部 reasoning 暴露给 frontend。

### 退出条件

- 学生可在任一 action 中主动提问并得到上下文相关指导。
- AI 不依赖 DOM、CSS selector 或 JSXGraph API。
- 无效、未知、越权 AgentCommand 被 schema/capability policy 拒绝。
- AI 超时或失败不阻塞本地 action machine。

## 11. Phase 7：按 Action 迁移剩余 Primitive

建议顺序：

1. `mark-segments` → `mark-segment-value`
2. `mark-ratio` → `pair-corresponding-segments`
3. `ratio-scratch`
4. `convert-collinear`
5. `equation` → `enter-equation`
6. 通用 `select` / `input`
7. 其他 engine workspace

每迁移一个 action：

- 新增 input/evidence schema；
- 新增 machine + projector 测试；
- 新增 Learn/Guided/Assessment fixture；
- 新增 evaluator 或明确 LocalTeaching；
- 验证 coach trace 与 AgentCommand capability；
- 删除对应 frontend primitive switch；
- 记录 v1/v2 使用量和 rollback 路由。

### 退出条件

- `TopicPracticeWorkspace` 不再按 primitive 管理交互流程。
- AnswerPanel 不再按 primitive 解析字符串。
- Canvas、CoachPanel、ActionControls 新增 action 时零改动。

## 12. Phase 8：Legacy 下线

只有同时满足以下条件才允许删除：

- 所有新 session 均使用 v2；
- 存量 v1 session 已完成、过期或有显式只读兼容路径；
- 生产 telemetry 中无 v1 interactive renderer 使用；
- v2 result/review 覆盖全部 action；
- rollback window 已结束；
- answer leak、安全、可访问性和跨浏览器门禁通过。

可删除范围：

- v1 `ExerciseRuntimeSpec` 中仅为页面展示服务的 flow/guide/feedback projection；
- `ClientDraftState.topicCoach` 与重复的 React flow state；
- primitive-specific answer serializers/parsers；
- Canvas-only `InteractionRuntime` 外壳，由 page runtime 取代；
- legacy SVG canvas 与 primitive switches；
- v1 runtime action adapter 和 feature flag。

不可删除范围：

- scenario bank/version pinning；
- private evaluator 与 accepted answers；
- session/progression/result；
- authoring pipeline；
- GeometryModel、语义事件、hit test 与 renderer adapter 中仍适用的能力。

## 13. 测试矩阵

### Contract

- schema valid/invalid/unknown version
- Learn/Guided/Assessment answer exposure
- action capability negotiation
- evidence compatibility and idempotency

### Machine

- 每个 state/event/guard/back/cancel
- wrong 后保留正确 context
- action completion output
- page machine child lifecycle
- plan/evaluation/directive/revision conflict

### Projection

- snapshot → CanvasView
- snapshot → AnswerView
- snapshot → CoachView
- snapshot → ControlView
- 相同 snapshot 投影确定性

### Integration

- human event → action completion → evidence
- AI command → same runtime port
- checkpoint → reload → restore
- server reject → targeted correction
- stale revision → conflict recovery
- legacy session restore

### Browser/Accessibility

- mouse、touch、keyboard
- focus management 与 aria-live
- Canvas scale/hit tolerance
- slow/offline network 下本地交互
- AI timeout 不冻结页面

### Security

- Assessment plan/trace/bundle 无 private answer
- backend 不信任 frontend snapshot
- AgentCommand allowlist
- unknown action/version fail closed
- no remote executable code

## 14. 发布、观测与回滚

### Feature flags

- `actionRuntimeV2`
- `exercisePlanV2`
- `typedEvaluationV2`
- `aiCoachV2`

flag 至少可按 task、session contract version 和学生 cohort 控制。

### 关键观测

- v1/v2 session 数量与完成率
- action completion 时间
- local wrong 与 backend reject 分布
- unsupported action/version
- revision conflict 和 duplicate submission
- checkpoint/restore 成功率
- AI latency、directive reject、command confirmation
- Canvas runtime error 与 accessibility completion

### 回滚

- v2 plan/bootstrap 失败：创建新 session 时退回 v1；不得把已固定的 v2 session 静默改成 v1。
- 单 action runtime 失败：在 contract 明确支持时使用 legacy renderer；否则显示可恢复错误。
- typed evaluator 失败：关闭新 session 的 v2 flag，保留既有 v2 evidence 和 revision，不转换成错误的 legacy answer。
- AI coach 失败：关闭 AI capability，不影响本地 action 与正式提交。

## 15. 首个里程碑定义

第一个可发布里程碑不是“完成 runtime 框架”，而是以下真实结果全部成立：

1. backend 返回 v2 ExercisePlan。
2. frontend page machine 连续执行 `make-parallel` 与 `intersect-carriers`。
3. Canvas、answer、coach、controls 由一个 WorkspaceView 驱动。
4. 普通语义点击无网络请求。
5. 学生可携带 StudentTrace 请求一次 AI/静态 coach 指导。
6. Assessment evidence 由 backend 权威验证。
7. session 可 checkpoint、刷新恢复并进入 review。
8. feature flag 可回退 v1。

该里程碑通过后，才开始批量迁移其他 action。
