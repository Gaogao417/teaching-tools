# Action 驱动学习工作台迁移计划

## 文档状态

- 状态：Implemented（Phase 0–7 与 PRD 验收完成；Phase 8 按 pinned-v1 过期门禁保留）
- 日期：2026-08-10
- 对应 PRD：[Action 驱动的学习与练习工作台](../prd/action-driven-learning-workspace/PRD-01-action-driven-workspace.md)
- 对应 ADR：[ADR-004 前端 Action Runtime 与后端教学计划边界](../adr/ADR-004-frontend-action-runtime.md)

## 当前实施快照

2026-08-10 实施结果：

- shared 定义并验证 plan、evidence、directive、AgentCommand、DomainCommand、evaluation/checkpoint response 与 world；unknown version fail closed 于 frontend capability negotiation。
- 280/280 个已发布 Topic record 显式包含 `actionTemplates`（990 actions）；production scenario load 与 plan projector 没有 primitive compiler fallback。
- PageMachine 管理 current child、completed evidence、feedback、coach、revision、committed/draft world 与 command batches；任一时刻只创建一个 child actor。
- `make-parallel` 创建 draft parallel relation；`intersect-carriers` 消费该 relation 并创建 carrier 与 intersection point；preview、redraw、BACK/CLEAR、accepted commit、targeted rollback 均进入生产 Canvas 测试。
- backend typed evaluator 直接按 action kind/version 消费 evidence，持久化 typed request/response 与 committed world；audit event 的 `submitted_value` 为空，不调用 `RuntimeActionEvent`/v1 reducer。
- action checkpoint 只由 completed evidence 触发；普通 click、answer、BACK、CLEAR 及 pointer move 为零请求。partial draft 默认写浏览器 `sessionStorage`。
- 全部剩余 Topic action 已在 registry、machine、presentation、typed evaluator/review 与 LocalTeaching/ServerAuthoritative 测试中覆盖。
- Coach message/tone/highlight/focus、学生消息、通用 `back/clear` AgentCommand production path、capability/mode policy 与 AI failure fallback 已闭环。
- 新 Topic session 固定 `action_runtime_version=2`；rollback flag 只停止创建新 v2 session，不改变已 pinned v2。旧 `action_runtime_version=1` session 继续完整 v1 runtime。

### 阶段状态与证据

| Phase | 状态 | 主要证据 |
| --- | --- | --- |
| 0 冻结/隔离 | Complete | pinned-v1 restore、v2 no-legacy dependency、独立 make/intersect fixtures；下方 legacy inventory |
| 1 Contracts | Complete | shared runtime guards；valid/invalid/unknown-version、Assessment leak、command schema tests |
| 2 Authoring | Complete | bundle 280/280 records、990 versioned actions；import validation；runtime 无 compiler fallback |
| 3 Frontend/world | Complete | one-child lifecycle、projector purity、zero-network、preview、draft commands、BACK/CLEAR tests |
| 4 Backend typed | Complete | direct typed evaluator、idempotency/conflict、typed persistence/review、committed world tests |
| 5 Geometry slice | Complete | make-parallel → intersect-carriers preview/draft/commit/rollback/transport tests |
| 6 Remaining actions | Complete | 9 action kinds均有 frontend Local/Server 与 backend bundle/evaluator smoke evidence；新 session 默认 v2 |
| 7 Coach/tools | Complete | trace/message、real highlight/focus、AgentCommand allowlist/mode、AI failure tests |
| 8 Physical delete | Gated retention | 按本计划不得在 pinned v1 session 过期前删除；新流量已归零，删除门禁和 owner 已记录 |

### Legacy dependency inventory

| 保留项 | Owner | 仅适用版本 | v2 调用方 | 删除条件 / 最晚阶段 |
| --- | --- | --- | --- | --- |
| `TopicRuntimeFrame` / `TopicPracticeWorkspace` / `topicAnswerSerializer` | Frontend Runtime | `action_runtime_version=1` pinned session | 无（静态门禁） | v1 活跃 session 为零且 rollback window 结束 / Phase 8 |
| Topic v1 `reduceTopicPracticeAction` 与 primitive-specific projection | Backend Runtime | versioned v1 session/API | typed evaluator 无调用 | v1 submit/restore telemetry 为零 / Phase 8 |
| `/api/practice/runtime-action` v1 endpoint | Runtime Platform | pinned v1 与非 Topic v1 engines | v2 evaluation 无调用 | 所有依赖 engine 完成版本迁移 / Phase 8 |
| scenario/version pinning、private answer domain、session/progression/result | Content/Runtime Platform | v1 + v2 | 正式保留 | 不删除；不属于 legacy UI/runtime |

