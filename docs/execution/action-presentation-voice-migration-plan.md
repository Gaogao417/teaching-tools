# Action Training / Presentation / Voice 分层迁移实施方案

## Document Status

- 状态：Proposed
- 日期：2026-08-12
- 媒体架构依据：[ADR-005](../adr/ADR-005-action-presentation-and-conversational-media.md)
- 训练架构依据：[ADR-006](../adr/ADR-006-local-practice-training-runtime.md)
- 问题依据：[Issue Inventory](./action-presentation-voice-issue-inventory.md)
- 待同步：VOICE-001 改为要求上游双写朗读文案后，ADR-005 §Public Contract View（Deterministic
  narration）与 Architectural Invariant #3 中“默认不增加字段 / 可选 spoken override”的措辞需收紧
  为“朗读文案默认双写”，作为独立 ADR 更新跟进。

## Outcome

迁移完成后：

1. Action Runtime 只负责 Action 状态、world、evidence、trace 和 WorkspaceView；
2. `TransientEmphasis` 仍是轻量前端 presentation metadata，但有明确的一次性消费生命周期；
3. 固定 Action 朗读通过预取/缓存和 streaming TTS 尽快发声，不调用 LLM；
4. 普通 Coach 可以在完整回答生成前开始播放第一段合格语音；
5. Full-duplex realtime 通过 provider-neutral 协议接入，支持打断和 Action context update；
6. 所有音频由一个 MediaSessionController 仲裁；
7. provider/model 不再泄漏到 shared browser business contract；
8. Practice 从 `server-authoritative` 迁移为答案公开、即时反馈的 `local-training`；
9. Practice 记录每个 Action 的耗时、正确/错误候选、BACK/CLEAR/hint/Coach 使用并异步上传；
10. Assessment 继续隐藏答案并使用 backend 权威判定；
11. 迁移过程中旧 HTTP/URL 音频链路和旧 Practice 提交链路都可独立回滚。

## Delivery Principles

- 先测量、再优化；验收指标是 browser first audio，不是 provider first packet。
- 先做边界和安全，再替换 transport；避免在现有 God Component 中继续叠功能。
- 先固定朗读，再普通 Coach 流式化；它没有 LLM 风险、收益最确定。
- Realtime 作为 Coach adapter，不进入 Action Runtime state machine。
- Practice 的 guard、attempt 记录和 Action 推进全部发生在本地；presentation/audio/network 都不能阻塞或
  改写判定结果。
- `hitTestable`、`candidate`、`advanceEnabled` 分开表达；合理但错误的候选必须到达 Action guard。
- Training telemetry 是可重试的客户端训练记录，不冒充可信 Assessment 成绩。
- 每个 worktree 有独占文件所有权；热点 integration 文件只由 integration owner 修改。
- 每个行为改动与测试在同一 commit；生成 bundle 只在 authoring source 变化时更新。
- 确定性朗读文案默认双写展示 LaTeX 与 spokenText：为 `TopicCoachScript` 朗读入口增加 spoken 同伴
  字段（`entrySpoken`），`latexToSpokenChinese` 仅作存量 fallback（见 VOICE-001）。这撤销原先
  “不修改 Topic authoring schema”的默认；ADR-005 对应条款的同步收紧列为 follow-up。

## Success Metrics

先在现状采集 p50/p95，再冻结目标。首轮建议目标：

| Flow | Metric | Initial target |
| --- | --- | --- |
| cached Action narration | `action_entered -> browser_audio_started` | p50 < 150 ms |
| cold Action narration | 同上 | p50 < 800 ms，p95 < 1.5 s |
| streaming Coach | `question_submitted -> browser_audio_started` | p50 < 1.5 s，且早于完整文本完成 |
| Live Coach | `student_turn_ended -> browser_audio_started` | p50 < 1.2 s |
| cancellation | 新 Action/打断到旧声音停止 | p95 < 150 ms |
| stale playback | restore/remount 后旧 emphasis 或旧 audio 重放 | 0 |
| math speech regression | reviewed corpus semantic mismatch | 0 blocking mismatch |
| local training feedback | `candidate_event -> feedback_or_next_state_rendered` | p95 < 100 ms，无网络依赖 |
| Practice evaluation traffic | 一道 Practice 题内 backend 数学判题请求 | 0 |
| Practice plan stability | 一道题从开始到完成的 plan fetch | 1；版本冲突/恢复除外 |
| training metric capture | 合理候选 attempt 与 Action completion 入队 | 100%，不被 Canvas 过滤 |
| training sync | 重试/重复上传导致的重复 result | 0 |

这些是产品验收目标，不是供应商 SLA。首次基线结果若明显不同，应记录网络地域、模型和设备后调整，
不能通过删除 browser timestamp 来“达标”。

## Target File Layout

采用渐进式目录迁移，不一次性重排整个 backend：

