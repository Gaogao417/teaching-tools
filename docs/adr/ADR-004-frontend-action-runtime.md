# ADR-004：前端 Action Runtime 与后端教学计划边界

## Status

Proposed · 2026-08-10

## Context

ADR-001 确立了 runtime-first：backend `EnginePlugin` 持有真值、判题并生成
`ExerciseRuntimeSpec`，frontend 消费投影并提交 `RuntimeActionEvent`。ADR-003 又把多步几何
工具建模为 frontend XState machine，但作用域只覆盖 GeometryCanvas 内的一次 tool run。

生产接线后暴露出两套状态系统的重叠：

- backend engine、`FlowSpec` 与 `ServerRuntimeState` 都表达当前步骤和完成状态；
- frontend XState、React state 与 `ClientDraftState` 都表达当前选择、answer 和错误反馈；
- coach 状态独立存在于 `TopicRuntimeFrame` 和 `draft.topicCoach`；
- action evidence 经 `ClientDraftState → RuntimeActionEvent.value → primitive string` 多次序列化；
- AI 若要理解或驱动页面，只能拼接这些状态或模拟 UI。

与此同时，每次 Canvas 语义点击没有必要往返 backend。实时交互需要低延迟，pointer/preview
更不应跨网络；backend 的核心价值是提供内容、保护私有真值、持久化正式进度并运行 AI coach。

## Decision

采用 **backend 教学计划 + frontend Action Runtime**。

1. frontend XState 是当前页面未提交交互的唯一事实来源。
2. frontend 使用一个 page machine 编排 action list，同时只运行一个当前 child action machine。
3. backend 返回领域级 `ExercisePlan`，不返回可执行 JavaScript/XState machine，也不以完整 UI projection 远程控制页面。
4. frontend 通过本地、版本化 `ActionMachineRegistry` 将 `ActionContract.kind + version + input` 实例化为 machine。
5. machine snapshot 经过纯 projector 生成包含 Canvas、answer、coach 与 controls 的 `WorkspaceView`。
6. backend 保留 scenario/version、私有 answer key、权威判题、session、正式 world commit、AI coach 和结果统计。
7. 前后端只在 bootstrap、AI 求助、checkpoint 和权威提交时通信；普通语义点击在 frontend 完成。
8. Learn/Guided 可用公开目标在 frontend 本地判断；Assessment 的私有正确性只能由 backend 判断。
9. frontend 将学生行为表示为 typed `StudentEvent`、`StudentTrace` 与 `ActionEvidence`；目标协议不再使用自由格式 `RuntimeActionEvent.value` 或 primitive answer string。
10. AI 通过结构化 `CoachDirective` 和受限 `AgentCommand` 参与同一个 runtime，不直接操作 DOM、React state 或 JSXGraph。

该决策修订 ADR-001 的“backend 组装完整页面 runtime projection”边界，但保留其“backend
持有私有真值与正式学习状态”原则；它扩大 ADR-003 的 XState 作用域，从 Canvas tool machine
提升为页面级 Action Runtime，同时保留 GeometryCanvas 作为工具无关 renderer。

## Target Architecture

```text
Offline Authoring
    │ approved Scenario + private answer key
    ▼
Backend
├── ExercisePlan Projector ───────────────┐
├── Private Evaluator ◄──── Evidence      │
├── Session / Progress / Review           │
└── AI Coach ◄──────────── StudentTrace   │
                    │                     │
                    │ Plan / Directive    │
                    ▼                     │
Frontend Action Runtime                   │
├── Page Machine                          │
├── ActionMachineRegistry                 │
├── Current Action Machine                │
├── WorkspaceView Projector               │
└── Evidence / Trace Collector            │
        │                                 │
        ├── GeometryCanvas                │
        ├── AnswerPanel                   │
        ├── CoachPanel                    │
        └── ActionControls                │
```

依赖方向：

```text
UI components
    → WorkspaceView + WorkspaceEvent
    → Frontend Action Runtime
    → shared plan/evidence contracts
    → backend ports

Backend never imports frontend machines or renderers.
Frontend never imports private answer keys or engine state.
```

## Public Contracts

以下声明描述目标边界；它们是语言无关的协议，不要求生产代码使用 F#。

```fsharp
module LearningRuntimeContracts

type LearningMode =
    | Learn
    | GuidedPractice
    | Assessment

type ValidationPolicy =
    | LocalTeaching
    | ServerAuthoritative

type ActionContract = {
    actionId: string
    kind: string
    version: int
    instruction: string
    input: ActionInput
    capabilities: string list
    answerSlots: AnswerSlotSpec list
    validationPolicy: ValidationPolicy
}

type ExercisePlan = {
    planVersion: int
    exerciseId: string
    revision: int
    mode: LearningMode
    metadata: ExerciseMetadata
    world: WorldProjection
    coach: CoachProfile
    actions: ActionContract list
    currentActionId: string
}

type CanvasView
type AnswerView
type CoachView
type ControlView

type WorkspaceView = {
    canvas: CanvasView option
    answer: AnswerView
    coach: CoachView
    controls: ControlView
}

type WorkspaceEvent =
    | StudentEvent of StudentEvent
    | CoachDirectiveReceived of CoachDirective
    | EvaluationReceived of EvaluationResult
    | RestoreRequested

type ActionCompletion = {
    actionId: string
    evidence: ActionEvidence
    localCommands: DomainCommand list
}
```

