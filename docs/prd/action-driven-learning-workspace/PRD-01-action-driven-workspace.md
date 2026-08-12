# PRD-01：Action 驱动的学习与练习工作台

## 文档状态

- 状态：Implemented（Action Runtime v5 产品闭环与自动化验收已完成）
- 日期：2026-08-10
- 优先级：P0
- 目标端：Web 学生端
- 相关决策：[ADR-004 前端 Action Runtime 与后端教学计划边界](../../adr/ADR-004-frontend-action-runtime.md)
- 迁移计划：[Action Runtime 迁移计划](../../execution/action-driven-workspace-migration-plan.md)

### 当前交付判断

2026-08-10 已完成并验证完整闭环：

- `ExercisePlan v2 → PageMachine → 单一 current ActionMachine → ActionPresentation → WorkspaceView` 驱动 Canvas、answer、coach 与 controls；
- `ActionCompletion → typed Evidence + DomainCommand → DraftWorld → GeometryModel → 生产 Canvas`，并覆盖 accepted commit、diagnosis 定向 rollback、BACK/CLEAR；
- backend typed evaluator、evaluation/world persistence 与 typed review 不再经过 `topic-answer`、nested `value` 或 v1 reducer；
- 280 条已发布 Topic record 全部显式携带 versioned `actionTemplates`，合计 990 个 action；production bootstrap 不再调用 primitive compiler；
- 普通语义 click、answer change、BACK、CLEAR 只进入本地 runtime；未完成 draft 存 `sessionStorage`，远程 checkpoint 默认只含 completed evidence；
- CoachDirective 的 message/tone/highlight/focus 已作用于真实页面，AgentCommand 经过 schema、capability 与 Learn/Guided/Assessment mode policy；AI/transport failure 不会阻塞或误判本地 action；
- 新 Topic session 固定为 v2；feature flag 只影响新建 session，`action_runtime_version=1` 的 pinned session 继续由完整 v1 runtime 恢复和完成。

Phase 8 的 legacy 物理删除仍按本计划定义的存量过期与 telemetry 门禁执行；这属于已实施 v2 之外的受控退役窗口，不影响本 PRD 的 14 项验收结论。

## 1. 背景与问题

当前在线做题链路由 backend `EnginePlugin` 生成完整 `ExerciseRuntimeSpec`，frontend 再将
`scene`、`flow`、`guide`、`feedback` 和 `runtimeState` 投影成页面。同时，Canvas 多步操作、
answer 草稿、coach 消息、错误对象和提交阶段又分别保存在 XState、React state、
`ClientDraftState` 与 session runtime 中。

这带来五类问题：

1. 同一状态有多个所有者，例如当前步骤、错误反馈和已选对象需要跨层同步。
2. backend 投影携带大量页面表达字段，新增一种页面工具时需要同时修改 engine、共享契约和多个 frontend renderer。
3. action 的中间结果先被编码进 `ClientDraftState`，再编码进 `RuntimeActionEvent.value`；部分题型内部还有 `point:A|parallel:BC` 一类专用字符串协议。
4. XState 只控制 Canvas 内部工具，answer、coach 和 controls 仍由 React 分支控制，无法形成统一、可回放的学生交互状态。
5. AI coach 若要理解或操作页面，只能读取散落状态或模拟 DOM，难以稳定地对话、提示、回放和调用工具。

## 2. 产品决策

产品采用 **backend 教学计划 + frontend Action Runtime**：

- 离线 authoring 直接产出 versioned action JSON list；backend 返回题目 metadata、公开世界模型、coach profile 和有序 `ActionList`，不按 action kind 重建 machine 参数；
- frontend 通过本地注册的 XState machine 执行 action，不为每次语义点击请求 backend；
- 页面级 machine 同时管理 Canvas、answer、coach 和 controls 的实时状态；
- action snapshot 产生声明式 `ActionPresentation`；action completion 产生 typed evidence 和可选 `DomainCommand`；
- page runtime 通过 world command port 管理 draft world，Canvas 只渲染 `WorkspaceView` 和 `WorldProjection`；
- frontend 在求助、action checkpoint 和正式提交时发送结构化学生轨迹或 evidence；
- backend 保留私有真值、权威判题、session 持久化和 AI coach；
- backend 不发送 JavaScript、函数或可直接执行的远程状态机代码。

## 3. 产品目标

### 3.1 学生体验

- Canvas 点击、answer 输入、撤销和预览即时响应，不依赖网络往返。
- 当前指令、可操作对象、answer 槽、coach 提示和提交按钮始终来自同一 machine snapshot。
- 离开再返回时能够恢复已正式完成的 action；当前未完成 action 至少可以从本地 checkpoint 恢复。
- 错误只影响相关对象或槽位，不清除已经确认的正确结果。

### 3.2 内容与题型扩展

