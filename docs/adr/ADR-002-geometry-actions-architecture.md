# ADR-002 Geometry-Actions Frontend Architecture

## 背景

ADR-001 确立了 runtime-first 架构：后端 `EnginePlugin` 持真值、判题、投影
`ExerciseRuntimeSpec`；前端消费投影、提交 `RuntimeActionEvent`。这一层在题型增长时
稳定，但前端展示层一直是"一个题型一套手写 SVG"：

- `SceneRenderer.tsx` 硬编码 `sceneKind === "triangle"` 分支
- `WorkspaceScene.tsx` 按题型内联渲染逻辑
- `AngleEquationWorkspace.tsx` 自行解析后端塞进 scene 的 JSON model
- 加一个题型 / 一个交互手势，要改前端多处分散的渲染代码

这与后端曾经存在的 `switch (primitive)` 反模式（同一 primitive 的行为散布在多个
switch）是同构的问题，只是发生在前端。

POC（`web/frontend/src/poc/geometry-actions/`）验证了一套**函数式交互架构**能否成为
前端展示层的稳定核心：

```text
Typed Action (state machine)
        ↓
generic Runtime (零业务 switch)
        ↓
WorldState (纯数学依赖，无渲染对象)
        ↓
InteractionView (通用投影，无 action-specific 字段)
        ↓
GeometryCanvas → JSXGraph adapter
        ↓
GeometryEvent (领域事件，JXG event 不外泄)
        ↓
RuntimeActionEvent → backend EnginePlugin
```

## POC 验证结论

POC 在真实浏览器中跑通了完整流程（`A → BC → 平行线 + 交点 F → 标注 BC = 3`），
且下列不变量经 grep 实证成立：

- `makeParallel.ts` / `markSegmentValue.ts`：无 React import、无 JSXGraph import。
- `engine/runtime.ts`：无业务 `switch(actionKind)`、无 `if(action.kind===...)`，
  只通过 `RuntimeAction` 接口调用。
- `GeometryCanvas.tsx`：不 import `jsxgraph`，不知道当前运行的是哪个 Action。
- `JXG.*` 类型只存在于 `renderer/` 内部，domain / actions / engine 完全看不到。
- `WorldState` 只持有纯数据（`MathObject` union），派生对象只表达依赖、不带坐标
  （交点 F 是 `{ kind:"intersection", of:[lineId, segId] }`，不是 `{x,y}`）。

加第二个 Action（`markSegmentValue`，交互形态完全不同：点击 + 文本输入 + 提交）
时，Runtime / GeometryCanvas / InteractionView 零改动——只新增一个 action 文件、一个
`MathObject` 变体、一个 renderer case。这是可扩展性证据。

## 决策

**前端展示层** 采用 geometry-actions 架构（Action 状态机 + 通用 Runtime + WorldState
+ JSXGraph renderer），作为 ADR-001 runtime-first 架构的**分层演进**，不是替换：

```text
backend (ADR-001, 不变)        frontend 展示层 (ADR-002, 新)
┌─────────────────────┐        ┌──────────────────────────┐
│ EnginePlugin        │        │ Action (typed FSM)       │
│  - answerKey 真值   │  spec  │ generic Runtime          │
│  - 判题             │ ─────> │ WorldState (投影)        │
│  - 投影 ExerciseSpec│        │ GeometryCanvas/JSXGraph  │
│                     │ <───── │ GeometryEvent            │
└─────────────────────┘ action └──────────────────────────┘
```

**后端不变**：`EnginePlugin` 仍是唯一真值/判题层，`ExerciseRuntimeSpec` 仍是两端契约。
ADR-001 的所有硬约束（真值不下前端、approved-only scenario、version pinning）全部保留。

**前端展示层迁移**：新 engine 的前端展示从"手写 SVG + 场景 JSON"迁移到
"Action + WorldState + JSXGraph"。现有手写 SVG renderer（`SceneRenderer.tsx` 等）
作为过渡态保留，直到对应 engine 迁移完成。

## 关键设计点（重写时必须遵守）

### 1. WorldState 由后端投影驱动，不是前端硬编码

POC 的 `initialWorld()` 和 `createBoard(boundingbox)` 是写死的，因为它不接后端。
正式重写后，这些数据来自后端投影的 `ExerciseRuntimeSpec.instance.scene`：

- 点坐标、边、视野范围 → 来自 scene entities
- 当前步骤允许的操作（"现在可以点 A"）→ 来自 `flow.steps[].allowedActions`

`createBoard` 接收参数，不再写死。

### 2. GeometryEvent 映射成 RuntimeActionEvent，判题仍走后端