## 1. 迁移目标

将当前：

```text
backend ExerciseRuntimeSpec
    → React/primitive switches + ClientDraftState
    → Canvas-only XState tool
    → nested string answer
    → backend reduceAction
```

迁移为两条清晰的 frontend 输出通道：

```text
backend ExercisePlan v2
    → frontend PageMachine
    → current ActionMachine
        ├─ snapshot → ActionPresentation → WorkspaceView → renderer
        └─ completion → Evidence + DomainCommand → DraftWorld
```

以及一条权威 backend 链路：

```text
typed Evidence
    → backend typed evaluator
    → accepted/rejected/conflict
    → committed world + revision + review
```

迁移采用分阶段 strangler pattern，但不允许 legacy 无限期成为 v2 的依赖。新旧 session 可以并存，新的 authoring、action、evaluator 和 frontend runtime 必须只向 v2 边界演进。

## 2. 核心迁移原则

1. 当前可运行分支和未提交成果先建立可恢复 checkpoint，再迁移生产链路。
2. 每个阶段必须产生可运行、可观测、可回退的纵向切片。
3. legacy 立即冻结：不再新增 primitive switch、专用字符串 serializer、v1 UI projection 或从新模块到旧模块的依赖。
4. legacy 数据、authoring 和 evaluator 依赖提前迁移；旧 session 兼容代码的物理删除最后执行。
5. v2 不读取 v1 primitive answer string；短期转换只能存在于明确标记、带删除门禁的单一 adapter。
6. backend 私有 answer key、scenario pinning、session、committed world 和 result 在迁移期保持权威。
7. frontend page runtime 是未提交页面交互的唯一事实来源；普通语义点击不产生网络请求。
8. `ActionPresentation` 只描述当前显示；`ActionCompletion` 才能产生 evidence 和 domain commands，projector 不执行副作用。
9. LocalTeaching 可使用公开目标在 frontend 判断；ServerAuthoritative frontend 只判断结构合法与输入完整，私有数学正确性由 backend 判断。
10. 每一阶段都验证 Learn、Guided Practice、Assessment，不只测试 happy path。

## 3. Legacy 策略：立即冻结、提前迁移、最后删除

“迁移 legacy”和“删除 legacy”必须分开：

| 动作 | 时机 | 含义 |
| --- | --- | --- |
| 冻结 | Phase 0 | legacy 不再接受新能力、新题型和新分支 |
| 隔离 | Phase 0–1 | v2 只能通过一个有期限的 compatibility boundary 接触 legacy |
| 数据与依赖迁移 | Phase 2–6 | actionTemplates、typed answer keys、evaluator、review、Topic primitives 逐步脱离 legacy |
| 停止新流量 | Phase 6 | 新 Topic session 默认只使用 v2，v1 仅服务已固定的旧 session |
| 物理删除 | Phase 8 | 存量 session 过期且 rollback window 结束后删除旧代码 |

依赖方向必须保持：

```text
new authoring → v2 contracts → v2 backend/frontend runtime

pinned v1 session → versioned legacy runtime（只读兼容）

v2 runtime -X→ legacy UI/runtime/primitive modules
```

唯一临时例外是显式的 compatibility adapter。每个 adapter 必须包含：

- owner；
- 适用的 contract/session version；
- telemetry；
- 删除条件；
- 最晚删除阶段；
- 禁止被新 action 复用的依赖测试。

## 4. 分支与目录策略

### 4.1 开始前

- 为当前工作区建立可恢复 checkpoint；不依赖共享 stash 作为长期保存手段。
- 记录 typecheck、unit、integration、browser acceptance 基线。
- 从包含生产 Canvas 接管成果的 commit 创建独立分支或 worktree。
- 将 POC 作为行为参考，不把 `poc/` 或 legacy 代码直接复制为生产模块。

### 4.2 稳定边界

