# PRD-02：能力进度与开启规则

## 文档状态

- 状态：Draft
- 优先级：P0
- 依赖：现有 session、result 与 action event 持久化
- 后续依赖方：PRD-01、PRD-04、PRD-05

## 1. 背景与问题

现有系统有任务历史、完成用时和首次正确率，但没有“能力是否掌握”“节点是否通关”这一层产品真值。若直接制作图谱，前端只能根据历史次数或路由状态猜测节点状态，容易产生：

- 完成一次训练就被误判为掌握。
- 改了通关或推荐规则后多端表现不一致。
- 无法解释系统为什么推荐先学某个节点。
- 挑战成功后无法用结构化证据验证跳关。

## 2. 产品目标

- 建立服务端拥有的能力进度、节点开启状态与推荐结果。
- 把任务完成、能力掌握和节点开启 / 通关拆成不同概念。
- 支持一个节点依赖多个能力，也支持一个任务验证多个能力。
- 为地图、挑战和补强提供同一份事实源。

## 3. 核心概念

### 3.1 能力单元 `capability`

首版至少包含：

- `similarity.mark-known-segments`
- `similarity.map-corresponding-sides`
- `similarity.transfer-ratio-shares`
- `similarity.construct-parallel-helper`
- `similarity.convert-collinear-segments`
- `similarity.read-crossed-vertex-order`
- `similarity.build-side-equation`

### 3.2 内部节点进度

- `not_started`
- `in_progress`
- `completed`

表示学生是否走完该专题的学习或训练流程，不直接等于掌握，也不直接作为图谱文案。

### 3.3 图谱展示状态

- `unopened` / 未开启：普通专题尚未满足开启条件；挑战节点尚未被主动开启。
- `open` / 开启：普通专题已满足开启条件，或挑战节点已被主动开启，但尚未通关。节点内部是 `not_started` 还是 `in_progress`，都只显示“开启”。
- `passed` / 通关：满足节点的通关条件。

图谱只允许显示这三种状态。`unopened` 使用未开启的中性视觉，不使用锁图标、“锁定 / 解锁”文案或不可选择的禁用卡片；学生仍可查看详情和题目预览。

### 3.4 能力掌握

- `unobserved`：没有独立作答证据。
- `developing`：出现过正确证据，但仍需明显提示或反复纠错。
- `mastered`：独立完成了该能力的代表性动作。

首版不向学生展示数值分数，只展示离散状态。

## 4. 掌握判定

### 4.1 最低规则

能力达到 `mastered`，必须同时满足：

- 证据来自 Practice 或 Challenge，不能只来自 Learn 示范。
- 核心动作由学生完成，不能仅提交最终答案。
- 题目判定为正确。
- 证据记录了对应 `capabilityId` 与 `stepId`。

具体需要多少道题、允许多少次提示，作为服务端可配置规则，不写死在前端。

### 4.2 不允许作为唯一掌握证据

- 打开或浏览过学习页。
- 只完成最终数值输入。
- 训练总用时。
- 题组总分但缺少动作级记录。

## 5. 开启与通关规则

学习节点的开启规则由能力依赖声明，而非任务 ID 顺序声明。未满足条件时，图谱显示“未开启”并提供缺失前置跳转，不显示锁。

示例：

```ts
type TopicOpeningRule = {
  nodeId: string;
  requiresAll: string[];
  requiresAny?: string[];
  passRequiresAll: string[];
  passRequiresAny?: string[];
};
```

推荐首版：

| 节点 | 开启所需能力 |
| --- | --- |
| 平行线比例 | 无 |
| 比例辅助线 | 对应边、份数迁移、按份数列式 |
| 反 A 形 | 对应边、按份数列式 |
| 子母型 | 对应边、按份数列式 |
| 蝶形 | 对应边、按份数列式 |

子母型自身新增验证“共线边互化”；蝶形自身新增验证“交叉点序”。

图谱状态转换：

```text
未开启 --满足开启条件--> 开启 --满足通关条件--> 通关
```

- 开启节点无论是否已经开始学习，都统一显示“开启”；具体按钮根据是否存在可恢复 session 显示“开始”或“继续”。
- 退出、失败或补强不会让已经开启的节点退回未开启。
- 通关后再次训练不会撤销通关；能力降级策略若未来引入，必须另行评审，首版不支持。
- 前置能力不足时，服务端返回缺失的具体 `capabilityId`，学生可从节点详情跳到对应前置；不得返回锁定状态名。
- 挑战节点继续使用 PRD-04 的软门槛：即使显示未开启，也能主动挑战，创建 challenge session 后转为开启。

## 6. 推荐节点计算

服务端为每个学生返回至多一个 `recommendedNodeId`：

1. 优先返回内部进度为 `in_progress` 但未通关的节点。
2. 没有进行中节点时，返回已开启且尚未通关的最前置节点。
3. 所有主线节点掌握后，返回可挑战但未通过的挑战节点。
4. 补强回路进行中时，由 PRD-05 的 resume context 覆盖普通推荐。

## 7. 数据与 API

建议新增：

```ts
type StudentCapabilityState = {
  capabilityId: string;
  state: "unobserved" | "developing" | "mastered";
  evidenceCount: number;
  updatedAt: string;
};

type StudentTopicProgress = {
  studentName: string;
  nodeId: string;
  state: "not_started" | "in_progress" | "completed";
  lastTaskId?: TaskId;
  lastStepId?: string;
  updatedAt: string;
};
```

需要提供：

- 查询学生图谱状态。
- session 完成后重算受影响能力。
- challenge 完成后写入跨能力证据。
- 能力规则版本化，避免规则更新后历史记录不可解释。

## 8. 与现有系统边界

- `ResultSnapshot` 继续保存题组结果与复盘数据。
- `RuntimeActionEvent` 增加或映射 `capabilityId`，但前端不自行判断正确性。
- `TaskHistoryItem` 继续用于历史趋势，不作为图谱展示状态或推荐事实源。
- 当前 `TaskTreeResponse` 不承载学生状态，图谱使用独立接口。

## 9. 验收标准

1. 同一学生刷新或换路由后，节点状态保持一致。
2. 仅完成 Learn 不会把能力标成 `mastered`。
3. Practice 中完成核心动作后，相关能力状态能够更新。
4. 节点展示状态与推荐结果由服务端返回，前端没有重复规则表。
5. 每个未开启节点都能返回缺失的具体 `capabilityId`，但学生可见界面不出现锁图标或锁定状态名。
6. 规则版本更新后，能够区分旧证据和新规则。

## 10. 测试重点

- 新学生初始状态。
- 有未完成 session 的学生。
- Learn 完成但未 Practice。
- 多个能力部分掌握。
- 挑战成功带来的能力验证。
- 同一动作多次提交不重复累计证据。
