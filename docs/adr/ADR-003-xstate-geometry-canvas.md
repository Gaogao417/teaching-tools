# ADR-003 XState 驱动的 Geometry Canvas 交互层

## Status

Proposed · POC 已落地（2026-08-08）· 已演进为任务驱动 + 对象级 affordance（2026-08-09，见下方"演进"）· construct-parallel 已接入生产 `TopicPracticeWorkspace`（2026-08-09，见下方"生产接线"）

## Background

几何画布里的"作平行线""作圆""标记角"这类操作不是单步动作，而是**多步交互协议**：选经过点 → 选参考线 → 完成；选圆心 → 选经过点 → 完成。它们还包含非法选择、重选、取消、预览、返回。

当前最接近的画布 `web/frontend/src/components/exercises/topicPractice/TopicPracticeWorkspace.tsx` 用一个大 `switch (contract.primitive)` 实现这些流程（`handleSegment` / `handlePoint`），并把已选参数序列化成字符串草稿（如 `"point:A|parallel:BC"`）。这事实上是一个**手写的、不完整的 FSM runtime**：状态集合隐式、转移规则分散在多个 switch 里、无法独立测试、无法被 Agent 直接复用。

工具一旦多起来，分散的 `if/switch` 只会越来越难维护，也更难回放与自动化。

## Decision

采用 **XState v5** 作为 Geometry Canvas 的交互状态机层，但严格限定它的职责边界：

- **XState 只管"用户现在正在做什么"**——当前工具、当前步骤、已收集参数、取消 / 完成、UI 提示。
- **几何实体（点 / 线 / 圆 / 约束）继续由 `GeometryModel` 作为唯一事实来源**。XState 不持有几何实体。
- **machine 完成时只产出 `GeometryCommand`**，由独立的 `CommandExecutor` 校验并写入 `GeometryModel`。
- **画布只认识统一的事件（`CanvasEvent`）和统一的视图（`InteractionView`）**，不认识具体工具名。

核心链路：

```
Human / Agent → Tool Machine → GeometryCommand → CommandExecutor → GeometryModel
                     ↓ snapshot
              InteractionView projector
                     ↓ prompt / affordance / preview
                  Canvas UI
```

依赖方向（附录 A 的"建议的依赖方向"）：

```
geometry/domain          <- 无 XState、无 React、无 JSXGraph
geometry/interaction     <- XState + domain 类型
geometry/react           <- React + JSXGraph + interaction + domain
```

这样即使以后换掉 React 或 XState，`GeometryCommand` 与 `GeometryModel` 仍然是稳定资产。

## Consequences

- **新增工具不再改画布核心**：新增一个 machine + projector + command 分支即可，`GeometryCanvas.tsx` 不出现工具名判断（POC 已用 grep 实证）。
- **交互流程可独立单测**：给 machine 发事件、断言 state / context / output，不依赖 UI。
- **Human / Agent / Replay 三条路径汇聚到同一个 command 层**：Agent 直接执行 `GeometryCommand`，不必模拟点击。
- **取消、重选、错误反馈、预览都由工具自身协议决定**，而不是画布猜测。
- **未来回放时优先记录 command**；若要重放人类操作，再记录 interaction event。

引入的新依赖（仅前端）：`xstate`、`@xstate/react`、`jsxgraph`、`vitest`（测试）。XState v5 要求 TypeScript ≥ 5，仓库已是 TS 5.8。

## Rejected Alternatives

### Alternative A：继续用分散的 if/switch（现状）

不采用原因：

- 状态集合和合法转移是隐式的，边界状态难以穷举。
- 提示文本散落在组件里，无法集中投影。
- 新增工具需要改多个组件，且难以独立测试。
- 这本质上是在项目内部手写一个不完整的 FSM runtime。

### Alternative B：把全部应用状态都迁进 XState

不采用原因：

- 把 `GeometryModel`、selection、UI、历史都塞进一个 `context`，XState 会变成"第二套 GeometryModel"。
- 违反"几何实体唯一事实来源"。
- machine 会变成几十个工具的巨型 union，难维护。

### Alternative C：把 UI 文案、preview 实现、几何变更都塞进 XState actions

不采用原因：

- 破坏 machine 的可测试性与可替换渲染。
- 几何变更必须经过 `CommandExecutor` 这一道校验门，不能由 action 直接改模型。
- 预览是高频渲染状态，应在渲染层计算，不应进入 machine（见下"高频 pointer move"）。

### Alternative D：过早抽象 ToolRegistry / parent ToolController actor

不采用原因：

- 报告明确建议"至少两到三个差异工具后再抽共同层"。
- POC 先用一个极薄的 `ToolDefinition` 注册表验证通用性，待模式稳定后再决定是否上 parent actor。

## 高频 pointer move 的处理（重要约束）