```text
web/shared/
├── actionRuntime.ts                 # Action/domain contract；最终移除 provider union
├── coachMedia.ts                    # provider-neutral v2 stream protocol
├── trainingRuntime.ts               # attempt/summary/checkpoint/result v1 contracts
└── speechText.ts                    # versioned math-to-spoken normalizer

web/frontend/src/
├── action-runtime/                  # PageRuntime/machines/projectors；无 audio/provider
│   ├── training/                    # local guard、attempt recorder、Action timer
│   └── presentation/emphasis/       # Action result -> transient targets
├── presentation/
│   ├── audio/                       # MediaSessionController + PCM queue
│   ├── narration/                   # teacher utterance/cache/prefetch/controller
│   ├── coach/                       # turn/live controllers and transcript projection
│   └── training/                    # immediate feedback projection；不拥有 correctness
├── persistence/training/            # persistent TrainingSyncQueue
└── api/                              # provider-neutral media/training clients

web/backend/src/
├── services/coach/
│   ├── application/                 # use cases, context builder, mode policy, segmenter
│   ├── ports/                       # text/asr/tts/realtime/cache/telemetry
│   └── adapters/                    # DashScope/Claude Code/CosyVoice implementations
├── services/training/
│   ├── application/                 # ingest checkpoint/result；不重判数学正确性
│   ├── progress/                    # mastery/trend/next exercise
│   └── ports/                       # record repository / telemetry
├── transport/
│   ├── http/coachRoutes.ts
│   ├── http/trainingRoutes.ts
│   └── ws/coachMediaServer.ts
└── index.ts                         # composition root only
```

旧文件在迁移期保留为 compatibility adapters，等删除门禁满足后再移除。

## Phase Plan

### Phase 0 — Freeze and Baseline

当前状态：Voice baseline hygiene 已完成；ADR-006 新增的 Training baseline 采集仍待执行。相关既有提交已经
按职责拆分：

```text
45c7a62 feat(topics): rewrite formal solutions across six similarity/ratio topics
bce2c1b feat(backend): derive parallel ratio from stem truth and regenerate bundle
95ec252 docs(skills): require deterministic Learn demonstration and teaching truth
f0bc687 feat(action-runtime): transient emphasis for just-changed canvas and board
d3b8ae9 docs(adr): record Action Presentation and Conversational Media layering
f0475e3 feat(action-runtime): deterministic Learn teaching with teacher voice coach
```

`f0475e3` 是当前 migration baseline candidate。正式创建 worktree 前仍需在该 SHA（或其经过验证的
后继 SHA）运行全量门禁，并把最终 SHA 记录为 `<baseline-sha>`。

交付：

- 保持上述既有功能 commits 独立可回滚；
- 新增 latency correlation id 和最小时间戳，不改变模型路径 — refs: OBS-001；ADR-005 §Observability Contract；
- 记录三条现状基线：Action speech、turn-based Coach、full-duplex realtime — refs: OBS-001；ADR-005 §Observability Contract；
- 记录 Practice 现状基线：每题 plan/evaluation/checkpoint 请求数、本地 guard 丢失的 wrong attempt、
  Action 局部耗时缺口与 `enabled` 过滤行为 — refs: ADR-006 §Context、§Verification Gates；
- 建立 feature flags/capability projection，默认行为保持不变 — refs: ARCH-002；ADR-005 §Compatibility Strategy。

门禁：

- 不能从当前 dirty tree 直接创建 migration worktree 并假定未提交文件会出现；
- baseline SHA 必须通过 frontend/backend build 与现有测试；
- latency 日志不得包含学生完整音频或私有答案；
- baseline fixture 必须分别固定 Practice 与 Assessment 的请求、payload 和统计行为，不能只按当前
  `server-authoritative` policy 合并记录。

上述 baseline 已经遵守以下职责拆分；后续不得在迁移分支中重新 squash 成一个大 commit：

1. `feat(authoring): repair reviewed solution rewrite pipeline and topic blueprints`
   - `.codex/skills/**`、Topic blueprints、authoring scripts、generated topic bundle；
2. `feat(action-runtime): add domain-command transient emphasis`
   - emphasis derivation、PageRuntime、renderer、CSS、emphasis tests，以及各 primitive 产生的 command；
3. `feat(action-runtime): add deterministic teacher speech`
   - shared speech text、teacher copy、TTS endpoint/client/hook/tests、Frame 接线。
4. `docs(architecture): define action presentation and voice migration`
   - ADR-005、问题清单、迁移/worktree 计划和文档索引。

若后续一个文件同时包含两组改动，使用交互式 patch staging；不要让 migration worktree 通过复制
其他 worktree 的未提交文件解决。

### Phase 1 — Provider-neutral Media and Learning-mode Contracts

交付：