- backend 用 typed action 组合学习步骤，不描述 React 组件或 Canvas 分支。
- 新增已有 action 类型的题目只新增数据；无需新增页面条件分支。
- 新增 action 类型时只新增 machine、presentation projector、completion/evidence/command schema、可选 evaluator 和 renderer capability。
- Learn、Guided Practice 和 Assessment 共用 action vocabulary，根据 validation policy 改变答案公开程度。
- 新 Topic authoring 必须直接产出 `actionTemplates`；primitive compiler 只允许用于离线迁移或 pinned v1 session，不得成为 v2 runtime 的长期输入。

### 3.3 AI Coach

- AI 读取结构化 `StudentTrace`，而不是抓取 DOM 或解析自由格式 answer 字符串。
- AI 返回结构化 `CoachDirective`，可以发言、聚焦 answer 槽、高亮数学对象或建议下一 action。
- AI 调用 Canvas/page tool 时走与学生相同的语义事件或受限 command port，不直接操作 JSXGraph、React state 或 DOM。
- AI 行为受当前 action capability 和 mode policy 限制。

## 4. 非目标

- 不允许 backend 或 AI 向浏览器发送任意可执行代码。
- 不设计允许任意 guard/action/effect 的远程 XState DSL。
- 不要求每次 pointer move、hover、按键或语义点击都上传 backend。
- 不把私有 answer key、accepted answers 或未公开推理步骤发送给 Assessment frontend。
- 不一次性重写 scenario bank、学习进度或结果统计系统；但 action authoring contract、Topic 数据和 evaluator 的 legacy 依赖必须提前迁移。
- 不把工作台变成无约束的自由画板。

## 5. 用户模式与判题策略

| 模式 | ActionList 内容 | 本地能力 | backend 能力 |
| --- | --- | --- | --- |
| Learn | 可包含完整解题 action 与目标参数 | 本地演示、回放、即时判断 | 提供内容；可选记录学习进度 |
| Guided Practice | 一次下发当前题完整 Action list 与审核过的 local truth | 本地判定、即时反馈、Action 推进和训练指标 | 异步训练记录、进度、AI coach；不重新判数学正确性 |
| Assessment | 只含公开指令、候选对象和完成结构 | 判断输入是否完整，不判断私有数学真值 | 私有判题、计分、诊断、正式推进 |

`ActionContract.validationPolicy` 必须显式声明：

- `local-demonstration`：目标参数属于公开教学内容，frontend guard 可以判断对象合法性和数学目标是否匹配，完成后可立即更新 draft world；
- `local-training`：Practice 使用审核过的 local truth 当场分类语义候选，错误留在当前状态，正确完成才应用 DomainCommand 并异步上传训练记录；
- `server-authoritative`：frontend guard 只判断对象类型、候选范围和 evidence 结构完整，数学正确性及正式 world commit 由 backend 决定。

validation policy 是每个 action 的判题边界，不决定 machine 运行位置；三种 policy 的 action machine 都运行在 frontend。

如果一个 action 的参数已经明确写出“过 A 作 BC 的平行线，与 EF 交于 G”，这些参数在
Learn/Guided 模式属于公开教学内容；在独立 Assessment 中不得用同一份完整参数充当隐藏答案。

## 6. 核心体验流程

### 6.1 启动题目

1. frontend 请求 `ExercisePlan`。
2. backend 返回 metadata、WorldProjection、CoachProfile、ActionList、mode 与 revision。
3. frontend 校验 contract version 与所需 capabilities。
4. page machine 启动，并按 `currentActionId` 创建一个 child action actor。
5. snapshot 投影为 `WorkspaceView`，由 Canvas、answer、coach 和 controls 分别消费其切片。

### 6.2 本地执行 action

1. Canvas、answer 或 controls 产生语义事件。
2. page machine 将事件交给当前 action machine。
3. machine 更新 context；action-specific projector 生成新的 `ActionPresentation`。
4. page projector 将 presentation 与 page/world state 组合成 `WorkspaceView`，UI 立即响应且不请求 backend。
5. action 完成时产生 `ActionCompletion`，其中包含 typed evidence 和零个或多个 `DomainCommand`。
6. page runtime 将 commands 应用到 draft world；LocalDemonstration/LocalTraining 可直接进入下一 action，ServerAuthoritative 按提交策略保留 pending completion。
7. completed action 可以异步 checkpoint；未完成 action 默认存浏览器，只允许在页面隐藏/离开等明确 lifecycle 事件选择性远程 checkpoint，不随普通语义点击上传。

### 6.3 学生请求指导

1. 学生点击“问老师”，或本地策略检测到连续错误。
2. frontend 发送当前 `StudentTrace`，包括当前 action、machine state、已选对象、answer draft、最近事件和学生消息。
3. backend/AI 返回 `CoachDirective`。
4. page machine 接收 directive，同时更新 coach、Canvas 高亮、answer focus 与可用 controls。