```text
web/shared/actionRuntime/
  plan.ts
  actions.ts
  evidence.ts
  world.ts
  coach.ts
  protocol.ts

web/frontend/src/action-runtime/
  page/
  actions/
  projection/
  world/
  persistence/
  react/

web/backend/src/services/actionRuntime/
  plan/
  evaluation/
  coach/
  checkpoint/
  adapters/legacy/
```

实际目录名可遵循现有 convention，但 shared/frontend/backend 边界和依赖方向必须保持。legacy adapter 不得散落在 page、Canvas、AnswerPanel 或正式 plan projector 中。

## 5. Phase 0：冻结基线与隔离 Legacy

### 工作

- 为 Topic v1 start/restore/submit/review 建立 golden fixtures。
- 记录 `construct-parallel` partial、wrong、correct、BACK、CLEAR 和 resume 行为。
- 建立 v2 plan、evidence、trace、directive 和 command JSON fixtures。
- 盘点所有 primitive switch、answer serializer、v1 renderer 路由和新模块对 legacy 的 imports。
- 建立冻结规则：禁止新增 primitive-specific frontend/backend 分支。
- 将现存 compatibility code 收敛到明确的 `adapters/legacy` 或 versioned v1 runtime。

### 退出条件

- v1 行为有可重复的 golden fixtures。
- legacy dependency inventory 有 owner 和删除阶段。
- CI/静态检查可以阻止 v2 新增到 legacy UI/runtime 的依赖。
- `make-parallel` 与 `intersect-carriers` 是两个独立 v2 fixtures。

## 6. Phase 1：Shared Contracts 与 Runtime Validation

### 工作

- 定义 `ExercisePlan`、`ActionContract`、`ValidationPolicy`、`WorldProjection`。
- 定义 typed action input/evidence、`StudentTrace`、`CoachDirective`、`AgentCommand`。
- 明确 presentation、completion 与 world effect 是不同契约：

```fsharp
type ActionPresentation = {
    selectedObjectIds: string list
    enabledObjectIds: string list
    answerSlots: AnswerSlotView list
    preview: CanvasPreview option
}

type ActionCompletion = {
    evidence: ActionEvidence
    commands: DomainCommand list
}

type WorkspaceWorld = {
    committed: WorldProjection
    draft: WorldProjection
    revision: int
}

type WorldCommandPort =
    abstract ApplyDraft:
        WorkspaceWorld * DomainCommand list
        -> Result<WorkspaceWorld, WorldCommandError>
```

- frontend 与 backend 对所有跨网络 plan/evidence/directive 执行完整 runtime schema validation。
- action kind/version 建立 capability negotiation 和 unknown-version fallback。
- 定义 transport error、backend rejection 和 revision conflict 三种不同结果。

### 退出条件

- 每个 schema 有 valid、invalid、unknown-version tests。
- Assessment fixture 不包含 private answer 或等价可推导字段。
- evidence 不需要 nested `value: string` 编码。
- `ActionPresentation` 不包含 mutation；`DomainCommand` 不包含 DOM、React 或 JSXGraph handle。

## 7. Phase 2：提前迁移 Topic Authoring 与数据

该阶段必须发生在继续扩展 frontend action 之前，以免新代码继续围绕 primitive 数据模型生长。

### 工作

- authoring 直接输出 versioned `actionTemplates` 和 typed private answer/evaluation schema。
- 将当前 Topic bundle 一次性迁移并重新发布为包含 `actionTemplates` 的版本化数据。
- primitive compiler 只保留为离线 migration tool；正式 scenario load 与 plan projector 不调用它生成新 session 的 action list。
- 为 pinned v1 scenario 保留原始数据和旧 runtime，不原地改变其含义。
- 新题目 schema 禁止只提交 `primitive + interaction` 而不提交 action list。
- 建立 bundle validation，验证 action IDs、kind/version、capabilities、公开/私有输入和输出对象 IDs。

### 退出条件

- 所有当前发布的 Topic v2 bundle 都显式包含 `actionTemplates`。
- v2 session bootstrap 不执行 primitive-to-action runtime compilation。
- 新 authoring 不生成新的 primitive answer string。
- legacy compiler 只有离线迁移入口和 pinned v1 兼容调用方。

## 8. Phase 3：Frontend Page Runtime 与 World Effect 骨架

