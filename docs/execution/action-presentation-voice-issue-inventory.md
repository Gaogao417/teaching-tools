# Action Presentation / Voice 现状问题清单

## Audit Snapshot

- 日期：2026-08-12
- 分支：`feat/coach-omni-chain`
- 审核起点：`8325184 feat(coach): full-duplex realtime voice coach`
- 当前实现基线：`f0475e3 feat(action-runtime): deterministic Learn teaching with teacher voice coach`
- 审核范围：Action Runtime v2 transient emphasis、固定 Action TTS、普通多模态 Coach、
  turn-based Omni/CosyVoice、full-duplex realtime relay、前端音频播放与共享 contract。

审核开始时工作区包含大量未提交 Topic、SolutionBoard、Action Feedback 和 teacher speech 改动；
它们随后已经按职责形成独立提交，其中 transient emphasis 为 `f0bc687`，本架构文档为 `d3b8ae9`，
deterministic teacher voice 为 `f0475e3`。本清单以这些已提交实现为现状证据；“已提交”不表示下列
架构、延迟或正确性问题已经关闭。

## Severity

| Level | 含义 |
| --- | --- |
| P0 | 对外开放或继续扩大使用前必须解决；涉及数学语义、安全边界或核心体验失效 |
| P1 | 架构迁移阻塞项；不处理会导致后续实现重复、耦合或无法度量 |
| P2 | 可以随对应模块迁移一起修复的小问题，不单独阻塞 PoC |

## Confirmed Issues

### P0

#### VOICE-001：数学口语化会改变数学语义

证据：`web/shared/speechText.ts` 把 `\sqrt{x}` 变成 `x`，把 `\parallel`、`\angle` 等命令直接删除；
`web/frontend/src/__tests__/speechAndDirectSpeech.test.ts` 目前还把“根号被删除”当成预期行为。

影响：教师朗读可能说错数学关系，而不是单纯“不自然”。这比延迟更优先。

目标：使用 token/AST 感知的规范化器；至少正确覆盖分数、根号、角、平行、垂直、相似、全等、
乘方、上下标、括号、等号/不等号和常见单位；增加真实 Topic 语料回归集。

#### STREAM-001：普通 Coach 和 turn-based Omni/CosyVoice 都是“上游流式、浏览器整包”

证据：

- `coachTurnService.ts` 串行等待完整 ASR、完整 LLM、完整 TTS；
- `omniCoachService.ts` 收集全部 `audioFragments`，结束后拼成完整 WAV data URL；
- `cosyVoiceService.ts` 收集全部 binary fragments，结束后拼成完整 MP3 data URL；
- `ActionRuntimeFrame.tsx` 只在整个 `/api/action-coach` 返回后调用 `playSpeechUrl`。

影响：用户首声时间仍包含完整回答和完整音频生成时间，`stream: true` 没有转化成用户可感知的实时性。

目标：backend 到 browser 全链路输出 `audio.delta`，浏览器收到第一段即可播放。

#### WS-001：Realtime relay 暴露了过宽的供应商协议面

证据：`realtimeCoachRelay.ts` 把 browser message 原样转发给上游，并把所有上游事件原样转回浏览器。
浏览器理论上可以发送 provider-specific `session.update` 等事件；连接只有 origin 和最长时长控制，
没有公开事件 allowlist、单连接 payload/backpressure 限制和明确用量预算。

影响：教学 prompt、模型行为、成本和协议兼容性都可能被浏览器输入影响；供应商协议直接成为公共 API。

目标：定义 provider-neutral versioned WS schema，只允许 audio append、context update、interrupt、stop 等
产品事件；backend adapter 独占供应商协议。

#### WS-002：Realtime 建连期间可能丢开头音频，配置错误可能逃逸为进程异常

证据：浏览器 WebSocket 打开后就开始发送麦克风帧，但 backend 只有在 upstream 已 `OPEN` 时才转发，
否则静默丢弃；`new WebSocket(... { Authorization: apiKey() })` 的配置异常没有在 relay 内部完整映射成
连接错误。

影响：学生开口过早时首句可能被截断；缺少 API key 等部署错误缺少稳定降级。

目标：upstream ready 前有界缓冲或先发送 server `ready` 再启动采集；所有 setup 异常都变成 typed error
并关闭连接，不抛到事件循环顶层。

### P1

#### ARCH-001：`ActionRuntimeFrame` 成为页面级 God Component

证据：同一个组件同时负责 runtime bootstrap、sessionStorage、evaluation/checkpoint、录音、Coach thread、
provider selector、teacher TTS、realtime、emphasis surface routing、SolutionBoard 动画和整页 JSX。