- 新增 `coachMedia.ts` v2 contract 和 runtime guards — refs: ARCH-002、ARCH-003；ADR-005 §Target Layers、§Public Contract View；
- 新增 `trainingRuntime.ts` v1 attempt/summary/checkpoint/result/receipt contracts 和 runtime guards — refs:
  ADR-006 §Public Contract View；
- 将含糊的二值 `ValidationPolicy` 扩为 `LocalDemonstration | LocalTraining | ServerAuthoritative`，
  并显式声明 mode-safe local truth；本阶段只冻结 contract，不切换生产流量 — refs: ADR-006 §Central Decision、§Mode-safe plan；
- 定义 narration、turn stream、live session 的公开事件 — refs: COACH-001；ADR-005 §Public Contract View（Deterministic narration / Turn-based streaming coach / Live conversation）；
- backend 后续 ports/application 可以依赖该 contract，但本阶段不接具体 provider — refs: ARCH-003；ADR-005 §Target Layers、Architectural Invariant #7；
- provider/model 信息迁移到 server-only metadata — refs: ARCH-002；ADR-005 §Transport and Safety Rules #7、Architectural Invariant #7；
- 旧 endpoint 保持兼容 — refs: ADR-005 §Compatibility Strategy。

门禁：

- browser contract 中没有 Qwen/Omni/CosyVoice model union；
- Learn/Practice contract 有 local truth，Assessment runtime guard 拒绝任何 local truth 或等价字段；
- `TrainingAttemptEvent` 只表达语义候选，不允许 pointer/hover/每个键击成为 attempt；
- transport tests 证明未知事件 fail closed；
- 无 Action kind switch；无 Cue/Playback/Timeline。

### Phase 2 — Local Practice Training Migration

交付：

- Plan projector 将 Practice 映射为 `LocalTraining`，为当前 exercise 一次下发完整 Action list 与审核过的
  local truth；Assessment 继续移除全部 truth — refs: ADR-006 §Mode-safe plan；
- Action registry 为每个现有 kind/version 明确 candidate semantics、local validator 和语义 attempt boundary；
- Page Runtime 在 wrong candidate 时记录并即时反馈且保持当前状态，在 correct partial 时推进 child state，
  在 correct completion 时本地应用 DomainCommand、结束计时并切换 Action — refs: ADR-006 §Local attempt and completion；
- Canvas/Answer projection 将 `hitTestable`、`candidate`、`advanceEnabled` 分开，合理但错误候选仍发送语义事件；
- 新增 `AttemptRecorder`、`ActionTimer`，记录 correct/wrong、duration、BACK/CLEAR/hint/Coach、first attempt
  和 assistance level — refs: ADR-006 §Training telemetry、§Metrics Semantics；
- 新增持久 `TrainingSyncQueue` 与 backend Training Record/Progress ports；Action checkpoint、题目 result 和
  题组 summary 异步、幂等、可重试上传，不调用 typed evaluator；
- Practice 结果/历史读模型升级为 versioned training metrics；旧 session/result 继续可读；
- Assessment 继续走现有 typed evaluator、revision、commit 和 Review 链路。

门禁：

- Practice candidate event 到 feedback/next state 零 evaluation request，整道题默认只 GET 一次 plan；
- 本地 wrong candidate 进入 accuracy，Action state/world 不推进；correct completion 才应用 commands；
- 固定 fixtures 验证 semantic hit accuracy 与 Action first-try accuracy 不混用；
- offline 可以完成已加载题目，恢复网络后 checkpoint/result 只落库一次；
- Practice ingest 只做 envelope/invariant 校验，不 import/call private evaluator；
- Assessment payload leak tests 和 authoritative submission tests 保持通过；
- 训练反馈朗读/Coach/media 失败不改变 attempt count、计时和 completion。

### Phase 3 — Correctness and Realtime Hardening

并行修复：

- 数学口语化语义 — refs: VOICE-001、SPEECH-002；ADR-005 §Public Contract View（Deterministic narration）；
- emphasis pending consume/key scope/exhaustive mapping — refs: EMPH-001、EMPH-002；ADR-005 §Public Contract View（Transient presentation）、§Primary Flows #1、Architectural Invariant #2；
- realtime raw relay、ready race、limits、setup errors、resampling — refs: WS-001、WS-002、AUDIO-003；ADR-005 §Public Contract View（Live conversation）、§Transport and Safety Rules #4/#5；
- Assessment capability gate — refs: SAFE-001；ADR-005 §Transport and Safety Rules #6；
- 端到端 telemetry — refs: OBS-001；ADR-005 §Observability Contract。

门禁：

- reviewed speech corpus 通过；
- restore/remount 不重播旧强调；
- browser 不能发送 provider-specific event；
- upstream ready 前没有静默丢帧；
- Realtime 在 Assessment 明确不可用。

### Phase 4 — Deterministic Action Narration

交付：