### 工作

- PageMachine 管理 plan lifecycle、current action、feedback、help、evaluation、恢复和 draft world。
- `ActionMachineRegistry` 按 `kind@version` 创建当前唯一 child actor。
- 每个 action definition 同时拥有 input schema、machine factory、presentation projector 和 completion contract。
- child snapshot 通过纯 projector 生成 `ActionPresentation`；PageMachine 将其组合成 Canvas、answer、coach、controls。
- child completion 产生 `Evidence + DomainCommand`；WorldCommandPort 将命令应用到 draft world。
- LocalTeaching completion 可以本地应用并推进；ServerAuthoritative completion 保留为 pending，按提交策略等待 backend 结果后 commit/rollback。
- GeometryCanvas 直接消费新 CanvasView/WorldProjection；移除 v2 到旧 `InteractionView` 的有损桥接。
- pointer/hover/animation 保留在 renderer；preview 通过声明式 CanvasPreview 传递但不修改 world。
- 普通语义点击、answer change 和 pointer move 零网络请求。未完成草稿优先存浏览器；若启用远程 partial checkpoint，只能在页面隐藏/离开等明确 lifecycle 事件发生。

### v1 兼容边界

v1 session 继续由 versioned v1 renderer 完整处理，不把 `ExerciseRuntimeSpec v1` 伪装成 v2 plan 注入新 runtime。这样可以避免 legacy 状态语义进入 PageMachine。

### 退出条件

- 同一时刻只有一个 child action actor。
- 静态 fixture 可驱动 Canvas、answer、coach、controls。
- action preview 端到端显示在生产 Canvas。
- completion command 可以创建/更新 draft GeometryModel，并触发 Canvas 重绘。
- BACK/CLEAR 可以撤销对应 draft commands，不遗留孤立对象。
- 普通语义点击的网络请求数为零。
- Canvas、React component、PageMachine 不按 action kind 分支。

## 9. Phase 4：Backend Plan、Typed Evaluation 与权威 World

### 工作

- backend 从 pinned scenario + public content 输出 `ExercisePlan v2`，正式 projector 只处理通用 envelope、mode、revision、world、coach 和 action list。
- typed evaluator 直接接收 `ActionEvidence`，不再构造 nested value 或 primitive answer string。
- evaluator 按 session、exercise、source step、action、revision 和 idempotency key 校验。
- backend 持久化 completed evidence、committed world、revision、evaluation 和 typed review。
- ServerAuthoritative result 明确返回 accepted、rejected 或 conflict；transport failure 不映射成学生答错。
- rejected diagnosis 指向相关 action、对象和槽位，不要求 frontend 清除同 source step 已确认的正确结果。
- checkpoint 只记录 completed evidence；未完成 draft 的远程保存若启用，必须使用独立 lifecycle policy，不由普通点击触发。
- v1 session 继续使用其固定 evaluator 和 action log；v2 evaluator 不调用 v1 submit/reducer。

### 退出条件

- plan projector 不含 primitive/action switch。
- Learn plan 一次加载后可本地完成 action list。
- Assessment plan 不包含 private accepted answers。
- typed evidence 到 evaluator、persistence、review 全程不经过 legacy string。
- 同一 idempotency key 重试不重复推进；frontend 重试复用原 key。
- revision conflict 可以返回最新 plan 并安全恢复。

## 10. Phase 5：首个完整生产纵向切片

首个切片选择真实辅助线步骤：

```text
make-parallel
    → parallel preview
    → construct-parallel DomainCommand
    → intersect-carriers
    → intersection preview/commands
    → typed evaluation
    → committed world/review
```

### 工作

- `make-parallel` 只收 point + reference line，输出 evidence 和构造平行线 command。
- `intersect-carriers` 只收 carrier endpoints，输出 evidence 和载体/求交 commands。
- page runtime 串联两个 action，并让第二个 action 可以消费第一个 action 创建的 draft objects。
- LocalTeaching guard 可比较公开目标并立即反馈；ServerAuthoritative guard 只判断结构和完整性。
- backend reject 时只回滚/标错诊断涉及的 action 或 commands，保留已经确认的正确结果。
- BACK 可在当前 action 内撤销，也可在策略允许时退回前一个已完成但未 commit 的 action。
- 开发过程中可短时使用单一 legacy evaluator adapter 对照结果，但该 adapter 不得进入本阶段退出版本或默认生产路由。
- 保留按 session contract version 的 v1/v2 回滚能力。

