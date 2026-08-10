# PRD-01：Action 驱动的学习与练习工作台

## 文档状态

- 状态：Proposed
- 日期：2026-08-10
- 优先级：P0
- 目标端：Web 学生端
- 相关决策：[ADR-004 前端 Action Runtime 与后端教学计划边界](../../adr/ADR-004-frontend-action-runtime.md)
- 迁移计划：[Action Runtime 迁移计划](../../execution/action-driven-workspace-migration-plan.md)

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

- backend 返回题目 metadata、公开世界模型、coach profile 和有序 `ActionList`；
- frontend 通过本地注册的 XState machine 执行 action，不为每次语义点击请求 backend；
- 页面级 machine 同时管理 Canvas、answer、coach 和 controls 的实时状态；
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
- 新增 action 类型时只新增 machine、projector、evidence schema、可选 evaluator 和 renderer capability。
- Learn、Guided Practice 和 Assessment 共用 action vocabulary，根据 validation policy 改变答案公开程度。

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
- 不在第一阶段替换 scenario bank、authoring pipeline、学习进度或结果统计系统。
- 不把工作台变成无约束的自由画板。

## 5. 用户模式与判题策略

| 模式 | ActionList 内容 | 本地能力 | backend 能力 |
| --- | --- | --- | --- |
| Learn | 可包含完整解题 action 与目标参数 | 本地演示、回放、即时判断 | 提供内容；可选记录学习进度 |
| Guided Practice | 可公开当前教学目标；隐藏未到达步骤 | 本地结构判断与教学反馈 | checkpoint、AI coach、可选权威复核 |
| Assessment | 只含公开指令、候选对象和完成结构 | 判断输入是否完整，不判断私有数学真值 | 私有判题、计分、诊断、正式推进 |

`ActionContract.validationPolicy` 必须显式声明：

- `local-teaching`：目标参数属于教学内容，可以在 frontend 本地判断；
- `server-authoritative`：frontend 只能判断 evidence 结构完整，正确性由 backend 决定。

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
3. machine 更新 context；projector 生成新的 WorkspaceView。
4. UI 立即响应，不请求 backend。
5. action 完成时产生 typed evidence 和可选 geometry command。
6. page machine 提交 checkpoint 或进入下一个本地 action。

### 6.3 学生请求指导

1. 学生点击“问老师”，或本地策略检测到连续错误。
2. frontend 发送当前 `StudentTrace`，包括当前 action、machine state、已选对象、answer draft、最近事件和学生消息。
3. backend/AI 返回 `CoachDirective`。
4. page machine 接收 directive，同时更新 coach、Canvas 高亮、answer focus 与可用 controls。

该请求不得阻塞 Canvas 的本地交互；超时后学生仍可继续操作。

### 6.4 正式提交

1. frontend machine 确认 evidence 结构完整。
2. `local-teaching` action 可直接完成，并异步 checkpoint。
3. `server-authoritative` action 将 typed evidence 发送 backend。
4. backend 独立校验 session、action、revision 和私有答案。
5. backend 返回 accepted/rejected、结构化 diagnosis、committed world delta 与 next action。
6. page machine 根据返回值进入正确反馈、错误修正或下一 action。

## 7. Action 产品契约

每个 action 必须同时定义：

- 稳定的 `kind` 与 `version`；
- 学生可见 instruction；
- machine 构造参数；
- 需要的 page/canvas capabilities；
- answer 槽声明；
- validation policy；
- typed evidence 输出；
- 完成后产生的领域结果；
- 可供 coach 使用的语义标签。

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
- AI 请求和遥测上传不得阻塞本地 machine。
- action evidence 与 event batch 必须有 idempotency key 或 revision，避免重试造成重复提交。
- frontend 未知 action kind/version 时显示可恢复错误，不静默降级成错误交互。

## 11. 安全与隐私

- Assessment plan 不包含私有答案或等价可推导字段。
- backend 不信任 frontend snapshot；正式判题只信任经 schema 校验的 evidence，并使用 session 固定的 scenario/version。
- StudentTrace 只上传指导所需的最近事件与当前状态，不上传 DOM、屏幕录制或无关个人数据。
- AI 输出必须经过结构化 schema、能力白名单和模式权限检查。
- 所有 action/coach/evidence contract 均带版本号。

## 12. 验收标准

1. `make-parallel → intersect-carriers` 可在无语义点击网络请求的情况下完成。
2. Canvas、answer、coach 和 controls 从同一个 page machine snapshot 派生。
3. Learn 模式可只依赖一次 ExercisePlan 请求完成整题演示与本地判断。
4. Assessment 模式的浏览器 payload 不包含私有 accepted answers。
5. 学生主动求助时，backend 能依据 StudentTrace 返回对象高亮与 answer focus 指令。
6. AI 在 Learn 模式可通过受限 AgentCommand 驱动同一 action runtime；无需模拟 DOM 点击。
7. 任一未知 action kind/version 均被明确拒绝并可回退旧 runtime。
8. 不再新增 `topic-answer` 专用字符串 serializer；新 action 使用 typed evidence。
9. 页面同时只存在一个活动 child action actor。
10. 旧 session 在迁移期仍可恢复和完成。

## 13. 成功指标

- 新 action 接入不修改 Canvas、CoachPanel 或 AnswerPanel 主体。
- 学生语义点击产生的网络请求数降为零。
- 专用 primitive switch 与 answer serializer 数量随迁移阶段持续下降。
- AI coach 请求能够携带完整、结构化且可解释的当前学习上下文。
- 因跨组件状态不同步产生的错误反馈、按钮状态和恢复问题归零。

## 14. 待定产品决策

- Guided Practice 中哪些 action 允许公开完整目标参数。
- 未完成 action 是否只存浏览器，还是在页面隐藏/离开时异步 checkpoint 到 backend。
- AI 自动执行 action 前的确认策略是否按年龄、模式或 action 风险分级。
- Learn 模式是否记录完整 event trace，还是只记录 action completion。
