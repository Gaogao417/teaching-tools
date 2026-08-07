# KS 全局工作台 UI 实施计划

## 1. 改版目标

Similarity 原型是新版全局 UI 的基准实现，而不是页面限定样式。本计划将其中可复用的视觉语言抽取为全局设计系统，再逐步迁移学习和训练工作台。

目标结构：

```text
全局设计令牌
  ↓
通用 KS 焦点工作台
  ├─ Topic Learn
  ├─ 普通 Learn
  ├─ Practice
  └─ Similarity 页面基础视觉

Similarity 页面专属层
  └─ 节点拓扑、连线、lane、challenge 形状
```

## 2. 阶段 0：样式与布局审计

### 工作内容

- 盘点 `styles.css`、`pages.css`、`practice.css` 中重复或冲突的设计规则。
- 将 similarity 样式标记为“可全局化视觉规则”或“图谱专属规则”。
- 梳理 `100vh / 100dvh`、`min-height`、`overflow` 和自然高度覆盖关系。
- 记录 Topic Learn 当前页面滚动、题图过大和动作区过高的直接来源。
- 确认未提交样式的归属，避免覆盖用户正在进行的其他修改。

### 阶段出口

- 形成规则迁移表。
- 每个待删除的旧规则都有明确替代项。
- 桌面固定视口的高度链路得到确认。

## 3. 阶段 1：冻结全局设计契约

### 全局语义令牌

在 `web/frontend/src/styles.css` 中统一定义：

- 工作台最大宽度和页面内边距；
- 指导栏标准宽度；
- 主表面、指导表面和活动表面；
- 默认、成功、警告、错误和未开始状态；
- 标题、题目、正文、说明和眉题字号；
- 紧凑动作条高度；
- 通用圆角、边框和必要的层级阴影。

### 通用构型

建立不含页面领域语义的基础类：

```text
ks-focus-page
ks-focus-workspace
ks-focus-prompt
ks-focus-canvas
ks-focus-rail
ks-focus-action-bar
ks-task-progress
ks-coach-bubble
```

### 边界

- 全局层不出现 `similarity`、具体题型或 capability 名称。
- 不把地图坐标、节点连线和题图命中区域提升到全局层。
- 不用新的硬编码色值代替旧硬编码色值。

## 4. 阶段 2：迁移 Topic Learn

### 布局调整

- 导航栏以下使用固定桌面视口。
- 建立从页面到 runtime、canvas、diagram 的完整 `min-height: 0` 高度链。
- 正常桌面尺寸禁止页面级纵向滚动。
- 题干、题图、教师指导和当前动作同屏显示。

### 比例调整

- 指导栏控制在约 `260–280px`。
- 题图使用容器可用高度约束，避免仅按宽度放大。
- 简单点击任务的动作区压缩为 `52–64px` 工具条。
- 方程、比例输入等复杂任务保留可扩展动作区。

### 涉及文件

- `web/frontend/src/components/exercises/topicPractice/TopicRuntimeFrame.tsx`
- `web/frontend/src/components/exercises/topicPractice/TopicPracticeWorkspace.tsx`
- `web/frontend/src/styles/practice.css`

### 阶段出口

- 四个任务步骤切换时布局不跳动。
- 完整题图和当前动作始终可见。
- 错误提示变长时优先在指导区内部处理溢出。

## 5. 阶段 3：迁移普通 Learn

### 工作内容

- 使用全局焦点工作台替换旧式大标题和宽 instruction 卡片。
- 收敛页面标题、当前动作标题和步骤标题的字体层级。
- 删除当前动作在标题、说明和步骤行中的重复表达。
- 将步骤进度整合进指导栏，但保持低噪音，不恢复重卡片时间线。
- 将上一步、下一步固定在紧凑动作区。

### 涉及文件

- `web/frontend/src/pages/LearnPage.tsx`
- `web/frontend/src/styles/pages.css`

### 阶段出口

- 普通 Learn 与 Topic Learn 具有相同页面骨架和密度。
- 教学步骤仍可直接跳转。
- 长中文标题不会挤压主操作对象。

## 6. 阶段 4：迁移 Practice 外壳

### 工作内容

- 复用全局工作台尺寸、表面、指导栏和动作条。
- 保留训练专属 HUD、计时、反馈、历史和提交行为。
- 将训练反馈限制在当前对象和当前动作，不增加新的全局卡片层。

### 阶段出口

- Learn 与 Practice 切换时视觉结构稳定。
- 训练功能和 session 恢复行为无回归。

## 7. 阶段 5：回收 Similarity 页面样式

### 提升到全局层

- 字体与信息层级；
- 表面、边框和状态颜色；
- 通用指导栏和详情块；
- 间距、圆角和交互焦点；
- 低噪音按钮与动作表达。

### 保留在页面层

- `similarity-map-canvas` 的网格拓扑；
- 节点槽位和 lane；
- SVG 连线；
- challenge 节点形状；
- 图谱专属响应式重排。

### 阶段出口

- `similarity-map-*` 不再定义独立设计系统。
- 页面专属 CSS 只表达地图结构和领域状态。

## 8. 阶段 6：响应式与可访问性

### 桌面

- 宽度不小于 `721px` 且高度充足时，焦点工作台无页面级纵向滚动。
- 局部超长内容使用明确的内部溢出容器。

### 窄屏和矮屏

- 工作台改为单列。
- 允许自然滚动，确保内容不被裁切。
- 教师提示移动到主对象之后。
- 动作区保持触摸目标尺寸。

### 可访问性

- 当前步骤使用 `aria-current="step"`。
- 错误反馈使用合适的 live region。
- 所有题图动作支持键盘焦点。
- 连接线和纯装饰元素不进入可访问性树。

## 9. 验收矩阵

### 视觉尺寸

| 视口 | 预期 |
| --- | --- |
| 1920×1080 | 单屏，无页面纵向滚动 |
| 1440×900 | 单屏，题图与动作区完整可见 |
| 1024×768 | 紧凑桌面布局，无横向溢出 |
| 390×844 | 单列自然滚动，操作目标可触摸 |

### 状态覆盖

- Topic Learn：四个步骤、正确、错误、完成。
- 普通 Learn：第一步、中间步骤、最后一步。
- Practice：回答中、错误反馈、正确暂停、完成。
- Similarity：未开启、开启、通关、推荐、challenge。

### 工程验证

- 前端类型检查和相关单元测试通过。
- 无新增控制台错误。
- `document.scrollHeight === document.clientHeight` 在目标桌面工作台成立。
- 页面切换无明显布局跳动。
- 样式中不存在新增的无语义硬编码颜色。

## 10. 实施顺序

```text
审计
  → 全局契约
  → Topic Learn
  → 普通 Learn
  → Practice
  → Similarity 样式回收
  → 响应式与统一验收
```

每个迁移阶段独立验证，避免一次性替换全部页面后难以定位视觉或交互回归。
