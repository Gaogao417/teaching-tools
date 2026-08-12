# Action Presentation / Voice 分层迁移实施方案

## Document Status

- 状态：Proposed
- 日期：2026-08-12
- 架构依据：[ADR-005](../adr/ADR-005-action-presentation-and-conversational-media.md)
- 问题依据：[Issue Inventory](./action-presentation-voice-issue-inventory.md)

## Outcome

迁移完成后：

1. Action Runtime 只负责 Action 状态、world、evidence、trace 和 WorkspaceView；
2. `TransientEmphasis` 仍是轻量前端 presentation metadata，但有明确的一次性消费生命周期；
3. 固定 Action 朗读通过预取/缓存和 streaming TTS 尽快发声，不调用 LLM；
4. 普通 Coach 可以在完整回答生成前开始播放第一段合格语音；
5. Full-duplex realtime 通过 provider-neutral 协议接入，支持打断和 Action context update；
6. 所有音频由一个 MediaSessionController 仲裁；
7. provider/model 不再泄漏到 shared browser business contract；
8. 迁移过程中旧 HTTP/URL 音频链路可随时回滚。

## Delivery Principles

- 先测量、再优化；验收指标是 browser first audio，不是 provider first packet。
- 先做边界和安全，再替换 transport；避免在现有 God Component 中继续叠功能。
- 先固定朗读，再普通 Coach 流式化；它没有 LLM 风险、收益最确定。
- Realtime 作为 Coach adapter，不进入 Action Runtime state machine。
- 每个 worktree 有独占文件所有权；热点 integration 文件只由 integration owner 修改。
- 每个行为改动与测试在同一 commit；生成 bundle 只在 authoring source 变化时更新。
- 不修改 Topic authoring schema，除非真实语料证明必须增加 optional spoken override。

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

这些是产品验收目标，不是供应商 SLA。首次基线结果若明显不同，应记录网络地域、模型和设备后调整，
不能通过删除 browser timestamp 来“达标”。

## Target File Layout

采用渐进式目录迁移，不一次性重排整个 backend：

```text
web/shared/
├── actionRuntime.ts                 # Action/domain contract；最终移除 provider union
├── coachMedia.ts                    # provider-neutral v2 stream protocol
└── speechText.ts                    # versioned math-to-spoken normalizer

web/frontend/src/
├── action-runtime/                  # PageRuntime/machines/projectors；无 audio/provider
│   └── presentation/emphasis/       # Action result -> transient targets
├── presentation/
│   ├── audio/                       # MediaSessionController + PCM queue
│   ├── narration/                   # teacher utterance/cache/prefetch/controller
│   └── coach/                       # turn/live controllers and transcript projection
└── api/                             # provider-neutral HTTP/WS clients

web/backend/src/
├── services/coach/
│   ├── application/                 # use cases, context builder, mode policy, segmenter
│   ├── ports/                       # text/asr/tts/realtime/cache/telemetry
│   └── adapters/                    # DashScope/Claude Code/CosyVoice implementations
├── transport/
│   ├── http/coachRoutes.ts
│   └── ws/coachMediaServer.ts
└── index.ts                         # composition root only
```

旧文件在迁移期保留为 compatibility adapters，等删除门禁满足后再移除。

## Phase Plan

### Phase 0 — Freeze and Baseline

当前状态：baseline hygiene 已完成。相关提交已经按职责拆分：

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
- 新增 latency correlation id 和最小时间戳，不改变模型路径；
- 记录三条现状基线：Action speech、turn-based Coach、full-duplex realtime；
- 建立 feature flags/capability projection，默认行为保持不变。

门禁：

- 不能从当前 dirty tree 直接创建 migration worktree 并假定未提交文件会出现；
- baseline SHA 必须通过 frontend/backend build 与现有测试；
- latency 日志不得包含学生完整音频或私有答案。

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

### Phase 1 — Provider-neutral Contracts and Composition Boundaries

交付：

- 新增 `coachMedia.ts` v2 contract 和 runtime guards；
- 定义 narration、turn stream、live session 的公开事件；
- backend 后续 ports/application 可以依赖该 contract，但本阶段不接具体 provider；
- provider/model 信息迁移到 server-only metadata；
- 旧 endpoint 保持兼容。

门禁：

- browser contract 中没有 Qwen/Omni/CosyVoice model union；
- transport tests 证明未知事件 fail closed；
- 无 Action kind switch；无 Cue/Playback/Timeline。

### Phase 2 — Correctness and Realtime Hardening

并行修复：

- 数学口语化语义；
- emphasis pending consume/key scope/exhaustive mapping；
- realtime raw relay、ready race、limits、setup errors、resampling；
- Assessment capability gate；
- 端到端 telemetry。