- `MediaSessionController` — refs: AUDIO-001、AUDIO-002；ADR-005 §Public Contract View（Exclusive media session）、Architectural Invariant #5；
- `NarrationController` — refs: NARR-001；ADR-005 §Public Contract View（Deterministic narration）、§Primary Flows #2；
- current + next Action bounded prefetch — refs: NARR-001；ADR-005 §Primary Flows #2；
- memory cache 和稳定 cache key — refs: NARR-001、SPEECH-002；ADR-005 §Follow-up Contracts（SpeechCache）；
- AbortSignal/cancellation — refs: NARR-001；ADR-005 §Transport and Safety Rules #3；
- streaming TTS compatibility adapter — refs: STREAM-001（局部）；ADR-005 §Compatibility Strategy；
- autoplay blocked 的显式 UI 状态 — refs: AUDIO-002；ADR-005 §Public Contract View（Exclusive media session / BlockedByAutoplay）；
- Action narration 与 Coach reply 分离 replay handle — refs: AUDIO-001；ADR-005 §State Ownership；
- Practice wrong feedback 可以复用确定性 narration，但 guard/attempt/completion 必须先完成；播放不得成为
  Action Runtime effect — refs: ADR-006 §Voice and Coach Integration。

门禁：

- 固定朗读无 LLM 调用；
- cache hit 不发 provider request；
- Action 快速切换时旧音频和旧网络任务停止；
- 关闭语音不影响 Emphasis；关闭 Emphasis 不影响语音；
- fallback flag 可切回现有 `/api/action-speech` URL 模式。

### Phase 5 — Streaming Turn-based Coach

交付：

- `TextCoachEngine.streamReply` adapter — refs: ARCH-003；ADR-005 §Public Contract View（Backend effect ports / TextCoachEngine）；
- punctuation/math-aware `SpokenSegmenter` — refs: STREAM-001；ADR-005 §Follow-up Contracts（SpokenSegmenter）、§Primary Flows #3；
- `SpeechSynthesizer.stream` adapter — refs: ARCH-003；ADR-005 §Public Contract View（Backend effect ports / SpeechSynthesizer）；
- provider-neutral `CoachTurnEvent` WebSocket — refs: ARCH-002、STREAM-001；ADR-005 §Public Contract View（Turn-based streaming coach）；
- frontend CoachController 增量 transcript 和 audio queue — refs: COACH-001；ADR-005 §Target Layers（CoachController）、§Primary Flows #3；
- 完成后再把 typed `CoachDirective` 应用到 Action Runtime — refs: SAFE-001；ADR-005 §Primary Flows #3、Architectural Invariant #9；
- cancellation/backpressure/fallback — refs: STREAM-001、SAFE-001；ADR-005 §Transport and Safety Rules #3。

首版策略：

- Learn/Practice 开启；
- Assessment 继续确定性 Coach；
- 第一 segment 阈值较短，后续 segment 较长；
- 公式 token 必须作为原子，不在 `\frac`、根号、数字/单位中间切段；
- provider 失败时可回退到 deterministic directive，不回退到不受控的完整答案。

门禁：

- browser first audio 早于完整 LLM 文本完成；
- 任意 segment 只播放一次且顺序稳定；
- cancel 后没有后续 audio delta；
- 最终 directive schema/capability 校验仍存在；
- Practice hint/Coach 使用写入 assistance metrics；Assessment context 继续不含 local truth；
- 旧 `/api/action-coach` 可通过 flag 回滚。

### Phase 6 — Live Coach Adapter Migration

交付：

- 将现有 full-duplex relay 改为 `LiveCoachApplication + RealtimeVoiceProvider` adapter — refs: ARCH-003、WS-001；ADR-005 §Public Contract View（Live conversation / Backend effect ports / RealtimeVoiceProvider）；
- typed public WS protocol — refs: WS-001；ADR-005 §Public Contract View（Live conversation）、§Transport and Safety Rules #2；
- `Ready` 后才启动 capture — refs: WS-002；ADR-005 §Transport and Safety Rules #4；
- Action switch context update — refs: COACH-002；ADR-005 §Primary Flows #4、§Public Contract View（Live conversation / UpdateContext）；
- transcript 合并到统一 Coach presentation — refs: COACH-002、COACH-001；ADR-005 §State Ownership；
- session duration、concurrency、payload、backpressure 和 usage limits — refs: WS-001；ADR-005 §Transport and Safety Rules #1；
- 与 MediaSessionController 的独占/打断接线 — refs: AUDIO-001；ADR-005 §Public Contract View（Exclusive media session）、Architectural Invariant #5。

门禁：

- raw provider event 不跨 transport boundary；
- 长通话切换 Action 后回答基于新步骤；
- 开始 live session 会中断 narration/turn reply，结束后不自动恢复旧声音；
- 关闭 tab、断网、provider error 都释放 microphone、AudioContext 和 upstream socket。

### Phase 7 — Frame Decomposition and Legacy Removal

交付：