默认**不要把每个 `pointermove` 发送给 XState**。pointer 坐标是高频、短寿命的渲染状态，留在画布层；预览函数读取 machine 的"已选参数"+ 当前 pointer，再查询 `GeometryModel` 计算 preview。只有 hover 本身确实改变交互协议时，才把语义化的 `HOVER.ENTER / HOVER.LEAVE` 发给 machine。POC 的 `GeometryCanvas.tsx` 中 `PreviewLine` 即遵循此规则。

## 校验分两层

| 层 | 示例 | 作用 |
|----|------|------|
| Interaction guard | 第二步只能接受 line；禁止重复选择某实体 | 改善即时 UX，阻止明显非法 transition |
| Geometry command validator（CommandExecutor） | 参考线是否存在；实体是否仍有效；构造是否满足领域约束 | 最终正确性；Human 与 Agent 都必须经过 |

XState guards 必须保持纯函数，不能隐式修改 `GeometryModel`。最终语义校验由 `CommandExecutor` 负责。

## POC 验证

POC 已在 `web/frontend/src/geometry/` 落地，验证了上述架构形态（详见 `docs/features/geometry-canvas-architecture.md`）。验收标准逐条达成：

- `GeometryCanvas.tsx` 无工具步骤判断（grep 实证）。
- `construct-parallel` 全四阶段流程（`selectPoint → selectLine → selectCarrier0 → selectCarrier1 → done`）、`BACK`、`CANCEL`、各阶段 wrong 分支均有独立测试（55 个测试全绿）。
- machine 完成只产 command，不直接改 `GeometryModel`（executor 是唯一入口）。
- 同一个 `construct-parallel` / `construct-circle` command 可由 Agent 直接执行。
- 新增 `construct-circle` 不改画布核心事件分发（同一 `onClickEntity` 路径）。
- `pointermove` 不造成 machine context 高频更新。
- `npm run typecheck`、`npm test` 全绿；浏览器实测 POC 页（`/poc/geometry`）全四阶段跑通，wrong/correct 反馈正确。

## 演进（2026-08-09）

POC 初版是"自由作图工具"形态，本次演进把它推向 PRD-03 的任务驱动 Action，但仍**不接生产 session runtime**（步骤推进与判题继续归后端；前端 machine 只跑当前 Action）。三处实质变化：

1. **`InteractionView` 改为对象级 affordance**。原 `accepts: EntityKind[]`（按实体种类过滤）被 `entities: Record<id, EntityAffordance>` 取代，分离两个维度：`enabled`（画布唯一的点击过滤条件）、`expected`（machine guard 用的教学目标，画布永不读它来过滤/判题）。错误对象保持 `enabled: true`，这样点击能到达 machine 并产生教学反馈。`visualState`（idle/available/selected/filled/wrong/correct）仅供渲染层着色。
2. **machine 改为任务驱动，强制 task input**。`construct-parallel` 要求 `ParallelActionSpec { throughPointId, referenceLineId, carrierPoints }`，覆盖 PRD-03 §5.3 的完整四阶段（过线点 → 参照边 → 第一外点 → 第二外点）。没有自由作图模式——若需要，另设显式工具，不在此 machine 上开可选分支。guard 失败走显式 wrong transition（XState 转移数组 fallthrough），不再静默丢弃事件。
3. **`GeoLine` 建模为关系而非显示几何**。`segment { from, to } | parallel-line { through, parallelTo }`——平行线只存关系，显示范围由渲染层推导（与 `GeoCircle` 一致：中心 + 经过点，不存半径）。消除"额外 segment + 关系"的双重真相。`model.lineDirection(id)` 递归解析平行链（带环检测）。

判题边界（未变）：生产 `TopicActionContract` 的 `acceptedAnswers` 仍后端独占；前端 machine 的 `expected` 来自 learner-visible projection 里的 `interaction.construction`（throughPoint/parallelSegment/carrierPoints），不泄露判题真相。生产接线（把 machine 接进 `TopicPracticeWorkspace` 的 construct-parallel 分支，产出同一 `point:T|parallel:S|carrier:C0,C1` 字符串）作为后续工作。

## 演进备注：construct-parallel 承载了两个耦合的数学操作（2026-08-09）

`construct-parallel` machine 当前把两个数学上独立的操作合并成了一个"动作"：

- **操作 A — 作平行线**：输入过线点 C + 参照边 AD，产出一条平行线 L。这条线被 C 和 AD 唯一决定，不需要其它输入。
- **操作 B — 求交（落线）**：把平行线 L 投到载体线段 BE 上，产出交点 F。载体两端 B、E 是这一步的输入。