### 退出条件

- 正确、错误、BACK、CLEAR、刷新恢复、键盘操作满足新语义和 v1 parity fixture。
- 平行线、载体和交点由 action commands 创建，而不是预先塞入 world 冒充 action 结果。
- preview、draft object、accepted commit 和 rejected rollback 均有 integration/browser tests。
- `make-parallel → intersect-carriers` 全链路不经过 legacy string 或 v1 reducer。
- 网络失败进入 retryable error，不增加 wrongAttempts、不清除 draft。
- feature flag 可以停止创建新 v2 session，但不会把已固定 v2 session 静默切成 v1。

## 11. Phase 6：提前迁移剩余 Topic Action 并停止 v1 新流量

建议顺序：

1. `mark-segments` → `mark-segment-values`
2. `mark-ratio` → `pair-segments`
3. `ratio-scratch`
4. `convert-collinear`
5. `equation` → `enter-equation`
6. 通用 `select` / `input`

每迁移一个 action：

- 新增 input/evidence/command schema；
- 新增 machine、presentation 和 world-effect tests；
- 新增 Learn/Guided/Assessment fixtures；
- 新增 typed evaluator/review；
- 删除该 action 对应的 primitive switch、serializer 和 runtime compiler 分支，不等 Phase 8 统一清理；
- 验证 coach trace 和 AgentCommand capability；
- 记录 v1/v2 使用量与 rollback 路由。

### 退出条件

- 所有新 Topic session 默认使用 v2。
- Topic v2 authoring、plan、frontend、evaluator 和 review 不依赖 legacy primitive/string/runtime。
- `TopicPracticeWorkspace`、AnswerPanel、Canvas 不按 primitive 管理流程。
- v1 只服务已经 pinned 的旧 session，不再接收新内容和新 session。
- 新增 action 时 Canvas、CoachPanel、ActionControls 主体零改动。

## 12. Phase 7：AI Coach 与受限 Agent Tools

### 工作

- frontend 生成 bounded StudentTrace：当前 action、状态标签、selection、answer draft、最近事件、错误次数和可选学生消息。
- backend AI 输出声明式 CoachDirective，不输出 UI markup、代码或 DOM selector。
- page runtime 将 message、tone、highlight、focus、suggestion 应用到真实 WorkspaceView 和控件。
- 建立 AgentCommand allowlist 与 mode policy：Learn 可自动执行；Guided 默认确认；Assessment 只允许提示和聚焦。
- AI command 与学生操作进入同一 WorkspaceEvent/DomainCommand 端口。
- 记录 directive/command 审计信息，但不暴露 AI 内部 reasoning。

### 退出条件

- 学生可携带消息在任一 action 中得到上下文相关指导。
- highlight 和 focus 对真实 Canvas/Answer 控件生效。
- AI 不依赖 DOM、CSS selector 或 JSXGraph API。
- 无效、未知、越权 AgentCommand 被 schema/capability policy 拒绝。
- AI 超时或失败不阻塞本地 action machine。

## 13. Phase 8：Legacy 物理退役

该阶段不是首次迁移 legacy，而是删除已经没有新流量、只为存量 session 保留的代码。

只有同时满足以下条件才允许删除：

- 所有新 Topic session 已持续使用 v2；
- 存量 v1 session 已完成、过期或迁入显式只读归档 viewer；
- 生产 telemetry 中无 v1 interactive renderer 使用；
- v2 result/review 覆盖全部 Topic actions；
- rollback window 已结束；
- answer leak、安全、可访问性和跨浏览器门禁通过。

可删除范围：

- v1 `ExerciseRuntimeSpec` 中仅为 Topic 页面展示服务的 flow/guide/feedback projection；
- `ClientDraftState.topicCoach` 与重复的 React flow state；
- primitive-specific answer serializers/parsers/compiler；
- Canvas-only `InteractionRuntime` 外壳中已被 page runtime 取代的部分；
- legacy Topic renderer、primitive switches、v1 runtime action adapter 和相应 feature flag。

不可删除范围：