`ActionInput` 与 `ActionEvidence` 是按 `kind + version` 识别的判别数据。跨网络进入的未知类型
必须经过 runtime schema validation；不得在 `obj`/`Any` 边界直接强制转换。

### Frontend runtime contract

```fsharp
module FrontendActionRuntime

type RuntimeError =
    | UnsupportedPlanVersion of int
    | UnsupportedAction of kind: string * version: int
    | InvalidActionInput of actionId: string
    | InvalidDirective of string
    | RevisionConflict of expected: int * actual: int

type ActionMachineRegistry =
    abstract Supports:
        kind: string * version: int
        -> bool

    abstract Create:
        contract: ActionContract
        -> Result<ActionActor, RuntimeError>

type PageRuntime =
    abstract Start:
        ExercisePlan
        -> Result<unit, RuntimeError>

    abstract Send:
        WorkspaceEvent
        -> unit

    abstract View:
        unit
        -> WorkspaceView

    abstract CurrentTrace:
        unit
        -> StudentTrace
```

### Backend ports

```fsharp
module BackendLearningPorts

type EvaluationRequest = {
    sessionId: string
    exerciseId: string
    actionId: string
    revision: int
    evidence: ActionEvidence
    idempotencyKey: string
}

type EvaluationResult =
    | Accepted of committed: WorldDelta * nextActionId: string option * revision: int
    | Rejected of diagnosis: Diagnosis * revision: int
    | Conflict of latestPlan: ExercisePlan

type Checkpoint = {
    sessionId: string
    exerciseId: string
    completedActions: ActionCompletion list
    currentActionId: string
    revision: int
}

type CoachRequest = {
    sessionId: string
    exerciseId: string
    trace: StudentTrace
    studentMessage: string option
}

type LearningBackend =
    abstract LoadPlan:
        sessionId: string
        -> Async<Result<ExercisePlan, LoadPlanError>>

    abstract Evaluate:
        EvaluationRequest
        -> Async<Result<EvaluationResult, EvaluationTransportError>>

    abstract SaveCheckpoint:
        Checkpoint
        -> Async<Result<unit, CheckpointError>>

    abstract AskCoach:
        CoachRequest
        -> Async<Result<CoachDirective, CoachError>>
```

## State Ownership

| 状态 | 唯一权威所有者 | 说明 |
| --- | --- | --- |
| pointer、hover、animation | renderer | 高频且不可恢复 |
| 当前 action 内选择与 answer draft | frontend action machine | 不逐次请求 backend |
| 当前 action index、页面反馈、controls | frontend page machine | 从 snapshot 投影 WorkspaceView |
| 已完成的本地教学 action | frontend，checkpoint 后由 session 记录 | Learn 可先本地完成 |
| 私有数学正确性 | backend evaluator | Assessment 不下发答案 |
| committed world 与 revision | backend | frontend 可有乐观 projection，但以后端提交结果为准 |
| 题目索引、attempts、完成与 progression | backend session | 跨设备、可审计 |
| coach 当前展示 | frontend page machine | directive 是输入，不是第二份状态 |
| coach 推理、对话历史摘要 | backend AI service | frontend 只保留当前对话展示与必要 trace |

## Action Machine Placement

machine implementation 随 frontend bundle 发布：

```text
make-parallel@1       → frontend machine factory
intersect-carriers@1 → frontend machine factory
enter-equation@1     → frontend machine factory
```

backend 只能引用已发布的 `kind + version`。frontend 在 bootstrap 时进行 capability negotiation；
若 plan 使用未知 action，必须返回明确错误或切换到 versioned legacy renderer。

不采用“backend 把 machine 一起发给 frontend”，因为 XState config 中的 guards、actions、actors
和 effects 最终需要函数实现。将其序列化会导致远程代码执行、CSP、类型安全、版本兼容和审计问题。
若未来确有第三方动态 action 需求，应另立 ADR 设计受限、无任意函数的声明式 workflow DSL。

## Interaction and Rendering Boundary

Page machine 不直接渲染 UI。snapshot 经过 projector，UI 只读 `WorkspaceView`：

```text
snapshot + world + pointer(optional renderer input)
                ↓
WorkspaceView projector
                ↓
CanvasView / AnswerView / CoachView / ControlView
```

约束：

- `GeometryCanvas` 只消费 CanvasView 与 WorldProjection；
- Canvas 只按 entity affordance 命中，不读取正确答案；
- AnswerPanel 只渲染槽位和发送 AnswerEvent；
- CoachPanel 只渲染 CoachView 和发送 help/chat event；
- React 不通过 action kind 或 machine state 名称推断流程；
- AI、keyboard、pointer、replay 最终进入同一个 WorkspaceEvent/DomainCommand 端口。