该请求不得阻塞 Canvas 的本地交互；超时后学生仍可继续操作。

### 6.4 正式提交

1. frontend machine 确认 evidence 结构完整。
2. `local-demonstration` action 可直接完成，并异步 checkpoint。
3. `local-training` action 可直接完成并写入可重试 TrainingSyncQueue，不发送数学 evaluation request。
4. `server-authoritative` action 将 typed evidence 发送 backend。
5. backend 独立校验 session、action、revision 和私有答案。
6. backend 返回 accepted/rejected/conflict、结构化 diagnosis、committed world delta 与 next action。
7. accepted 时 page runtime 提交对应 draft commands；rejected 时只回滚或标记 diagnosis 涉及的 action、对象和槽位；conflict 时按权威 revision 恢复。
8. transport failure 进入可重试错误，不计为学生答错，不清除 draft，并复用原 idempotency key。

## 7. Action 产品契约

每个 action 必须同时定义：

- 稳定的 `kind` 与 `version`；
- 学生可见 instruction；
- machine 构造参数；
- 需要的 page/canvas capabilities；
- answer 槽声明；
- validation policy；
- snapshot 到 `ActionPresentation` 的纯 projector；
- typed evidence 输出；
- 完成后产生的 `DomainCommand`；
- 可供 coach 使用的语义标签。

