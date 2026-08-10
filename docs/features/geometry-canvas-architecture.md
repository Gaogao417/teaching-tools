# XState 驱动的 Geometry Canvas 交互运行时

> 把多步几何工具从 Canvas 条件分支中抽离，建模成可测试、可回放、可由 Agent 复用的交互协议。
>
> 决策记录见 [ADR-003](../adr/ADR-003-xstate-geometry-canvas.md)。本文是该决策的完整设计与 POC 落地说明。

> **演进提示（2026-08-09）**：本文以下章节描述的是 POC **初版**（自由作图形态，`InteractionView.accepts` 为种类级数组，`construct-parallel` 两阶段，`GeoLine` 为普通 segment）。初版已演进为任务驱动 Action；三处实质变化（对象级 affordance `enabled/expected/visualState`、强制 `ParallelActionSpec` 全四阶段、`GeoLine` 关系建模）详见 [ADR-003 的"演进"章节](../adr/ADR-003-xstate-geometry-canvas.md#演进2026-08-09)。下文的 `accepts` 字段、`point → line → done` 流程、derived-segment 描述以 ADR 演进章节为准。

## 核心结论

XState 应该负责"用户现在正在做什么"，而不是"几何世界是什么"。

```
Human interaction → Tool Machine → GeometryCommand → GeometryModel
```

## 01 / 执行摘要

采用 XState v5 作为 Geometry Canvas 的交互状态机层，但只让它管理**工具流程状态**：当前工具、当前步骤、已收集参数、取消 / 完成、UI 提示。点、线、圆、约束和构造结果继续由 `GeometryModel` 作为唯一事实来源。

### 关键设计决策

| 决策 | 建议 | 理由 |
|------|------|------|
| 状态机范围 | 仅管理 interaction / tool workflow | 避免把 XState 变成第二套 GeometryModel |
| 机器粒度 | 一个多步工具一个 machine | 工具内部步骤天然是有限状态；不会形成巨型 canvasMachine |
| 完成结果 | machine 输出 GeometryCommand | 把 UI 工作流和领域操作解耦；Agent / replay 可直接复用 command |
| Canvas 依赖 | 只认识统一事件与 InteractionView | 新增工具时不再修改 Canvas 的 tool-specific switch |
| 鼠标移动 | 不默认进入 XState | 高频 pointer state 留在渲染层，预览由 snapshot + pointer + geometry 计算 |
| 领域校验 | 最终由 GeometryModel / command validator 负责 | 交互 guards 可做前置校验，但不能成为唯一正确性来源 |

### 实施结果应达到

- 新增一个工具时，Canvas 主体无需新增 tool 名称判断。
- 交互流程可以独立单测：给机器发送事件，断言 state / context / output。
- Agent 可以直接执行同一个 GeometryCommand，而不必模拟点击。
- 取消、重选、错误反馈、预览都由工具自身协议决定。
- 未来需要回放时，优先记录 command；若要重放人类操作，再记录 interaction events。

## 02 / 为什么现在应该引入 XState

当工具只有"当前激活的是 select 还是 line"时，`useState` 或 discriminated union 足够；但一旦工具包含多步选择、非法选择、重选、取消、预览与完成，它已经事实上成为状态机。继续用分散的 `if/switch`，只是在项目内部手写一个不完整的 FSM runtime。

仓库现状印证了这一点：`web/frontend/src/components/exercises/topicPractice/TopicPracticeWorkspace.tsx` 的 `handleSegment`（一个按 `contract.primitive` 分发的大 switch）就是这种"手写 FSM"，并把已选参数序列化成字符串草稿（`"point:A|parallel:BC"`）。XState POC 正是要把它替换成显式、可测试、可复用的协议。

### 设计目标

- **确定性**：相同 snapshot + event 得到可预测结果。
- **类型安全**：event payload、input、output、guard 全部可由 TypeScript 检查。
- **可替换渲染**：machine 不依赖 React、JSXGraph/SVG/Canvas 等具体绘制框架。
- **Agent 兼容**：UI 交互和自动化最终汇聚到同一套 command 层。
- **可测试**：machine、view projector、GeometryCommand executor 分层测试。

### 非目标

- 不把全部应用状态迁移进 XState。
- 不把点线圆实体存到 machine context。
- 不在第一版做"一个巨型顶层 machine 管所有东西"。
- 不要求 Agent 通过逐步 `POINT.CLICKED` 来复刻人类交互。

## 03 / 目标架构与职责边界

```
Human pointer / keyboard                Agent / Replay
          |                                  |
          v                                  |
  Canvas Input Adapter                       |
          | semantic events                  |
          v                                  |
  +----------------------+                   |
  | XState Tool Machine  |                   |
  | state + context      |                   |
  +----------+-----------+                   |
             | snapshot                       |
             v                                |
     InteractionView projector                |
             | prompt / affordance / preview  |
             v                                |
          Canvas UI                           |
                                              |
  Tool Machine --output-----------------------+
                    GeometryCommand
                          |
                          v
                  CommandExecutor
                          |
                          v
                    GeometryModel
```

### 六层职责

| 层 | 负责 | 明确不负责 |
|----|------|-----------|
| `GeometryModel` | 点 / 线 / 圆 / 约束、几何查询、领域不变量 | 当前工具做到第几步 |
| HitTest / Pointer | 屏幕坐标 → 实体命中、pointer world position | 工具业务流程 |
| Tool Machine | 步骤、临时选择、取消 / 重选、完成条件 | 持久几何实体 |
| InteractionView | 把 snapshot 投影为 prompt / accepts / selected / preview spec | 修改 machine 或 geometry |
| CommandExecutor | 校验并执行 GeometryCommand | 鼠标交互 |
| React Binding | 订阅 actor / geometry、触发重绘 | 工具专用业务规则 |

**最重要的边界**：Tool Machine 是"命令构造器"。真正的领域 API 是 `GeometryCommand`。这样 human / agent / replay 三条路径不会被 UI 绑死。

### 实际目录（POC 已落地）

```
web/frontend/src/geometry/
  domain/                          # 无 XState、无 React、无 JSXGraph
    model.ts                       # GeometryModel：点/线/圆 + 查询 + 领域不变量
    commands.ts                    # GeometryCommand 联合类型
    command-executor.ts            # execute(command) → 校验 + 变更 GeometryModel
  interaction/                     # XState + domain 类型；无 React、无 JSXGraph
    events.ts                      # CanvasEvent 联合 + EntityRef + toCanvasEvent()
    interaction-view.ts            # InteractionView + idleView
    tools/
      construct-parallel.machine.ts
      construct-parallel.view.ts
      construct-circle.machine.ts
      construct-circle.view.ts
    runtime.ts                     # InteractionRuntime：start/send/getView/onDone/cancel
    tool-registry.ts               # ToolDefinition + 注册表
  react/                           # React + JSXGraph + interaction + domain
    use-geometry-interaction.ts    # @xstate/react 订阅，selector 只取 view
    jsxgraph-board.ts              # JSXGraph 适配：model→board、click→CanvasEvent、预览
    GeometryCanvas.tsx             # 画布组件：消费 InteractionView，无 tool-specific 分支
    PocPage.tsx                    # 可跑 demo 页
    PocErrorBoundary.tsx           # 渲染错误兜底
  __tests__/                       # 四类测试（见 §07）
```

## 04 / 先定义协议，再写机器

### 1. GeometryCommand：跨 Human / Agent / Replay 的稳定边界

```ts
export type GeometryCommand =
  | { type: "construct-parallel"; throughPointId: PointId; referenceLineId: LineId }
  | { type: "construct-circle"; centerId: PointId; throughPointId: PointId }
  | { type: "mark-angle"; angleId: AngleId; label?: string };
```

Command 必须是 JSON-friendly 的领域意图，不携带 React node、class instance、closure 或 actorRef。它既适合测试，也适合未来审计和重放。POC 实现了前两者；`mark-angle` 仅作类型占位以保留扩展面。

### 2. CanvasEvent：UI 对机器发送的语义事件

```ts
export type CanvasEvent =
  | { type: "POINT.CLICKED"; pointId: PointId }
  | { type: "LINE.CLICKED"; lineId: LineId }
  | { type: "ANGLE.CLICKED"; angleId: AngleId }
  | { type: "CONFIRM" }
  | { type: "BACK" }
  | { type: "CANCEL" };
```

不要把原始 DOM PointerEvent 直接送入 machine。先在 Canvas Adapter 中转成稳定的领域交互事件，避免 machine 与渲染框架和浏览器 API 耦合。`toCanvasEvent(hit: EntityRef)` 是这个映射的纯函数。

### 3. InteractionView：Canvas 唯一需要理解的工具状态

```ts
export interface InteractionView {
  prompt: string;
  accepts: readonly ("point" | "line" | "angle")[];
  selected: readonly EntityRef[];
  cursor: "default" | "crosshair" | "pointer";
  preview?: PreviewSpec;
  canCancel: boolean;
  canGoBack: boolean;
}
```

Canvas 不应该自己用 `state.value` 推断提示语。机器 snapshot 先经过一个纯 projector，Canvas 只消费 `InteractionView`。静态状态描述可以放在 XState meta；动态 `selected` / `preview` 更适合 projector。

## 05 / 首个 POC：construct-parallel

首个迁移工具选择一个明显多步、但领域逻辑简单的操作：先选"经过点"，再选"参考直线"，最后产出 `construct-parallel` command。这个工具足以验证状态、context、guards、取消、返回和 output 的全部关键接口。

```ts
import { assign, setup } from "xstate";

interface ConstructParallelContext {
  pointId?: string;
  lineId?: string;
  outcome?: "completed" | "cancelled";
}

export const constructParallelMachine = setup({
  types: {
    context: {} as ConstructParallelContext,
    events: {} as CanvasEvent,
    output: {} as ConstructParallelOutput,
  },
}).createMachine({
  id: "construct-parallel",
  initial: "selectPoint",
  context: {},
  states: {
    selectPoint: {
      on: {
        "POINT.CLICKED": {
          target: "selectLine",
          actions: assign({ pointId: ({ event }) => event.pointId }),
        },
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    selectLine: {
      on: {
        "LINE.CLICKED": {
          target: "done",
          actions: assign({
            lineId: ({ event }) => event.lineId,
            outcome: () => "completed",
          }),
        },
        BACK: { target: "selectPoint", actions: assign({ pointId: () => undefined }) },
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    done: { type: "final" },
    cancelled: { type: "final" },
  },
  output: ({ context }) => {
    if (context.outcome === "cancelled") return { type: "cancelled" };
    // invariant: context.pointId / context.lineId 已在完成路径赋值
    return {
      type: "construct-parallel",
      throughPointId: context.pointId!,
      referenceLineId: context.lineId!,
    };
  },
});
```

> **对设计报告骨架的实现修正（重要）**：报告原稿用 `output: ({ event }) => event.type === "CANCEL" ? ...` 区分取消与完成。在 XState v5 中，machine 级 `output` 回调收到的是 `xstate.done.*` 内部事件而非触发转移的事件，且 final-state 级 `output` 不会写入 `snapshot.output`。因此**可靠做法是在 context 中记录 `outcome`，在 machine 级 output 中读 context**。这与报告"生产版建议把 cancelled 与成功 output 分开建模"的注记一致。POC 全部采用此模式。

### 对应的 view projector

```ts
export function projectConstructParallel(snapshot): InteractionView {
  if (snapshot.matches("selectPoint")) {
    return { prompt: "选择平行线经过的点", accepts: ["point"], selected: [], cursor: "pointer", canCancel: true, canGoBack: false };
  }
  if (snapshot.matches("selectLine")) {
    return {
      prompt: "选择参考直线",
      accepts: ["line"],
      selected: snapshot.context.pointId ? [{ kind: "point", id: snapshot.context.pointId }] : [],
      cursor: "pointer",
      preview: { type: "parallel-through-hover" },
      canCancel: true,
      canGoBack: true,
    };
  }
  return idleView;
}
```

第二个工具 `construct-circle` 形状不同（两步都消费 `POINT.CLICKED`），验证了同一 Canvas 事件分发无需改核心。

## 06 / Runtime & React：Canvas 如何接入，而不认识具体工具

### InteractionRuntime（附录 A API 草案的实现）

```ts
export interface InteractionRuntime {
  startTool(toolId: ToolId): void;
  cancel(): void;
  send(event: CanvasEvent): void;
  getView(): InteractionView;
  activeToolId(): ToolId | undefined;
  subscribe(listener: () => void): () => void;
  onDone(handler: (completed: ToolCompleted) => void): () => void;
}
```

Runtime 负责：创建 / 销毁 active tool actor（集中在 Runtime，不散落组件）、转发语义事件、把 snapshot 投影成 InteractionView、完成时把 command 交给 executor。

> **`useSyncExternalStore` 引用稳定性（实现要点）**：Runtime 的 `getView()` 必须**在两次通知之间返回引用稳定的 InteractionView**，否则 `useSyncExternalStore` 会因每次都拿到新对象而判定为"无限变更"，触发 `Maximum update depth exceeded`。POC 在 Runtime 内缓存 `cachedView`，只在 `notify()` 时重新投影，`getView()` 返回缓存引用。

### 输入路径

```ts
function onEntityClick(hit: EntityRef) {
  const view = interactionRuntime.getView();
  if (!view.accepts.includes(hit.kind)) return;     // 工具无关的接受性过滤
  interactionRuntime.send(toCanvasEvent(hit));
}
```

这里 Canvas 只知道"当前接受哪类实体"，不出现 `if (tool === "construct-parallel")`。

### 完成路径

Runtime 订阅 actor：当 `snapshot.status === "done"` 时，若 output 是 `cancelled` 则清工具；否则把 command 交给 `executor.execute(output)`，触发 `onDone` 回调，再清工具。machine 完成只产 command，不直接修改 GeometryModel。

### React 绑定原则

- 用 `@xstate/react` 订阅 actor；组件只选择自己需要的 snapshot / view 字段。
- active tool actor 的创建与销毁放在 InteractionRuntime；不要把 actor 实例散落在各工具按钮组件。
- 第一版不需要 parent actor。先迁移 2–3 个工具，等共同模式稳定后再抽 ToolRegistry / ToolController。
- 如果以后要持久化交互状态，machine context 必须保持可序列化；不要把 GeometryModel class 实例塞进去。

### 高频 pointer move 的处理

默认不要把每个 `pointermove` 发送给 XState。pointer 坐标是高频、短寿命的渲染状态，留在 Canvas 层；预览函数读取 machine 的"已选参数"与当前 pointer，再查询 GeometryModel 计算 preview。

```ts
const preview = computePreview({
  spec: interactionView.preview,
  pointerWorld,
  geometry,
});
```

只有 hover 本身确实改变交互协议时，才把语义化的 `HOVER.ENTER / HOVER.LEAVE` 发送给 machine。

### 可访问性控制层

POC 的 `GeometryCanvas` 在画布旁渲染一组 HTML 按钮（`EntityControls`），按 `view.accepts` 动态列出当前可选的点 / 线。它**仍然是工具无关的**（渲染 `view.accepts` 允许的实体），既服务于键盘 / 屏幕阅读器用户，也提供了一个不依赖画布命中测试的可靠输入路径。这与现有 `TopicPracticeWorkspace` 的"并行 HTML 控制层"约定一致。

## 07 / 类型、校验、测试与回放

### 校验分两层

| 层 | 示例 | 作用 |
|----|------|------|
| Interaction guard | 第二步只能接受 line；禁止重复选择某实体 | 改善即时 UX，阻止明显非法 transition |
| Geometry command validator | 参考线是否存在；实体 revision 是否仍有效；构造是否满足领域约束 | 最终正确性；Human 与 Agent 都必须经过 |

XState 官方文档要求 guards 保持纯函数；因此不要让 guard 隐式修改 GeometryModel。若 guard 需要几何信息，应只读取不可变 snapshot / query 输入，或者把最终语义校验留到 command executor。

### 四类测试（POC 全部覆盖，`vitest`；初版 28 个，演进后 55 个全绿）

1. **Machine unit test**（`machines.test.ts`）：`createActor(machine)` → send events → 断言 matches / context / output。
2. **View projector test**（`projectors.test.ts`）：给固定 snapshot，断言 prompt、accepts、selected、preview。
3. **Command executor test**（`command-executor.test.ts`）：不经过 UI，直接执行 GeometryCommand，验证几何结果与错误。
4. **Integration test**（`runtime.integration.test.ts`）：Canvas hit → semantic event → machine done → command → geometry mutation。

后续如果工具状态组合变多，可以使用 XState v5 集成在 `xstate/graph` 下的 model-based testing；独立的 `@xstate/test` 已被官方标为 deprecated。

### 回放策略

| 目的 | 推荐记录 |
|------|---------|
| 重建几何结果 | GeometryCommand log |
| 分析用户如何操作 | CanvasEvent / interaction event log |
| 恢复未完成工具 | XState persisted snapshot（可选） |
| 跨 machine 版本长期兼容 | 优先 event / command migration，不依赖旧 snapshot 永久可读 |

XState v5 支持 persisted snapshot 与恢复，但官方也提醒 machine 逻辑变化可能导致旧 snapshot 不兼容。对本场景，领域 command log 更应该成为长期稳定的回放层。

## 08 / 实施顺序：先做窄 POC，不做大重构

1. ✅ 安装 XState v5 与 @xstate/react；确认 TypeScript ≥ 5，并开启 strict / strictNullChecks。
2. ✅ 先定义 GeometryCommand、CanvasEvent、InteractionView 三个协议。没有先写 ToolController。
3. ✅ 把 construct-parallel 迁成独立 machine + projector，新增独立 POC 页，其它工具不动。
4. ✅ 增加一个最薄的 InteractionRuntime：`startTool` / `send` / `getView` / `onDone` / `cancel`。
5. ✅ Canvas 输入改成 hit → semantic event；渲染提示从 InteractionView 读取。
6. ✅ 再迁移一个结构不同的工具 construct-circle；用第二个案例验证抽象是否真的通用。
7. ⏳ 迁移第三个工具后，再决定是否需要 ToolRegistry / parent ToolController actor。
8. ⏳ 最后清除旧 action step / reducer / Canvas switch；把 command executor 作为 Human、Agent、Replay 的统一入口。

### POC 验收标准（已达成）

- [x] `GeometryCanvas.tsx` 中不出现 construct-parallel 的步骤判断（grep 实证）。
- [x] 从 selectPoint → selectLine → done、BACK、CANCEL 均有独立测试。
- [x] 机器完成时只产出 command，不直接修改 GeometryModel。
- [x] 同一个 construct-parallel command 可以由 Agent 直接执行。
- [x] 新增 construct-circle 时不需要修改 Canvas 核心事件分发（实证：相同 `onClickEntity` 路径）。
- [x] pointermove 不造成 machine context 高频更新。
- [x] `npm run typecheck`、`npm run build`、`npm test` 全绿；浏览器跑通 POC 页（`/poc/geometry`）。

### 暂时不要做

- 不要一次迁移全部工具。
- 不要为了"统一"把所有工具塞进一个 union 巨型 machine。
- 不要把 UI 文案、preview rendering implementation 和 geometry mutation 全塞进 XState actions。
- 不要先上持久化 / 事件溯源；先证明协议边界正确。

## 09 / 主要风险与防护线

| 风险 | 症状 | 防护 |
|------|------|------|
| 把 XState 当全局 store | geometry、selection、UI、历史全进 context | 规定 GeometryModel 永远是领域事实源 |
| 机器过细 | hover / pointermove 每个像素都是 transition | 高频渲染状态留在 Canvas；只发送语义事件 |
| 机器过大 | 一个 canvasMachine 包含几十工具 | tool machine 独立；runtime 负责切换 |
| view 泄漏工具细节 | Canvas 根据 state.value 写大量 if | 统一 `project(snapshot)` → InteractionView |
| Agent 被 UI 协议绑住 | Agent 需要模拟两次点击才能构造线 | Agent 直接发送 GeometryCommand |
| guard 承担领域真理 | 换入口后绕过正确性检查 | GeometryModel validator 是最终 gate |
| 过早抽象 registry | 第一台 machine 就写复杂动态 actor 系统 | 至少两到三个差异工具后再抽共同层 |

### 最终建议

GO：现在就把 XState v5 用在 POC，但实施对象只选一个工具。第一步不是"搭一个完整状态机平台"，而是把 construct-parallel 从 Canvas 中切出去，证明 Canvas 可以只认识 InteractionView + CanvasEvent，machine 可以只产出 GeometryCommand。

如果这一条链路成立，后续工具迁移才有意义；如果链路不舒服，也能在极小范围内调整接口，而不会把项目押在一个大框架重构上。

## 附录 A / API 草案（POC 已实现）

```ts
export interface InteractionRuntime {
  startTool<TInput>(toolId: ToolId, input?: TInput): void;
  cancel(): void;
  send(event: CanvasEvent): void;
  getView(): InteractionView;
  activeToolId(): ToolId | undefined;
  subscribe(listener: () => void): () => void;
  onDone(handler: (completed: ToolCompleted) => void): () => void;
}

export interface ToolDefinition {
  id: ToolId;
  title: string;
  goal: string;
  machine: AnyStateMachine;
  project(snapshot: AnyMachineSnapshot): InteractionView;
}

export interface CommandExecutor {
  execute(command: GeometryCommand): CommandResult;
}
```

### 建议的依赖方向

```
geometry/domain          <- no XState, no React
geometry/interaction     <- XState + domain types
geometry/react           <- @xstate/react + interaction + domain queries
Canvas renderer          <- React binding + InteractionView
Agent                    <- domain/commands + executor
```

这一依赖方向的价值是：即使以后换掉 React 或 XState，GeometryCommand 与 GeometryModel 仍然是稳定资产。

## 附录 B / POC 现状

- **位置**：`web/frontend/src/geometry/`（独立模块，不污染 `web/shared/`、不动现有引擎）。
- **依赖**：`xstate@5.32`、`@xstate/react@6.1`、`jsxgraph@1.13`、`vitest@4.1` + `jsdom`（前端测试基建首次引入）。
- **入口**：`/poc/geometry`（自包含 demo 路由，不接入 session runtime、不进 `WORKSPACE_RENDERERS`）。
- **测试**：55 个，四类齐全（machine / projector / executor / integration），外加纯 `hit-test` 单测与 React `stale-closure` 回归。
- **运行验证**：浏览器实测全四阶段（过线点 → 参照边 → 第一外点 → 第二外点 → 完成），wrong/correct 反馈正确，command 写入 `parallel-line` 关系；construct-parallel 与 construct-circle 均通过同一无分支分发完成。
- **诚实说明**：POC 现为**任务驱动** Action（machine 强制 `ParallelActionSpec`，覆盖 PRD-03 §5.3 全四阶段），对应生产 `auxiliaryTwoRatios` 的 construct-parallel 步骤；但**尚未接线生产 session runtime**——步骤推进与判题仍归后端，前端 machine 只跑当前 Action。`GeoLine` 已建模为关系（`segment | parallel-line`），平行线只存 `through + parallelTo`，显示范围由渲染层推导。生产接线（machine 接进 `TopicPracticeWorkspace` 的 construct-parallel 分支，产出同一 `point:T|parallel:S|carrier:C0,C1` 字符串）作为后续工作。

## 附录 D / 生产 Canvas 接管（2026-08-09）

construct-parallel 已由工具无关的 JSXGraph `GeometryCanvas` **完整接管**，迁移桥（`mapInteractionView`、`NOOP_EXECUTOR`、`useConstructParallel`）拆除。详见 [ADR-003 "Canvas 接管"](../adr/ADR-003-xstate-geometry-canvas.md#canvas-接管2026-08-09)。

- **生产入口**：`web/frontend/src/geometry/production/TopicGeometryWorkspace.tsx`。construct-parallel 在 `TopicPracticeWorkspace` 内短路到这里；其余 primitive 继续走 legacy SVG Canvas + per-primitive switch。
- **直接消费 `{model, runtime}`**：新版 Canvas 不再经 `mapInteractionView` 翻译成旧 Canvas props（`availablePointIds`/`selectedSegments`/`constructionPreview`/`handlePoint`/`handleSegment`）。机器 snapshot 是唯一事实来源。
- **真实 executor**：完成时 `createCommandExecutor` 写入 `parallel-line` 关系，`modelVersion` bump 触发 Canvas 重绘最终构造（取代 no-op）。
- **坐标系**：`buildGeometryModel` 从 Tikz 坐标建 Y-up `GeometryModel`，JSXGraph 原生渲染——不存在翻转。背景图（411 张预渲染 Y-down `.preview.svg`）本轮不渲染；JSXGraph 原生点/线是唯一可命中层。
- **命中测试比例化**：`hitTolerances` 按 board 对角线取比例（点 ≈4.5%、线 ≈3%，floor 0.55/0.35），POC 小板与生产大板手感一致。
- **预览**：`PreviewSpec` 新增 `carrier-preview`；`PreviewLine` 的叠层 viewBox 从 `model.boundingBox()` 推导，平行线按 viewport 裁剪（Liang–Barsky），载体线 + 平行线 + 交点在渲染层计算。
- **无障碍**：`EntityButtonRow` 据 `InteractionView.entities` 中 `enabled` 实体生成按钮，不依赖像素命中。
- **测试**：80 条全绿；`tsc --noEmit` / `vitest` / `vite build` 全绿。

## 附录 C / 技术依据（XState v5 官方文档）

| 主题 | 说明 |
|------|------|
| XState overview | Stately Docs / XState — v5，state machines，actors，event-driven orchestration |
| setup() | Stately Docs / Setup — typed context/events/input/output/actions/guards；XState v5 |
| @xstate/react | Stately Docs / @xstate/react — useActor / useMachine React bindings |
| State snapshots | Stately Docs / State — matches()，can()，context，output and snapshots |
| Testing | Stately Docs / Testing — actor tests and xstate/graph model-based testing |
| Persistence | Stately Docs / Persistence — persisted snapshots，restoration and compatibility caveats |

参考时点：2026-08-08。报告按当前 XState v5 官方文档编写；实现时应锁定项目依赖版本并以对应版本文档为准。