门禁：

- reviewed speech corpus 通过；
- restore/remount 不重播旧强调；
- browser 不能发送 provider-specific event；
- upstream ready 前没有静默丢帧；
- Realtime 在 Assessment 明确不可用。

### Phase 3 — Deterministic Action Narration

交付：

- `MediaSessionController`；
- `NarrationController`；
- current + next Action bounded prefetch；
- memory cache 和稳定 cache key；
- AbortSignal/cancellation；
- streaming TTS compatibility adapter；
- autoplay blocked 的显式 UI 状态；
- Action narration 与 Coach reply 分离 replay handle。

门禁：

- 固定朗读无 LLM 调用；
- cache hit 不发 provider request；
- Action 快速切换时旧音频和旧网络任务停止；
- 关闭语音不影响 Emphasis；关闭 Emphasis 不影响语音；
- fallback flag 可切回现有 `/api/action-speech` URL 模式。

### Phase 4 — Streaming Turn-based Coach

交付：

- `TextCoachEngine.streamReply` adapter；
- punctuation/math-aware `SpokenSegmenter`；
- `SpeechSynthesizer.stream` adapter；
- provider-neutral `CoachTurnEvent` WebSocket；
- frontend CoachController 增量 transcript 和 audio queue；
- 完成后再把 typed `CoachDirective` 应用到 Action Runtime；
- cancellation/backpressure/fallback。

首版策略：

- Learn/Guided 开启；
- Assessment 继续确定性 Coach；
- 第一 segment 阈值较短，后续 segment 较长；
- 公式 token 必须作为原子，不在 `\frac`、根号、数字/单位中间切段；
- provider 失败时可回退到 deterministic directive，不回退到不受控的完整答案。

门禁：

- browser first audio 早于完整 LLM 文本完成；
- 任意 segment 只播放一次且顺序稳定；
- cancel 后没有后续 audio delta；
- 最终 directive schema/capability 校验仍存在；
- 旧 `/api/action-coach` 可通过 flag 回滚。

### Phase 5 — Live Coach Adapter Migration

交付：

- 将现有 full-duplex relay 改为 `LiveCoachApplication + RealtimeVoiceProvider` adapter；
- typed public WS protocol；
- `Ready` 后才启动 capture；
- Action switch context update；
- transcript 合并到统一 Coach presentation；
- session duration、concurrency、payload、backpressure 和 usage limits；
- 与 MediaSessionController 的独占/打断接线。

门禁：

- raw provider event 不跨 transport boundary；
- 长通话切换 Action 后回答基于新步骤；
- 开始 live session 会中断 narration/turn reply，结束后不自动恢复旧声音；
- 关闭 tab、断网、provider error 都释放 microphone、AudioContext 和 upstream socket。

### Phase 6 — Frame Decomposition and Legacy Removal

交付：

- `ActionRuntimeFrame` 只保留 page composition；
- 拆出 runtime persistence/evaluation container、Coach panel/controller、Narration status、surface adapters；
- 删除学生 UI 中的 provider selector；需要时只在开发设置中保留 capability override；
- 删除旧 provider-specific shared unions；
- 在稳定窗口后删除整包 audio URL 和 raw relay compatibility path。

删除门禁：

- 新路径连续通过目标浏览器/设备矩阵；
- latency/cost/error dashboard 可用；
- rollback 演练完成；
- 没有仍在使用旧 endpoint 的客户端版本；
- ADR 和 API docs 更新为 Implemented。

## Worktree Plan

### Integration Ownership Rule

以下热点文件在并行阶段禁止由子 worktree 修改，只由最终 integration worktree 接线：

- `web/frontend/src/action-runtime/react/ActionRuntimeFrame.tsx`
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
| Owns | new `web/shared/coachMedia.ts`、对应 guards/tests |
| Must not edit | integration hot files、provider implementations |
| Commit | `refactor(coach): add provider-neutral media v2 contracts` |

该 commit 先进入 integration branch，后续 worktree 全部从“baseline + contracts”SHA 创建。

### Wave A — Four Parallel Worktrees