核心输出契约为：

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
```

`ActionPresentation` 只描述当前页面显示，不执行副作用；`ActionCompletion.commands` 由 page runtime 的 world command port 执行，projector、React 和 Canvas 均不得直接修改领域 world。

首批 action vocabulary：

| Action | 学生语义 | Evidence |
| --- | --- | --- |
| `make-parallel` | 选择过线点与平行参照线 | point + line |
| `intersect-carriers` | 选择载体线的两个端点并得到交点 | two carrier points |
| `mark-segment-value` | 在线段上填写或确认数值 | segment + value |
| `pair-corresponding-segments` | 按顺序配对对应边 | ordered segment pairs |
| `convert-collinear` | 选择共线关系并写出换算 | segments + relation |
| `enter-equation` | 填写结构化等式和结果 | typed answer fields |

`construct-parallel` 四阶段组合 action 不进入目标 vocabulary；迁移时拆为
`make-parallel` 与 `intersect-carriers` 两个独立 action。

## 8. Workspace 行为要求

`WorkspaceView` 至少包含以下切片：

- `canvas`：对象 affordance、selection、preview、cursor；
- `answer`：槽位、draft、active slot、字段状态；
- `coach`：message、tone、highlight、follow-up；
- `controls`：back、clear、cancel、help、submit 的可用性与原因。

要求：

- React component 不读取 XState `state.value` 推断业务步骤；
- Canvas 不按 action kind 分支；
- answer panel 不按 primitive 手写 parser；
- coach panel 不直接修改 Canvas 或 answer state；
- page runtime 区分 backend committed world 与 frontend draft world；Canvas 渲染两者组合后的 WorldProjection；
- preview 只属于 presentation；构造完成的平行线、载体和交点必须来自 DomainCommand，不能预先塞进 world 冒充 action 结果；
- BACK/CLEAR 撤销相应 draft commands，不能遗留孤立几何对象；
- 所有入口，包括鼠标、键盘、AI、回放，都转换成同一套语义事件或 command；
- pointer/hover/animation 等高频展示状态保留在 renderer 本地。

## 9. AI 自主工具使用

AI 有两类输出：

1. `CoachDirective`：只改变展示和指导，不改变学生答案；
2. `AgentCommand`：调用已注册 action/page tool。

执行策略：

| 模式 | AI 工具权限 |
| --- | --- |
| Learn | 可自动执行、暂停、回放 action |
| Guided Practice | 默认建议；经学生确认后执行会改变 draft 的 command |
| Assessment | 只允许提示和聚焦，不得替学生完成答案 |

frontend 必须校验 command 是否属于当前 `ActionContract.capabilities`；未知 command、未知
version 或越权目标必须拒绝。

## 10. 性能与可靠性要求

- 页面只长期运行一个 page actor 和一个当前 action actor。
- 未激活 action 以 JSON 数据保留，不创建 actor。
- 普通语义事件到可见反馈的本地耗时目标小于 50ms。
- pointer move 不进入 XState；Canvas preview 不产生网络请求。
- 普通语义点击、answer change、BACK 和 CLEAR 不触发远程 checkpoint。
- AI 请求和遥测上传不得阻塞本地 machine。
- action evidence 与 event batch 必须有 idempotency key 或 revision，避免重试造成重复提交。
- transport error、backend rejection 与 revision conflict 必须是不同的 lifecycle 状态。
- frontend 未知 action kind/version 时显示可恢复错误，不静默降级成错误交互。

## 11. 安全与隐私

- Assessment plan 不包含私有答案或等价可推导字段。
- backend 不信任 frontend snapshot；正式判题只信任经 schema 校验的 evidence，并使用 session 固定的 scenario/version。
- StudentTrace 只上传指导所需的最近事件与当前状态，不上传 DOM、屏幕录制或无关个人数据。
- AI 输出必须经过结构化 schema、能力白名单和模式权限检查。
- 所有 action/coach/evidence contract 均带版本号。

## 12. 验收标准

1. `make-parallel → intersect-carriers` 可在无普通语义点击网络请求的情况下完成。
2. Canvas、answer、coach 和 controls 从同一个 page machine snapshot 派生。
3. action preview 到达生产 Canvas；completion commands 能创建平行线、载体和交点，并支持 BACK/CLEAR 撤销。
4. Learn 模式可只依赖一次 ExercisePlan 请求完成整题演示、本地判断和 draft world 更新。
5. Assessment 模式的浏览器 payload 不包含私有 accepted answers，数学正确性只由 backend evaluator 判断。
6. backend rejected 只影响 diagnosis 涉及的 action、对象或槽位，不清除已确认的正确结果。
7. transport failure 不增加 wrongAttempts、不清除 draft，并可使用同一 idempotency key 重试。
8. 学生主动求助时，backend 能依据 StudentTrace 返回并实际应用对象高亮与 answer focus 指令。
9. AI 在 Learn 模式可通过受限 AgentCommand 驱动同一 action runtime；无需模拟 DOM 点击。
10. 任一未知 action kind/version 均被明确拒绝；只有完整 versioned v1 session 才可路由到旧 renderer。
11. v2 typed evidence 从 evaluation、persistence 到 review 均不经过 `topic-answer` 字符串或 v1 reducer。
12. 新 Topic bundle 显式包含 actionTemplates；v2 bootstrap 不运行 primitive-to-action compiler。
13. 页面同时只存在一个活动 child action actor。
14. 新 Topic session 默认使用 v2；旧 pinned session 在迁移期仍可恢复和完成。

### 12.1 自动化验收证据

| 验收范围 | 代码/测试证据 |
| --- | --- |
| 单一 PageMachine/current child/统一 WorkspaceView | `frontend/src/action-runtime/pageRuntime.ts`、`projectWorkspaceView.ts`、one-child lifecycle 与 projector tests |
| preview → production Canvas | `ActionPresentation.preview`、`GeometryCanvas` fixed preview renderer、production Canvas component test |
| completion → DomainCommand → DraftWorld → redraw | `shared/actionWorld.ts`、geometry slice integration 与 immutable-model Canvas remount test |
| accepted/rejected/conflict/transport | page runtime targeted rollback/commit/retry tests；backend revision/idempotency tests |
| 普通交互零网络 | page runtime fetch spy 与 `ActionRuntimeFrame` browser contract test；remote checkpoint effect 只依赖 completed evidence |
| Assessment answer leak | assessment plan fixture 检查 input/coach/presentation；bundle teachingInput 仅 backend 合并 |
| typed evaluator/persistence/review | `topicTypedEvaluator.ts`、`practice_action_evaluations_v2`、`practice_action_worlds_v2`、typed result projection assertions |
| authoring/actionTemplates | bundle 280/280 records、990 actions；import validation；projector/scenario loader dependency checks |
| 剩余 action 与 validation policy | 9 kinds registry/machine tests，LocalTeaching 正确性与 ServerAuthoritative 结构边界测试 |
| Coach/AgentCommand/accessibility | directive schema、real input focus/entity highlight、aria-live、mouse/keyboard-focusable controls、mode/capability tests |
| v1/v2 pinning与回滚 | `action_runtime_version` persistence、pinned-v1 restore、new-session flag 与 pinned-v2 stability tests |

## 13. 成功指标

- 新 action 接入不修改 Canvas、CoachPanel 或 AnswerPanel 主体。
- 学生语义点击产生的网络请求数降为零。
- 新发布 Topic bundle 中 primitive-only authoring 数量为零。
- 新 Topic session 的 legacy primitive compiler、answer serializer 和 v1 reducer 调用量为零。
- AI coach 请求能够携带完整、结构化且可解释的当前学习上下文。
- 因跨组件状态不同步产生的错误反馈、按钮状态和恢复问题归零。

## 14. 待定产品决策

- Guided Practice 中哪些 action 允许公开完整目标参数。
- 页面隐藏/离开时远程保存未完成 draft 的保留期限、跨设备语义和隐私策略；普通语义点击不触发远程 checkpoint 已确定。
- AI 自动执行 action 前的确认策略是否按年龄、模式或 action 风险分级。
- Learn 模式是否记录完整 event trace，还是只记录 action completion。