Q001 的几何是铁证：`throughPoint=C, parallelSegment=AD, carrierPoints=[B,E], resultPoint=F`。过 C 作 AD 的平行线本身已被 C、AD 完全决定；B、E 对这条平行线零贡献，它们只决定"这条线延伸到哪、交出哪个点（F）"。把两者合成一个四阶段 machine，是所有 carrier 相关别扭的根：

- "carrier points 不该进 GeometryCommand" —— `ConstructParallelCommand` 只有 through + reference，命令层早已把 carrier 排除（`commands.ts`）。
- "为什么是 4 阶段" —— 因为 machine 在作平行线之后又硬接了求交。
- "evidence 字段" —— B、E 不是操作 A 的证据，是**操作 B 的输入**。

**本轮决定（记录，暂不重构）**：当前 machine 维持四阶段不变，生产接线的 construct-parallel 切片仍按现有 4 阶段接入（已过 POC 验证，行为等价风险低）。但确立一条架构判断作为后续重构依据：

- 干净的拆分应当是把 `construct-parallel` 砍回纯两阶段（点 + 参照边 → 平行线 command），把"求交落线"另立为独立工具（如 `intersect-line`），carrier 作为该工具的输入而非前者的 evidence。
- 生产提交串 `point:T|parallel:S|carrier:C0,C1` 是**两个动作答案的字符串胶合**，属于序列化层决定，不应倒逼交互层把两个动作合并成一个。
- UI 文案"外点"（`constructionPrompt` 中的"点第一个/第二个外点"）用词不当——carrier 实为"载体线段端点"，应在重构时一并纠正。接线切片暂保留现有措辞以保持行为等价。

## 生产接线（2026-08-09）

construct-parallel 已作为第一条最窄生产纵向切片接入 `TopicPracticeWorkspace`。这一步把"框架已就绪"推进到"跑在真实 `auxiliaryTwoRatios` 场景的 construct-parallel 步上"，同时不动后端、不换 Canvas、不改 machine。

**接入边界**：保留现有 SVG-over-`<img>` 生产 `GeometryCanvas`；只把它背后的手写 `handlePoint`/`handleSegment`/`undoLast` 的 construct-parallel 分支换成 XState machine。其它 primitive（mark-segments / mark-ratio / ratio-scratch / convert-collinear / equation / select / input）一律不动，继续走原 switch。

**接口缺口修复 —— evidence 作为 tool-discriminated 旁路通道**：machine 的输出仍是纯 `GeometryCommand`（只含 `throughPointId`/`referenceLineId`），不把 carrier points 硬塞进命令（carrier 是教学操作证据，不是"作平行线"这个数学命令本身）。新增 `ToolEvidence`（按 tool 区分的判别类型）+ `ToolDefinition.extractEvidence`：runtime 在命令执行后、`onDone` 触发前从完成态 snapshot 提取证据，经 `ToolCompleted.evidence` 暴露。生产侧用适配器 `serializeParallelEvidence` 把它序列化成原有 `point:T|parallel:S|carrier:C0,C1` 字符串，后端判题（`isTopicAnswerAccepted` + `wrongObjectsForSubmission`）零改动。这条 evidence 通道证明：machine 可以同时服务"修改数学模型"（command）和"产出可判题的教学证据"（evidence），二者边界干净。

**新增的生产适配层**（`web/frontend/src/geometry/adapters/`，纯函数、无 React）：
- `constructParallelAdapter.ts`：`construction` → `ParallelActionSpec`、`TopicGeometryModel` → domain `GeometryModel`、evidence ↔ `topic-answer` 字符串双向转换。
- `mapInteractionView.ts`：`InteractionView` → 生产 Canvas 现有的 prop 形状（`availablePointIds` / `availableSegmentIds` / `selectedPoints` / `selectedSegments` / `wrongObjectIds` / `constructionPreview`）。

**React 绑定**（`TopicPracticeWorkspace.tsx` 内的 `useConstructParallel`）：每个 construct-parallel step 建一个 runtime + machine，从 draft 注水（重放已确认正确的点击，离开再回来 partial progress 仍在），把 in-progress 选择回写 draft（撤销/推进同步），完成时落 `onDone` 的 evidence 序列化。错误的点/线经 projector 标红并并入现有 `wrongObjectIds` 渠道，复用既有 `is-wrong` 样式 —— 这是 POC 已验证但生产此前缺失的"错误对象能变红"能力。

**测试**：原 55 条全绿；新增 26 条适配器测试覆盖序列化与答案键逐字节一致、InteractionView→Canvas props 映射；runtime 集成测试补 evidence 断言。前端 `tsc --noEmit` 干净。

**仍未完成（逐条迁移其它 primitive 的前置）**：mark-segments / mark-ratio / ratio-scratch / convert-collinear / equation / select / input 仍各自需要一个 machine + projector + 输入 spec + evidence serializer。Canvas、事件协议、交通灯、runtime 不需要重写。