- `ActionRuntimeFrame` 只保留 page composition — refs: ARCH-001；ADR-005 §Central Decision、§Target Layers（Frontend）；
- 拆出 runtime persistence/Assessment evaluation container、TrainingSyncQueue、training metrics/feedback、Coach
  panel/controller、Narration status、surface adapters — refs: ARCH-001、COACH-001；ADR-005 §Target Layers（Frontend）、§State Ownership；ADR-006 §Module Responsibilities；
- 删除学生 UI 中的 provider selector；需要时只在开发设置中保留 capability override — refs: ARCH-002；ADR-005 §Architectural Invariant #7；
- 删除旧 provider-specific shared unions — refs: ARCH-002；ADR-005 §Compatibility Strategy；
- 在稳定窗口后删除整包 audio URL 和 raw relay compatibility path — refs: ARCH-003；ADR-005 §Compatibility Strategy；
- 在旧 Practice session 兼容窗口结束后，删除 Practice per-Action evaluation/re-fetch adapter；Assessment endpoint
  与 private evaluator 保留。

删除门禁：

- 新路径连续通过目标浏览器/设备矩阵；
- latency/cost/error dashboard 可用；
- rollback 演练完成；
- 没有仍在使用旧 endpoint 的客户端版本；
- 新 TrainingResult/Checkpoint 的 ingest、历史和 mastery 读模型已完成回滚演练；
- ADR 和 API docs 更新为 Implemented。

## Worktree Plan

### Integration Ownership Rule

以下热点文件在并行阶段禁止由子 worktree 修改，只由最终 integration worktree 接线：

- `web/frontend/src/action-runtime/react/ActionRuntimeFrame.tsx`
- `web/frontend/src/action-runtime/pageRuntime.ts`
- `web/frontend/src/action-runtime/projectWorkspaceView.ts`
- `web/frontend/src/pages/PracticePage.tsx`
- `web/frontend/src/api/client.ts`
- `web/frontend/src/utils/storage.ts`
- `web/backend/src/app.ts`
- `web/backend/src/index.ts`
- `web/shared/actionRuntime.ts`
- `docs/adr/README.md`
- `docs/README.md`

这样可以把并行冲突限制在新增模块，而不是让所有分支争用入口文件。

### Bootstrap Worktree — Contracts

| Field | Value |
| --- | --- |
| Branch | `codex/voice-contracts-v2` |
| Depends on | clean baseline SHA |
| Owns | new `web/shared/coachMedia.ts`、`web/shared/trainingRuntime.ts`、对应 guards/tests |
| Must not edit | integration hot files、provider implementations |
| Commits | `refactor(coach): add provider-neutral media v2 contracts`; `feat(training): add local training telemetry contracts` |

上述 commits 先进入 integration branch，后续 worktree 全部从“baseline + contracts”SHA 创建。

### Training Wave — Must Land Before Voice Wave A

Training Wave 从“baseline + contracts”创建。它先完成 ADR-006 的无 UI 接线模块；hot files 仍由 serial
integration 接线，避免与后续 emphasis/Frame worktree 同时改写 Page Runtime。

| Worktree / branch | Responsibility | Exclusive files | Expected commits |
| --- | --- | --- | --- |
| `wt-local-training-core` / `codex/local-training-core` | local guard、attempt recorder、Action timer、candidate semantics adapter | new `frontend/src/action-runtime/training/**`、tests；各 Action 只新增独立 local-validator fixture，不改 hot files | `feat(training): classify local action attempts`; `feat(training): measure action speed and accuracy` |
| `wt-training-sync` / `codex/training-sync` | persistent queue、idempotency、offline retry | new `frontend/src/persistence/training/**`、tests | `feat(training): queue non-blocking checkpoints and results` |
| `wt-training-backend` / `codex/training-records` | Training Record/Progress application、ports、repository、公开 route module | new `backend/src/services/training/**`、new `backend/src/transport/http/trainingRoutes.ts`、tests | `feat(training): ingest local training records`; `feat(training): update mastery from versioned results` |
| `wt-training-plan` / `codex/training-plan-projection` | Practice/Assessment mode-safe plan projection与 leak fixtures | `backend/src/services/actionRuntime/topicPlanProjector.ts`、projector tests | `refactor(training): project local truth only to learn and practice` |

Training Wave 合入 integration 时，由 integration owner 修改 `actionRuntime.ts`、`pageRuntime.ts`、
`projectWorkspaceView.ts`、`ActionRuntimeFrame.tsx`、`PracticePage.tsx`、API/app composition root，完成生产切流。
切流门禁通过后生成 `<training-sha>`；所有 Voice Wave A worktree 从该 SHA 创建。

### Voice Wave A — Four Parallel Worktrees