POC 的 `GeometryEvent`（`point-click` / `segment-click` / `input-change` / `submit`）
是前端的本地事件。重写时映射成现有 `RuntimeActionEvent`：

```text
GeometryEvent                    RuntimeActionEvent
point-click {id:"BC"}    ──┐
input-change {value:"3"} ──┼──> { type:"submit",
submit                   ──┘      stepId,
                                 value: JSON.stringify({selections, inputs}) }
                          │
                          └──> POST /api/practice/runtime-action
                               后端用 answerKey 判题
                          <── 回传新 ExerciseRuntimeSpec
                          │
                          └──> 前端把新 scene 投影成新 WorldState
```

也就是说，**POC 的 `dispatch` 要从"前端同步一拍"改成"异步 round-trip"**。
这符合 ADR-001 的铁律：每个状态转换都是后端 round-trip，前端从不自己判题。

### 3. RuntimeAction.commit 的边界（重写第一个要定的设计点）

POC 的 `RuntimeAction.commit(world, result)` 在前端把派生对象写进 WorldState
（如交点 F）。但正式系统里 `commit` 不能依赖真值（否则真值下前端）。两条路：

- **方案 A（推荐）**：前端去掉 `commit`。WorldState 完全由后端回传的 spec 驱动。
  后端 EnginePlugin 在判题通过后，把新对象投影进 scene，前端只负责渲染。
  前端 Runtime 退化为"把 GeometryEvent 翻译成 RuntimeActionEvent + 把回传 spec
  投影成 WorldState"的纯适配层。
- **方案 B**：`commit` 仅限"纯几何派生"（如交点 F 这种数学上唯一确定的派生，
  不含判题、不含 answer key）。判题类派生仍走后端。

推荐方案 A，因为它最干净、零真值泄漏风险，且让前端 Runtime 真正成为纯投影。

### 4. Action 仍是前端的状态机表达

即使 `commit` 去掉，`ActionDefinition<P, S>` 的 `init` / `reduce` / `view` 仍有价值：
它们表达"当前步骤期待什么交互、收到什么事件算 reject"。只是 `reduce` 的 `complete`
分支不再 commit WorldState，而是触发一次后端 round-trip。`view` 仍由前端纯计算，
驱动 `InteractionView`（哪些点可点、哪个 prompt）。

### 5. 类型擦除边界 `defineAction` 保留

POC 的 `defineAction<P,S,R>(def, params): RuntimeAction` 是处理异质 Action 序列的
单点类型擦除边界，重写时保留。它让 Runtime 零业务 switch，每个 action 内部全类型。

## 影响范围

- 新 engine 的前端展示层用 geometry-actions 架构。
- 现有 SVG renderer 作为过渡态保留，按 engine 逐个迁移。
- 后端 `EnginePlugin`、契约、API、题库全部不动。
- JSXGraph 成为 geometry renderer 的 backend（通过 adapter 隔离，可替换）。
- ADR-001 的所有硬约束不变。

## 后续重写路径（triangle-trig / coordinate-isosceles-right / angle-equation）

每个 engine 的重写本质是：把它的交互流程表达成一组 Action 状态机，把它的 scene
数据投影成 WorldState，用 JSXGraph 渲染。具体：

- **triangle-trig**：meaning（点边选角色）→ 1 个 pick Action；ratioToSide（填边长）→
  1 个 input Action；guidedSolve（三步）→ 3 个 Action 串成 sequence。
- **coordinate-isosceles-right**：几何构造类，最贴近 POC 的 makeParallel 范式。
- **angle-equation**：单位圆 + 范围带，是前端自定义 SVG；迁移时把 UnitCircleSVG /
  RangeBandSVG 投影成 WorldState（点、弧、区间），用 JSXGraph 渲染。

每个 engine 重写时，**后端 `EnginePlugin` 不动**，只动前端展示层 + 一个
`spec → WorldState` 投影器 + 一个 `GeometryEvent → RuntimeActionEvent` 适配器。

## 备选方案

### 方案 X: 直接把 POC 的 Runtime（含 commit）整个搬上前端，真值也上前端

优点：

- 前端完全自治，无 round-trip

缺点：

- answer key / accepted answers 进浏览器 bundle，学生 devtools 直接可见
- 违反 ADR-001 最硬的约束（真值不下前端）
- 后端 Wolfram 校验、scenario version pinning 全部失效

不采用。

### 方案 Y: 不动，继续一个题型一套手写 SVG

优点：

- 零改动

缺点：

- 前端渲染代码随题型线性膨胀
- 交互手势无法跨题型复用
- 同一题型的渲染逻辑散布在多个组件

不采用。