## Communication Policy

| 时机 | 是否阻塞本地交互 | Payload |
| --- | --- | --- |
| 进入/恢复题目 | 是 | ExercisePlan |
| 普通语义点击 | 否，不发送 | local WorkspaceEvent |
| pointer/hover | 否，不发送 | renderer local state |
| 学生求助/连续错误 | 否 | StudentTrace + optional message |
| action checkpoint | 否，异步 | completed action evidence |
| server-authoritative submit | 是，仅提交动作 | EvaluationRequest |
| telemetry batch | 否 | bounded StudentEvent batch |

## Validation and Truth Boundary

frontend local machine 可以验证：

- 当前事件类型是否合法；
- 必需槽位是否填满；
- action 顺序与 public constraints；
- Learn/Guided 中明确公开的目标参数。

backend evaluator 必须验证：

- session、exercise、action 和 revision 是否匹配；
- evidence schema 与引用对象是否合法；
- Assessment 私有答案与数学关系；
- action 是否允许正式提交；
- 重试是否幂等；
- world delta 与 progression 是否可以 commit。

frontend snapshot 与 StudentTrace 只用于恢复建议、观测和 AI context，不能作为权威计分依据。

## AI Boundary

`CoachDirective` 只包含声明式效果，例如 message、tone、highlight、focus 与 suggestion。
`AgentCommand` 只能引用 frontend registry 已知的 command，并受当前 action capability 与 mode policy
约束。Learn 可允许自动演示；Guided 默认需要学生确认；Assessment 禁止代做。

AI 不得发送：

- JavaScript、XState config 或函数源码；
- CSS selector、DOM path 或 JSXGraph handle；
- 未经 action capability 声明的任意 command；
- Assessment 中会直接完成答案的操作。

## Persistence and Recovery

- backend session 持久化 plan/scenario version、正式 evaluation、completed action evidence、committed world 与 revision。
- frontend 可在浏览器保存当前 action 的 versioned partial snapshot；恢复时必须验证 plan revision 与 machine version。
- action 完成后异步 checkpoint；Assessment 提交以 evaluator 返回的 revision 为准。
- 不长期在 backend 内存保留每个学生的 XState actor；backend 保存领域 checkpoint，而不是 frontend actorRef。
- machine snapshot 跨版本不保证兼容；版本不匹配时以 completed evidence 重放，未提交 partial 可以安全丢弃并向学生说明。

## Consequences

### Positive

- Canvas、answer、coach 和 controls 共享一个实时状态源。
- 普通交互不受网络延迟影响。
- backend 不再维护页面级 UI projection 分支。
- AI 得到结构化、可解释的学生状态，也能通过受限工具端口复用 action runtime。
- typed evidence 取代多层字符串 serializer。
- action machine 可单测、回放、复用并按版本发布。

### Costs

- frontend 承担更强的 runtime、恢复与 contract validation 责任。
- Learn/Guided 与 Assessment 必须维护明确的答案公开策略。
- 迁移期需要同时支持 `ExerciseRuntimeSpec v1` 和 `ExercisePlan v2`。
- action kind/version 成为前后端发布协调点。
- AI trace、checkpoint 和 evaluation 需要新的 API 与持久化投影。

## Invariants

1. 同一种实时状态不得同时由 React、XState 与 backend runtime 独立维护。
2. backend 不发送可执行代码；frontend 不执行远程 guard/action/effect。
3. frontend 同时只运行一个当前 action actor。
4. pointer/hover 不进入网络协议。
5. Assessment 私有真值不进入 ExercisePlan、StudentTrace 或 frontend bundle。
6. 所有跨网络 action/evidence/directive 都有 kind/version 和 runtime schema validation。
7. AI 与人类操作共享语义端口，但权限由 mode policy 限制。
8. backend committed world revision 是跨设备恢复与正式进度的唯一事实来源。

## Relationship to Existing ADRs

- ADR-001：保留 backend 私有真值、判题和 session；替换“backend 生成完整页面 runtime projection”为领域 `ExercisePlan`。
- ADR-002：不变；离线 authoring 与在线学生 runtime 继续分离。
- ADR-003：保留 GeometryModel、语义事件、projector 和工具无关 Canvas；将 XState 从 Canvas tool 层提升为页面 Action Runtime，并拆分组合 action。

## Unresolved Decisions

- `ExercisePlan v2` 是新 endpoint，还是现有 start/restore response 的 versioned variant。
- Guided Practice 的哪些 action 使用 LocalTeaching，哪些仍需 backend evaluator。
- 浏览器 partial checkpoint 的存储介质、过期时间和跨设备预期。
- AI Coach 使用请求/响应、SSE 还是 WebSocket；该选择不改变 Action Runtime 边界。
- WorldDelta 首批是否只支持整份 world replacement，还是立即支持 typed patch。