| Worktree / branch | Responsibility | Exclusive files | Expected commits |
| --- | --- | --- | --- |
| `wt-speech-normalizer` / `codex/speech-normalizer` | 修复数学口语语义与语料测试 | `web/shared/speechText.ts`、speech corpus/tests | `fix(speech): preserve math semantics in spoken Chinese` |
| `wt-emphasis` / `codex/emphasis-lifecycle` | 明确 pending consume、key scope、command 穷尽映射 | `action-runtime/projection/deriveTransientEmphasis.ts`、new `presentation/emphasis/**`、对应 tests；hot file 接线留给 integration | `fix(action-runtime): make transient emphasis explicitly one-shot` |
| `wt-realtime-hardening` / `codex/realtime-hardening` | typed relay mapping、ready race、limits、错误、resampler | `realtimeCoachRelay.ts`、`useRealtimeCoach.ts`、capture worklet、对应 tests | `fix(coach): harden realtime session boundaries`; `fix(audio): resample microphone input accurately` |
| `wt-media-session` / `codex/frontend-media-session` | 新统一播放器、PCM queue、取消与 autoplay state | new `frontend/src/presentation/audio/**`、tests | `feat(audio): add exclusive browser media session controller` |

Voice Wave A 分支不能接线 `ActionRuntimeFrame`。每个分支必须保持自己的新增模块可单测，并向 integration
说明最小接线 contract。

### Voice Wave B — Four Parallel Worktrees

Voice Wave B 从已合入 Voice Wave A 所需前置 contract 的 integration SHA 创建。

| Worktree / branch | Responsibility | Exclusive files | Expected commits |
| --- | --- | --- | --- |
| `wt-streaming-tts` / `codex/streaming-tts` | TTS port、DashScope streaming adapter、cache、公开 speech stream server | new `backend/services/coach/ports/**` 中 speech-owned files、`adapters/*Tts*`、`transport/ws/speech*`、tests | `feat(speech): stream deterministic narration audio`; `feat(speech): add bounded narration cache` |
| `wt-coach-stream` / `codex/coach-stream` | Text engine stream、segmenter、CoachTurn application 和 mode policy | new `backend/services/coach/application/**`、text-owned ports/adapters、tests | `feat(coach): stream policy-approved spoken segments`; `test(coach): cover cancellation and assessment gates` |
| `wt-presentation-controllers` / `codex/presentation-controllers` | Narration/Coach controllers、prefetch、transcript projection | new `frontend/src/presentation/narration/**`、`presentation/coach/**`、tests | `feat(narration): prefetch deterministic action speech`; `feat(coach): consume provider-neutral turn streams` |
| `wt-voice-observability` / `codex/voice-observability` | correlation id、阶段事件、server metrics 与 browser first-audio 上报 | new `backend/services/coach/observability/**`、`frontend/src/presentation/telemetry/**`、tests | `feat(observability): measure end-to-end voice latency and cancellation` |

如果 Voice Wave B 两个 backend 分支都需要同一个 port index，先各自 import 具体文件，统一 barrel export 留给
integration；不要为了 index.ts 产生无意义冲突。

### Training Migration-to-owner Matrix

| Item | Primary owner | Integration responsibility |
| --- | --- | --- |
| `TRN-001` 三种 validation strategy | contracts bootstrap + `wt-training-plan` | shared action envelope、capability negotiation、mode projection |
| `TRN-002` local guard/attempt semantics | `wt-local-training-core` | Page Runtime event routing与即时 feedback 接线 |
| `TRN-003` Action timer/accuracy | `wt-local-training-core` | Practice history/result read model 接线 |
| `TRN-004` async checkpoint/result | `wt-training-sync` + `wt-training-backend` | API/app composition、unload/restore/next exercise lifecycle |
| `TRN-005` hit-test/candidate/advance split | `wt-local-training-core` | Canvas/Answer projection、agent command、a11y 接线 |
| `TRN-006` Assessment isolation | `wt-training-plan` + `wt-training-backend` | private evaluator route 与 payload leak E2E 门禁 |

### Issue-to-owner Matrix

| Issues | Primary owner | Integration responsibility |
| --- | --- | --- |
| `VOICE-001`, `SPEECH-002` | `wt-speech-normalizer` | 切换唯一规范化入口与 cache version |
| `EMPH-001`, `EMPH-002` | `wt-emphasis` | Frame/surface acknowledgment 接线 |
| `WS-001`, `WS-002`, `AUDIO-003` | `wt-realtime-hardening` | capability flag、composition root 接线 |
| `AUDIO-001`, `AUDIO-002` | `wt-media-session` | 移除旧播放器所有权并统一 replay UI |
| `NARR-001` | `wt-streaming-tts` + `wt-presentation-controllers` | 接线 prefetch/cache/cancel 与 URL fallback |
| `STREAM-001` | `wt-streaming-tts` + `wt-coach-stream` | 公开 stream route/client 和 feature flag |
| `SAFE-001` | `wt-coach-stream` + `wt-realtime-hardening` | Assessment 默认关闭并做 E2E 门禁 |
| `OBS-001` | `wt-voice-observability` | 在 transport/controllers 注入 correlation hooks |
| `COACH-002` | `wt-realtime-hardening` + `wt-presentation-controllers` | Action switch context update 与统一 transcript 接线 |
| `ARCH-001` | serial integration | 拆 Frame，保持页面行为不变 |
| `ARCH-002`, `ARCH-003`, `COACH-001` | contracts bootstrap + serial integration | 移除 provider union、注入 ports、保留 compatibility adapters |
| `CODE-001` | 对应文件 owner | integration 逐项核销，不建独立 cleanup commit |

