# Action Training / Presentation / Voice Baseline

## Snapshot

- 日期：2026-08-12
- baseline SHA：`2466965`（本地 `master`，clean tree，ahead 14）
- frontend：18 files / 140 tests passed；`npm run build` passed
- backend：runtime suites passed；`npm run build` passed
- browser/provider latency：未在本地伪造数值；由 v2 correlation + browser playback telemetry 在实际部署、
  网络地域和 Chrome/Safari 设备矩阵采集 p50/p95

## Baseline Behavior

| Flow | Before migration |
| --- | --- |
| Practice | `guided-practice -> server-authoritative`；source step 完成触发 evaluation，plan 随 backend 进度恢复 |
| local wrong candidate | local guard 可显示错误，但不进入核心 wrong-attempt / Action duration 指标 |
| deterministic narration | 每次 Action 进入请求完整 `/api/action-speech` data URL；无 cache/prefetch/Abort |
| turn Coach | 等完整 answer + 完整 speech 后 browser 才播放 |
| live Coach | browser/provider raw-ish event relay；browser socket open 后即 capture，upstream 未 ready 时可丢帧 |
| emphasis | key 防普通 rerender 重播，但 pending metadata 没有 renderer acknowledgment |

## Post-migration Measurement Contract

`VoiceTelemetryEvent` 仅包含 protocol version、correlation id、session id、产品 media owner、阶段和 browser
timestamp；不记录学生完整音频、答案或完整 Coach 文本。目标阈值仍以 migration plan 的 Success Metrics 为准，
生产样本不足时不把 provider first packet 冒充 browser first audio。