影响：任何音频、Coach、UI 或 Runtime 改动都会争用同一文件，无法安全地让多个 worktree 并行。

目标：拆成 `ActionWorkspaceContainer`、`CoachController/Panel`、`NarrationController`、
`MediaSessionController` 和 surface-specific emphasis adapters；最终 Frame 只做组合。

#### ARCH-002：供应商与模型选择泄漏进 shared/browser contract

证据：`CoachVoiceModel = "omni" | "cosyvoice"` 位于 `web/shared/actionRuntime.ts`，frontend localStorage
持久化同名选项，UI 直接展示供应商名；`CoachTurnResponse.providers.answer` 硬编码具体模型版本 union。

影响：更换模型或增加“流式文本 + Qwen TTS”需要共享 contract、前端 UI 和 validator 一起升级。

目标：公开 contract 表达产品能力，如 turn-based、streaming、live；provider/model 只进入 server config 和
telemetry。面向学生的 UI 不展示基础设施供应商。

#### ARCH-003：Transport 直接调用 concrete provider

证据：`app.ts` 的 `/api/action-speech` 直接 import `synthesizeCoachSpeech`；`realtimeCoachRelay.ts`
同时读取 plan、构造 prompt、选择模型并管理 provider socket；`index.ts` 直接 attach concrete relay。

影响：transport、application policy 和 infrastructure effect 没有可替换边界，测试只能围绕具体实现。

目标：route/WS server 只验证和转发 provider-neutral contract；application service 依赖 ports；
composition root 注入 adapter。

#### AUDIO-001：多个播放器没有统一仲裁，并且 Action 重播状态会被 Coach 回答覆盖

证据：固定朗读和普通 Coach 共用 `useTeacherSpeech` 内的一个 `HTMLAudioElement`，而 realtime 使用独立
`AudioContext`；`speak(url)` 会把 `speechUrl` 改成 Coach 音频，之后“重播老师语音”按钮不再代表当前
Action 文案；开始 realtime 时也没有统一停止已有 HTMLAudio/提示音。

影响：可能出现音频重叠、错误重播、Action 切换取消 Coach 或 Coach 覆盖教师朗读等隐式耦合。

目标：一个 `MediaSessionController` 仲裁 narration、coach reply、live conversation；重播句柄按用途分开。

#### NARR-001：固定 Action 朗读没有缓存、预取或真正取消

证据：每次新 Action entry 都调用 `/api/action-speech`；只用 request sequence 忽略 stale response，
没有 AbortSignal，也不会取消 backend/provider 任务；返回的是完整 URL，浏览器仍需再次加载。

影响：相同文案重复付费和等待；快速切换 Action 时旧请求继续消耗资源。

目标：按规范化文本、voice、style、model revision 生成 cache key；预取 current + next；传播 cancellation；
cache miss 走 streaming TTS。

#### COACH-001：四条 Coach/Voice 路径没有统一 use-case 语义

现有路径包括：

1. `/api/practice/action-coach` 的确定性 `CoachDirective`；
2. `/api/action-coach` 的普通多模态回合；
3. turn-based Omni/CosyVoice 音频回答；
4. `/api/coach-realtime` 的全双工 transcript/audio。

影响：fallback、上下文构造、mode policy、conversation、错误和 telemetry 不一致；新能力容易再复制一条链。

目标：共享 `CoachContextBuilder` 和 mode policy；普通回合归一到 `CoachTurnApplication`，实时通话归一到
`LiveCoachApplication`，两者共享安全上下文但保持不同生命周期。

#### COACH-002：Realtime 对当前 Action 的理解会过期，也不进入现有 CoachDirective/thread

证据：Realtime 只在建连时读取一次 `plan.currentActionId`；`exerciseId` 被解析但没有参与校验；
Action 推进后没有 context update。Realtime transcript 存在独立 hook state，不调用 `runtime.applyCoach`，
也不进入普通 `coachThread`。

影响：长通话可能继续围绕旧步骤回答；折叠预览、未读状态、会话记录和 Action Coach 显示不一致。

目标：Action 改变时发送经过 backend 校验的 `UpdateContext`；统一 transcript projection；只有完整且合法的
directive 才应用到 runtime。

#### SAFE-001：实时音频在发声前没有结构化输出/防泄漏闸门

证据：普通 Coach 至少在完整 response 后验证 `CoachTurnResponse`；Realtime 音频 delta 直接播放，
只有 prompt 规则，没有公开 transport/application 层的 Assessment capability gate。

影响：Assessment 中无法在音频发出前撤回答案泄漏；端到端 realtime 与严格判题模式的风险不同。