### Serial Integration Worktree

| Field | Value |
| --- | --- |
| Branch | `codex/action-presentation-voice-migration` |
| Owns | 所有 integration hot files、feature flags、capability wiring、compatibility adapters、docs status |
| Responsibilities | 按顺序 cherry-pick，接线，处理 contract evolution，跑全量门禁，维护 rollback |

建议 cherry-pick 顺序：

1. provider-neutral media + training contracts；
2. local training core；
3. training sync queue；
4. training backend；
5. mode-safe plan projection；
6. integration-only local-training wiring，并冻结 `<training-sha>`；
7. speech normalizer；
8. emphasis lifecycle；
9. realtime hardening；
10. frontend MediaSession；
11. backend streaming TTS；
12. backend Coach stream；
13. frontend narration/Coach controllers；
14. integration-only voice wiring commit；
15. frame decomposition commit；
16. compatibility cleanup commit（稳定窗口后，不与首发混在一起）。

Integration-only commits：

```text
refactor(practice): switch guided practice to local training
feat(training): wire non-blocking performance sync
refactor(app): wire provider-neutral coach media services
refactor(action-ui): split runtime, narration and coach presentation
feat(coach): enable streaming voice behind capability flag
docs(architecture): mark action presentation migration implemented
```

不要把所有 cherry-pick 冲突、generated bundle、CSS 调整和旧 API 删除压进一个 commit。

## Suggested Worktree Commands

在当前 dirty tree 被拆分并得到 `<baseline-sha>` 后：

```bash
git worktree add ../tt-voice-integration -b codex/action-presentation-voice-migration <baseline-sha>
git worktree add ../tt-voice-contracts -b codex/voice-contracts-v2 <baseline-sha>
```

contracts 合入 integration 后，以 `<contracts-sha>` 创建 Training Wave：

```bash
git worktree add ../tt-local-training -b codex/local-training-core <contracts-sha>
git worktree add ../tt-training-sync -b codex/training-sync <contracts-sha>
git worktree add ../tt-training-backend -b codex/training-records <contracts-sha>
git worktree add ../tt-training-plan -b codex/training-plan-projection <contracts-sha>
```

Training Wave 接线完成并得到 `<training-sha>` 后创建 Voice Wave A：

```bash
git worktree add ../tt-speech-normalizer -b codex/speech-normalizer <training-sha>
git worktree add ../tt-emphasis -b codex/emphasis-lifecycle <training-sha>
git worktree add ../tt-realtime -b codex/realtime-hardening <training-sha>
git worktree add ../tt-media-session -b codex/frontend-media-session <training-sha>
```

Voice Wave A 合入并得到 `<wave-a-sha>` 后创建 Voice Wave B：

```bash
git worktree add ../tt-streaming-tts -b codex/streaming-tts <wave-a-sha>
git worktree add ../tt-coach-stream -b codex/coach-stream <wave-a-sha>
git worktree add ../tt-presentation -b codex/presentation-controllers <wave-a-sha>
git worktree add ../tt-voice-observability -b codex/voice-observability <wave-a-sha>
```

每个 worktree：

- 开始前记录 `git status --short`，必须干净；
- 只 stage 所有权表中的路径；
- 不重写其他 worktree 的提交；
- 测试与行为同 commit；
- 完成后把 commit SHA、测试结果、已知限制交给 integration owner。

## Commit and Verification Gates

### Per-commit

- shared/backend/frontend TypeScript 编译覆盖到相关包；
- 相关 unit/contract tests；
- `git diff --check`；
- 不含生成 bundle 的无关变化；
- commit message 只描述一个可回滚行为。

### After each cherry-pick wave

Frontend：

```bash
cd web/frontend
npm run build
npm test
```

Backend：

```bash
cd web/backend
npm run build
npm test
```

Architecture/static gates：