| Worktree / branch | Responsibility | Exclusive files | Expected commits |
| --- | --- | --- | --- |
| `wt-speech-normalizer` / `codex/speech-normalizer` | 修复数学口语语义与语料测试 | `web/shared/speechText.ts`、speech corpus/tests | `fix(speech): preserve math semantics in spoken Chinese` |
| `wt-emphasis` / `codex/emphasis-lifecycle` | 明确 pending consume、key scope、command 穷尽映射 | `action-runtime/pageRuntime.ts`、`types.ts`、`projection/deriveTransientEmphasis.ts`、对应 tests | `fix(action-runtime): make transient emphasis explicitly one-shot` |
| `wt-realtime-hardening` / `codex/realtime-hardening` | typed relay mapping、ready race、limits、错误、resampler | `realtimeCoachRelay.ts`、`useRealtimeCoach.ts`、capture worklet、对应 tests | `fix(coach): harden realtime session boundaries`; `fix(audio): resample microphone input accurately` |
| `wt-media-session` / `codex/frontend-media-session` | 新统一播放器、PCM queue、取消与 autoplay state | new `frontend/src/presentation/audio/**`、tests | `feat(audio): add exclusive browser media session controller` |

Wave A 分支不能接线 `ActionRuntimeFrame`。每个分支必须保持自己的新增模块可单测，并向 integration
说明最小接线 contract。

### Wave B — Four Parallel Worktrees

Wave B 从已合入 Wave A 所需前置 contract 的 integration SHA 创建。

| Worktree / branch | Responsibility | Exclusive files | Expected commits |
| --- | --- | --- | --- |
| `wt-streaming-tts` / `codex/streaming-tts` | TTS port、DashScope streaming adapter、cache、公开 speech stream server | new `backend/services/coach/ports/**` 中 speech-owned files、`adapters/*Tts*`、`transport/ws/speech*`、tests | `feat(speech): stream deterministic narration audio`; `feat(speech): add bounded narration cache` |
| `wt-coach-stream` / `codex/coach-stream` | Text engine stream、segmenter、CoachTurn application 和 mode policy | new `backend/services/coach/application/**`、text-owned ports/adapters、tests | `feat(coach): stream policy-approved spoken segments`; `test(coach): cover cancellation and assessment gates` |
| `wt-presentation-controllers` / `codex/presentation-controllers` | Narration/Coach controllers、prefetch、transcript projection | new `frontend/src/presentation/narration/**`、`presentation/coach/**`、tests | `feat(narration): prefetch deterministic action speech`; `feat(coach): consume provider-neutral turn streams` |
| `wt-voice-observability` / `codex/voice-observability` | correlation id、阶段事件、server metrics 与 browser first-audio 上报 | new `backend/services/coach/observability/**`、`frontend/src/presentation/telemetry/**`、tests | `feat(observability): measure end-to-end voice latency and cancellation` |

如果 Wave B 两个 backend 分支都需要同一个 port index，先各自 import 具体文件，统一 barrel export 留给
integration；不要为了 index.ts 产生无意义冲突。

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

1. provider-neutral contracts；
2. speech normalizer；
3. emphasis lifecycle；
4. realtime hardening；
5. frontend MediaSession；
6. backend streaming TTS；
7. backend Coach stream；
8. frontend narration/Coach controllers；
9. integration-only wiring commit；
10. frame decomposition commit；
11. compatibility cleanup commit（稳定窗口后，不与首发混在一起）。

Integration-only commits：

```text
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

contracts 合入 integration 后，以 `<contracts-sha>` 创建 Wave A：

```bash
git worktree add ../tt-speech-normalizer -b codex/speech-normalizer <contracts-sha>
git worktree add ../tt-emphasis -b codex/emphasis-lifecycle <contracts-sha>
git worktree add ../tt-realtime -b codex/realtime-hardening <contracts-sha>
git worktree add ../tt-media-session -b codex/frontend-media-session <contracts-sha>
```

Wave A 合入并得到 `<wave-a-sha>` 后创建 Wave B：

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

- `ActionRuntimeFrame` 不 import provider adapter；
- `action-runtime/**` 不 import Audio/MediaRecorder/WebSocket provider client；
- browser shared contract 不出现具体模型 union；
- renderer/PageRuntime 不按 Action kind 推导 emphasis；
- checkpoint/sessionStorage/DB schema 不出现 transient emphasis；
- public WS handler 不原样 forward browser provider event。

### End-to-end gates

覆盖：

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
ACTION_NARRATION_TRANSPORT=url | stream | off
COACH_TURN_TRANSPORT=request-response | stream
COACH_LIVE_ENABLED=true | false
COACH_STREAM_ASSESSMENT_ENABLED=false
```

回滚顺序：

1. 关闭 live；
2. stream Coach 回到 request-response；
3. stream narration 回到 URL TTS；
4. 保留新的分层模块和正确性修复，不回滚数学口语化、WS 安全和 emphasis lifecycle；
5. 只有 contract 不兼容时才回滚 v2 transport，Action Runtime/DB 不受影响。

## Definition of Done

- [ ] ADR-005 标记 Accepted/Implemented；
- [ ] Issue Inventory 的 P0/P1 全部关闭或有明确延期 ADR；
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