目标：第一阶段只在 Learn/Guided 开放生成式 streaming/live voice；Assessment 使用确定性提示，直到
逐段 guard 和独立验收完成。

#### OBS-001：没有端到端首声、取消、用量和 silent fallback 观测

证据：多个 provider catch 直接回退或吞掉异常；frontend TTS catch 静默；没有统一记录
LLM first token、TTS first audio、browser audio started、autoplay blocked、barge-in 和 usage。

影响：无法判断是 LLM、TTS、代理、下载还是浏览器导致等待，也无法验证迁移收益和成本。

目标：建立统一 turn/narration/session correlation id 与阶段时间戳，统计 p50/p95 和失败原因。

### P2

#### EMPH-001：pending emphasis 没有显式消费，生命周期语义不完整

证据：`pageRuntime.ts` closure 中的 `pendingEmphasis` 会一直附在 `WorkspaceView` 上，直到下一次
强调、BACK/CLEAR/reject/conflict/reset；renderer 依赖 `lastEmphasisKey` 防重播。

影响：普通 re-render 不会重播，但 renderer/model remount 可能重新消费旧 key；“pending”实际变成
“last emphasis”。

目标：renderer 首次接收后 acknowledgment/clear；key 加 runtime instance scope；继续保持不持久化。

#### EMPH-002：Emphasis contract 有未实现分支且 DomainCommand 映射不穷尽

证据：`EmphasisTarget` 声明了 answer slot，但当前 derivation 和 renderer 都不产生/消费；
`deriveTransientEmphasis` 的 switch 在新增 `DomainCommand` 时不会强制明确是否强调。

影响：contract 先于能力扩张；新增 command 可能静默没有视觉反馈。

目标：删除未用 target 或同时完成 renderer；用穷尽映射/contract test 明确每个 command 的策略。

#### SPEECH-002：数学口语化在 frontend 和 backend 重复执行

证据：`teacherCopyForAction` 已调用 `latexToSpokenChinese`，`/api/action-speech` 又调用一次。

影响：职责不清晰；未来非幂等规范化、语言或 voice style 会产生差异。

目标：frontend 负责选择 display copy/可选 spoken override；backend speech application 负责唯一规范化、
版本化 cache key，并返回实际 spoken text 供诊断。

#### AUDIO-002：Autoplay blocked 被静默降级，用户不知道为什么没声音

证据：`audio.play()` rejection 只设置 `speaking=false`；没有 `blocked` 状态、一次性 audio unlock 或明确提示。

影响：冷启动第一步最需要语音时可能无声，容易误判 TTS 很慢或失败。

目标：MediaSession 暴露 `BlockedByAutoplay`，UI 提供一次清晰的“点击开启老师语音”，之后复用已解锁
AudioContext。

#### AUDIO-003：Realtime 采样率转换对 44.1 kHz 输入不准确

证据：`realtime-capture-worklet.js` 使用 `Math.round(sampleRate / 16000)` 做整数抽样；44.1 kHz 会得到
约 14.7 kHz，而不是 16 kHz。

影响：部分 Safari/设备上的音高、速度或识别质量可能受影响。

目标：使用相位累积/线性重采样，并对 44.1/48 kHz 增加离线单测。

#### CODE-001：若干小型职责和状态命名不一致

- `ActionRuntimeFrame` checkpoint effect 中有重复 `if (local)`；
- sessionStorage key 使用 `action-runtime-v3`，shared plan 常量仍为 v2，命名容易误读；
- realtime transcript 的 coach delta 使用 `.slice(-600)`，长回答会保留尾部、丢失开头；
- `useTeacherSpeech.stop()` 不传播 AbortSignal，也没有清空/区分 narration 与 coach replay handle；
- `exerciseId` 在 realtime query 中解析但未验证使用。

这些问题不单独开架构分支，应随对应 owner 的模块迁移一起修复。

## Accepted Existing Decisions

以下不是问题，迁移中必须保留：

- Emphasis 从 `DomainCommand.type`/accepted SolutionBoard 推导，不从 Action kind 推导；
- Emphasis 不进入 XState context、snapshot、checkpoint、sessionStorage 或 DB；
- Restore 不重放 emphasis；recomplete 产生新 key；
- 固定 teacher copy 默认来自已有 Action/coach 文案，不要求 Topic author 重写 narration；
- TTS 与 Emphasis 独立；
- GeometryCanvas 不把“刚变化”映射成 `visualState: correct`；
- reduced-motion 有单独呈现策略；
- Realtime 已经证明浏览器到 provider 的 audio delta 播放链路可行，应迁移为安全 adapter，而不是删除重做。