- `LocalTraining` 与 `ServerAuthoritative` 是不同 contract 分支，不能再用 `mode !== learn` 合并；
- Practice plan 含 local truth，Assessment plan 的 schema/leak test 禁止 local truth；
- `training/**`、Training ingest 和 Practice route 不 import/call private evaluator；
- Canvas/Answer surface 不用 `enabled=false` 吞掉合理但错误的候选事件；
- presentation/audio/Coach 不写 attempt count、Action timer 或 correctness state；
- `ActionRuntimeFrame` 不 import provider adapter；
- `action-runtime/**` 不 import Audio/MediaRecorder/WebSocket provider client；
- browser shared contract 不出现具体模型 union；
- renderer/PageRuntime 不按 Action kind 推导 emphasis；
- checkpoint/sessionStorage/DB schema 不出现 transient emphasis；
- public WS handler 不原样 forward browser provider event。

### End-to-end gates

覆盖：

- Practice 错误候选即时反馈、状态不推进、wrong attempt +1；
- Practice 正确 partial/complete、DomainCommand 本地应用、Action timer 和下一 Action 切换；
- semantic hit accuracy、Action first-try accuracy、BACK/CLEAR/hint/Coach assistance fixtures；
- Practice 单题一次 plan、零 evaluator 请求、离线完成、恢复后幂等 flush；
- Training checkpoint/result revision conflict、queue 容量与降级 telemetry；
- Assessment 无 local truth 且继续 backend authoritative accepted/rejected；
- Learn 首步 autoplay blocked 与解锁后重播；
- current/next Action narration cache hit/miss；
- 快速 Action 切换取消旧 TTS；
- 普通 Coach 第一段音频早于完整回复；
- interrupt/backpressure/断网/provider timeout；
- Live Coach 建连 ready、语音输入、barge-in、Action context update；
- Assessment 不开放未经批准的 streaming/live；
- restore、BACK、CLEAR、reject、conflict、undo-recomplete 的 emphasis 生命周期；
- reduced-motion；
- Chrome/Safari 的 48 kHz 与 44.1 kHz capture。

## Rollback Strategy

Feature flags 建议表达产品能力而不是 provider：

```text
PRACTICE_VALIDATION_MODE=server-authoritative | local-training
TRAINING_SYNC_MODE=legacy-evaluation | async-records | local-only
ACTION_NARRATION_TRANSPORT=url | stream | off
COACH_TURN_TRANSPORT=request-response | stream
COACH_LIVE_ENABLED=true | false
COACH_STREAM_ASSESSMENT_ENABLED=false
```

回滚顺序：

1. 关闭 live；
2. stream Coach 回到 request-response；
3. stream narration 回到 URL TTS；
4. 若 Training ingest/历史读模型异常，先切 `TRAINING_SYNC_MODE=local-only`，保留本地训练与持久队列；
5. 若 local-training correctness 本身有阻断性回归，才把未迁移的新 Practice session 临时切回 legacy
   evaluation；已创建 session 按 pinned validation mode 恢复，不能中途静默换语义；
6. 保留新的分层模块和正确性修复，不回滚数学口语化、WS 安全和 emphasis lifecycle；
7. 只有 contract 不兼容时才回滚 v2 transport，Assessment Runtime/DB 不受影响。

## Definition of Done

- [ ] ADR-005 标记 Accepted/Implemented；
- [ ] ADR-006 标记 Implemented，旧 server-authoritative Practice session 兼容/删除门禁已记录；
- [ ] Issue Inventory 的 P0/P1 全部关闭或有明确延期 ADR；
- [ ] Learn / Practice / Assessment 分别绑定 LocalDemonstration / LocalTraining / ServerAuthoritative；
- [ ] Practice 一道题只加载一次完整 plan，Action 切换零 backend 数学判题请求；
- [ ] wrong candidate、correct candidate、BACK/CLEAR/hint/Coach 和 Action duration 有稳定 versioned 指标；
- [ ] `hitTestable` / `candidate` / `advanceEnabled` 拆分后错误候选不会被 Canvas/Answer surface 吞掉；
- [ ] TrainingSyncQueue 支持 offline、幂等、revision conflict、容量/TTL 与 best-effort flush；
- [ ] backend Training Record/Progress service 不重新判定 Practice 数学正确性；
- [ ] Assessment payload 无 local truth，仍使用 private evaluator 和权威 result；
- [ ] `ActionRuntimeFrame` 不再拥有录音实现、provider selector、audio element 和 realtime protocol；
- [ ] Action Runtime 不 import media/AI infrastructure；
- [ ] 固定朗读有预取、缓存、取消和显式 autoplay 状态；
- [ ] streaming Coach 的 browser first audio 可度量且早于完整回答；
- [ ] Live Coach 使用 typed public protocol 并能更新当前 Action context；
- [ ] Assessment 默认安全关闭生成式 streaming/live；
- [ ] 一个 MediaSessionController 保证无音频重叠；
- [ ] Emphasis 消费后清除且从不持久化；
- [ ] 数学口语语料零 blocking mismatch；
- [ ] 所有 fallback/rollback 开关完成演练；
- [ ] frontend/backend 全量 build/test 通过；
- [ ] 提交历史按上述依赖顺序可逐个回滚。