- scenario bank/version pinning；
- private evaluator 与 accepted answers 的领域能力；
- session/progression/result；
- authoring pipeline；
- GeometryModel、语义事件、hit test 与工具无关 renderer 能力。

## 14. 测试矩阵

### Contract

- schema valid/invalid/unknown version
- Learn/Guided/Assessment answer exposure
- LocalTeaching/ServerAuthoritative validation boundary
- action capability negotiation
- evidence/command compatibility and idempotency

### Machine

- 每个 state/event/guard/BACK/CLEAR/CANCEL
- wrong 后保留无关的正确 context/evidence
- action completion 输出 evidence + commands
- page machine child lifecycle
- accepted/rejected/conflict/transport error

### Projection 与 World

- snapshot → ActionPresentation → Canvas/Answer/Coach/Controls
- presentation preview → production Canvas
- completion → DomainCommand → draft world → Canvas redraw
- backend accepted → committed world
- backend rejected → targeted rollback
- 相同 snapshot/world 投影确定性

### Integration

- human event → action completion → world effect → evidence
- AI command → same runtime port
- completed checkpoint → reload → restore
- page lifecycle partial draft → restore（若启用）
- server reject → targeted correction
- network failure → retry without wrong/reset
- stale revision → conflict recovery
- pinned legacy session restore
- ordinary semantic click → zero network requests

### Browser/Accessibility

- mouse、touch、keyboard
- focus management 与 aria-live
- Canvas scale/hit tolerance
- preview、constructed objects 和 undo
- slow/offline network 下本地交互
- AI timeout 不冻结页面

### Security 与 Dependency

- Assessment plan/trace/bundle 无 private answer
- backend 不信任 frontend snapshot/draft commands
- AgentCommand allowlist
- unknown action/version fail closed
- no remote executable code
- v2 production modules 无 legacy UI/runtime imports
- new Topic bundle 无 primitive-only authoring

## 15. 发布、观测与回滚

### Feature flags

- `actionRuntimeV2`
- `exercisePlanV2`
- `typedEvaluationV2`
- `aiCoachV2`

flag 至少可按 task、session contract version 和 cohort 控制。flag 只控制新 session 路由，不改变已固定 session 的 contract version。

### 关键观测

- v1/v2 新建 session、活跃 session 与完成率
- legacy adapter/compiler 调用量和调用方
- action completion 时间
- local structural reject 与 backend mathematical reject 分布
- unsupported action/version
- revision conflict、duplicate submission、transport retry
- completed checkpoint/restore 成功率
- AI latency、directive reject、command confirmation
- Canvas preview/world command/runtime error

### 回滚

- v2 bootstrap 失败：停止创建新 v2 session；不得把已固定的 v2 session 静默改为 v1。
- 单 action runtime 失败：显示可恢复错误；只有 contract 明确提供完整 versioned v1 session 时才进入旧 renderer。
- typed evaluator 失败：保留既有 typed evidence、draft world 和 idempotency key，等待恢复或人工处理，不转成学生答错。
- AI coach 失败：关闭 AI capability，不影响本地 action 与正式提交。

## 16. 首个可发布里程碑

第一个可发布里程碑必须同时满足：

1. backend 返回来自显式 actionTemplates 的 v2 ExercisePlan。
2. frontend PageMachine 连续执行 `make-parallel` 与 `intersect-carriers`，同时只运行一个 child actor。
3. Canvas、answer、coach、controls 由同一个 WorkspaceView 驱动。
4. preview 能到达生产 Canvas；completion commands 能创建平行线、载体和交点，并支持撤销。
5. 普通语义点击零网络请求；checkpoint 只在 action completion 或明确 lifecycle 事件发生。
6. LocalTeaching 在 frontend 判断公开目标；Assessment evidence 由 backend typed evaluator 权威判断。
7. typed evidence 到 evaluation、persistence、review 不经过 legacy string/v1 reducer。
8. server reject 只影响相关 action/对象，网络失败不会变成 wrong。
9. session 可 checkpoint、刷新恢复并进入 typed review。
10. 新 Topic session 可停止 v2 创建，但已固定 v2 session 保持协议一致。

该里程碑通过后，立即批量迁移剩余 Topic action 并停止 v1 新流量；AI 增强不阻塞 legacy 依赖清除。
