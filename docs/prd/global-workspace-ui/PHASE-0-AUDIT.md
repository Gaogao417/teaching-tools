# 阶段 0：样式与布局审计

## 1. 文件概览

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `styles.css` | 194 | 全局令牌、重置、通用组件 |
| `styles/pages.css` | 340 | 页面外壳、导航、Learn/Review/Similarity 布局 |
| `styles/practice.css` | 2651 | Practice 运行时、Topic 练习、几何画布、HUD |

`practice.css` 体量远超另外两个文件之和，是本次迁移的主要治理对象。

---

## 2. 重复与冲突规则

### 2.1 `.modal-backdrop` 重复定义

| 位置 | 规则 |
| --- | --- |
| `styles.css:180` | `position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: var(--space-4); background: var(--color-overlay);` |
| `practice.css:909` | `position: fixed; inset: 0; background: var(--color-overlay); display: grid; place-items: center; padding: var(--space-4); z-index: 40;` |

**冲突**：`z-index` 不一致（80 vs 40）。`practice.css` 版本后加载会覆盖 `styles.css` 版本。

**迁移建议**：保留 `styles.css` 中的全局版本（z-index: 80），删除 `practice.css:909-917` 的重复定义。如 Practice 场景需要不同层级，通过 modifier class 调整。

### 2.2 `.ks-practice-main` 多次完整重定义

| 位置 | 关键差异 |
| --- | --- |
| `practice.css:1325-1334` | `width: min(1480px, 100%); height: calc(100vh - var(--ks-top-nav-height)); min-height: 640px;` |
| `practice.css:1469-1475` | `width: 100%; max-width: 1400px; min-height: calc(100vh - var(--ks-top-nav-height, 64px));` |
| `practice.css:2404-2414` | `width: min(1480px, 100%); max-width: none; height: calc(100vh - var(--ks-top-nav-height));` |

**冲突**：三处定义了不同的 `width`/`max-width`/`height` 策略。最后一处（2404）胜出，但前两处仍在文件中造成混淆。

**迁移建议**：合并为单一定义。全局工作台阶段应确定一个标准宽度令牌。

### 2.3 `.ks-practice-page` 重复定义

| 位置 | 关键差异 |
| --- | --- |
| `practice.css:1320-1323` | `min-height: calc(100vh - var(--ks-top-nav-height));` |
| `practice.css:1464-1467` | `position: relative; min-height: calc(100vh - var(--ks-top-nav-height, 64px));` |

**差异**：后者添加了 `position: relative` 和 fallback 值 `64px`。

**迁移建议**：合并为一处，统一使用 `var(--ks-top-nav-height)` 令牌（`pages.css:2` 已定义为 `64px`）。

### 2.4 `.ks-history-modal` 重复定义

| 位置 | 关键差异 |
| --- | --- |
| `practice.css:1436-1443` | 简洁版本，`padding: var(--space-5)` |
| `practice.css:1585-1594` | 装饰版本，`padding: 24px; backdrop-filter: blur(18px); background: rgba(255,255,255,0.96)` |

**冲突**：后者覆盖前者，两套样式混杂。

**迁移建议**：删除 `1436-1443`，保留 `1585-1594` 作为最终版本。

### 2.5 `.ks-history-row` 重复定义

| 位置 | 关键差异 |
| --- | --- |
| `practice.css:1440` | `padding: var(--space-3); border: 1px solid var(--color-line); border-radius: var(--radius-md);` |
| `practice.css:1619-1627` | `padding: 14px 16px; border-radius: 18px; background: rgba(240,244,255,0.82); border: 1px solid rgba(31,100,255,0.08);` |
| `practice.css:2441-2446` | 回退为 `padding: var(--space-3); border: 1px solid var(--color-line); border-radius: var(--radius-md); background: #fff;` |

**冲突**：三处定义，最后一处覆盖第二处的装饰性样式。

**迁移建议**：确定最终视觉意图后合并为一处。

### 2.6 `.practice-ambient-topbar` 重复定义

| 位置 | 关键差异 |
| --- | --- |
| `practice.css:351-358` | `padding: var(--space-4) 0; justify-content: center;` |
| `practice.css:360-370` | `padding: 0 1.5rem; height: 64px; justify-content: space-between; background: var(--bg-surface, #fff);` |
| `practice.css:1189-1197` | `padding: 18px 22px; min-height: 88px; background: rgba(255,255,255,0.78); border-radius: 28px; backdrop-filter: blur(18px);` |

**冲突**：三处定义，视觉意图完全不同。

**迁移建议**：删除前两处，保留第三处作为最终版本。

### 2.7 硬编码颜色值散落

`practice.css` 中存在大量硬编码颜色，未使用设计令牌：

| 硬编码值 | 出现次数 | 应替换为 |
| --- | --- | --- |
| `#fff` / `white` | ~40+ | `var(--surface-card)` 或 `var(--color-panel)` |
| `#f0f4f7` | 6 | `var(--surface-subtle)` 或新令牌 |
| `#566166` | 5 | `var(--color-slate-700)` |
| `#1f64ff` | ~15 | `var(--color-primary)` |
| `rgba(31,100,255,...)` | ~10 | `var(--color-primary)` + alpha |
| `#4439cb` | 2 | `var(--color-accent-text)` |
| `#b65d17` | 2 | 新令牌 `--color-warning-strong` |
| `rgba(239,68,68,...)` | 3 | `var(--color-danger)` + alpha |
| `rgba(34,197,94,...)` | 3 | `var(--color-success)` + alpha |

---

## 3. Similarity 样式分类

### 3.1 可全局化视觉规则

以下 similarity 样式表达了通用设计语言，可提升到全局层：

| 类名 | 表达的通用语义 | 建议全局类名 |
| --- | --- | --- |
| `.similarity-map-hero` | 页面头部 flex 布局 | `ks-page-hero` |
| `.similarity-map-hero h1` | 大标题 clamp 字号 | 统一到 `--text-xl` clamp |
| `.similarity-map-legend` | 标签/图例行 | `ks-legend-row` |
| `.similarity-state` | 状态 pill | 复用 `.pill` 或扩展状态变体 |
| `.similarity-detail-block` | 详情卡片块 | `ks-detail-block` |
| `.similarity-detail-head` | 详情头部 | `ks-detail-head`（已存在于 styles.css） |
| `.similarity-detail-actions` | 操作按钮组 | `ks-action-row`（已存在） |
| `.similarity-map-detail` | sticky 侧栏 | `ks-sticky-sidebar` |

### 3.2 图谱专属规则

以下样式仅服务于 similarity 地图的拓扑结构，应保留在页面层：

| 类名 | 专属原因 |
| --- | --- |
| `.similarity-map-canvas` | 网格拓扑（5 行 × 5 列 grid） |
| `.similarity-map-lane` | lane 编号与竖排文字 |
| `.lane-two`, `.lane-three` | lane 行跨度 |
| `.similarity-map-node-slot` | 节点槽位 grid 定位 |
| `.slot-parallel`, `.slot-auxiliary`, etc. | 具体槽位列/行 |
| `.similarity-map-challenges` | challenge 行 |
| `.similarity-map-node` | 节点卡片形状与状态 |
| `.similarity-map-node.kind-challenge` | challenge 圆角形状 |
| `.similarity-map-preview-trigger` | 预览触发器 |
| `.similarity-map-question-preview` | 预览浮层 |
| `.similarity-map-edge-layer` | SVG 连线层 |
| `.similarity-map-edge-layer line` | 连线样式 |
| `.edge-challenge-requires` | 虚线依赖边 |

---

## 4. 视口高度链路分析

### 4.1 `100vh` / `min-height` 使用清单

| 文件:行 | 选择器 | 规则 | 链路角色 |
| --- | --- | --- | --- |
| `styles.css:97` | `html, body, #root` | `min-height: 100%` | 根节点 |
| `styles.css:100` | `body` | `min-height: 100vh` | 视口基准 |
| `styles.css:125` | `.screen` | `min-height: 100vh` | 全屏容器 |
| `pages.css:1-4` | `.ks-app-shell` | `min-height: 100vh` | 应用外壳 |
| `pages.css:59` | `.ks-app-body` | `min-height: 100vh; padding-top: var(--ks-top-nav-height)` | 导航以下区域 |
| `pages.css:60` | `.ks-content-area` | `min-height: calc(100vh - var(--ks-top-nav-height))` | 内容区 |
| `pages.css:106` | `.ks-learn-stage` | `min-height: calc(100vh - 180px)` | Learn 工作台 |
| `pages.css:124` | `.ks-debrief-hero` | `min-height: calc(100vh - var(--ks-top-nav-height) - 80px)` | Review 首屏 |
| `practice.css:314` | `.practice-immersive-shell` | `min-height: calc(100vh - 60px)` | Practice 旧外壳 |
| `practice.css:1167-1168` | `.practice-immersive-shell` | `min-height: calc(100vh - 72px)` | Practice 旧外壳覆盖 |
| `practice.css:1321` | `.ks-practice-page` | `min-height: calc(100vh - var(--ks-top-nav-height))` | Practice 页面 |
| `practice.css:1327` | `.ks-practice-main` | `height: calc(100vh - var(--ks-top-nav-height)); min-height: 640px` | Practice 主区域 |
| `practice.css:1466` | `.ks-practice-page` | `min-height: calc(100vh - var(--ks-top-nav-height, 64px))` | Practice 页面覆盖 |
| `practice.css:1474` | `.ks-practice-main` | `min-height: calc(100vh - var(--ks-top-nav-height, 64px))` | Practice 主区域覆盖 |
| `practice.css:1672` | `.ks-practice-body` | `min-height: min(720px, calc(100vh - var(--ks-top-nav-height, 64px) - 76px))` | Practice 双栏 |
| `practice.css:2407` | `.ks-practice-main` | `height: calc(100vh - var(--ks-top-nav-height)); min-height: 640px` | Practice 主区域最终覆盖 |
| `practice.css:2646` | `.ks-topic-learn-page .ks-practice-main` | `height: auto; min-height: calc(100vh - 72px)` | Topic Learn 覆盖 |

### 4.2 `overflow` 使用清单

| 文件:行 | 选择器 | 规则 | 影响 |
| --- | --- | --- | --- |
| `practice.css:4` | `.practice-port-shell` | `overflow: hidden` | 隐藏溢出 |
| `practice.css:14` | `.topic-practice-canvas` | `overflow: hidden` | 隐藏溢出 |
| `practice.css:78` | `.topic-practice-object` | `overflow: hidden` | 隐藏溢出 |
| `practice.css:1361` | `.ks-runtime-stage` | `overflow: hidden` | 运行时舞台隐藏溢出 |
| `practice.css:2434` | `.ks-runtime-stage-canvas` | `overflow: hidden` | 画布隐藏溢出 |
| `practice.css:2647` | `.topic-runtime-frame .ks-runtime-stage-canvas` | `overflow: visible` | Topic Learn 可见溢出 |
| `practice.css:2648` | `.topic-runtime-frame .artifact-topic-canvas` | `overflow: visible` | Topic Learn 可见溢出 |
| `practice.css:2649` | `.topic-runtime-frame .artifact-math-object` | `overflow: visible` | Topic Learn 可见溢出 |
| `practice.css:2650` | `.topic-runtime-frame .artifact-diagram-stage` | `overflow: visible` | Topic Learn 可见溢出 |
| `practice.css:1436` | `.ks-history-modal` | `overflow: auto` | 弹窗滚动 |

### 4.3 桌面固定视口高度链路确认

**Practice 页面**（当前生效链路）：

```
body (min-height: 100vh)
  → .ks-app-shell (min-height: 100vh)
    → .ks-app-body (min-height: 100vh; padding-top: 64px)
      → .ks-content-area (min-height: calc(100vh - 64px))
        → .ks-practice-page (min-height: calc(100vh - 64px))
          → .ks-practice-main (height: calc(100vh - 64px); display: grid; grid-template-rows: auto minmax(0,1fr) auto)
            → HUD row (auto)
            → .ks-runtime-stage (minmax(0,1fr); min-height: 0)
            → action dock row (auto)
```

**确认**：`min-height: 0` 链路在 `.ks-runtime-stage` 上成立（`practice.css:2433`），`overflow: hidden` 在 stage canvas 上成立（`practice.css:2434`）。桌面固定视口无滚动的条件满足。

**Topic Learn 页面**（当前生效链路）：

```
.ks-topic-learn-page .ks-practice-main (height: auto; min-height: calc(100vh - 72px))
  → grid-template-rows: auto auto（非 minmax(0,1fr)）
```

**问题**：`height: auto` + `grid-template-rows: auto auto` 意味着内容自然撑高，页面会超出视口。这是 Topic Learn 当前页面滚动的直接来源。

---

## 5. Topic Learn 问题溯源

### 5.1 页面滚动来源

**直接原因**：`practice.css:2646`

```css
.ks-topic-learn-page .ks-practice-main {
  height: auto;
  min-height: calc(100vh - 72px);
  grid-template-rows: auto auto;
}
```

`height: auto` 允许容器随内容增长，`grid-template-rows: auto auto` 没有弹性行，导致画布区域不受视口约束。

**修复方向**：改回 `height: calc(100vh - 72px)` 并使用 `grid-template-rows: auto minmax(0, 1fr)`。

### 5.2 题图过大来源

`practice.css:2650-2651`：

```css
.topic-runtime-frame .artifact-diagram-stage { min-height: 390px; overflow: visible; }
.topic-runtime-frame .topic-geometry-canvas { width: min(780px, 100%); max-height: none; }
```

`max-height: none` + `min-height: 390px` 在高度不受约束时会让题图无限放大。

**修复方向**：使用容器可用高度约束（`max-height: calc(100% - ...)` 或 `flex: 1; min-height: 0`）。

### 5.3 动作区过高来源

Topic Learn 使用 `.ks-action-dock`（`practice.css:1413-1423`）：

```css
.ks-action-dock { min-height: 82px; ... }
```

`82px` 对于简单点击任务过高。PRD 建议压缩为 `52-64px`。

---

## 6. 未提交样式归属确认

`git status` 显示以下样式文件有未提交修改：

| 文件 | 归属 |
| --- | --- |
| `web/frontend/src/styles/pages.css` | 已修改 — 归属 similarity 学习地图 PRD 工作 |
| `web/frontend/src/styles/practice.css` | 已修改 — 归属 Topic Learn 和 Practice 运行时重构 |

**同时修改的组件文件**：

- `TopicPracticeWorkspace.tsx` — Topic 练习工作区
- `TopicRuntimeFrame.tsx` — Topic 运行时框架
- `LearnPage.tsx` — 普通 Learn 页面
- `SimilarityLearningMapPage.tsx` — Similarity 地图页面
- `RuntimeActionDock.tsx` — 运行时动作区

**结论**：当前未提交修改集中在 Topic Learn 和 Similarity 两个功能域，与本次全局工作台迁移高度相关。迁移前应先合并或暂存这些修改，避免冲突。

---

## 7. 规则迁移表

### 7.1 待删除（有明确替代项）

| 旧规则 | 位置 | 替代项 |
| --- | --- | --- |
| `.modal-backdrop` (z-index: 40) | `practice.css:909-917` | `styles.css:180` (z-index: 80) |
| `.ks-practice-main` 第一处 | `practice.css:1325-1334` | `practice.css:2404-2414`（最终版） |
| `.ks-practice-main` 第二处 | `practice.css:1469-1475` | `practice.css:2404-2414`（最终版） |
| `.ks-practice-page` 第一处 | `practice.css:1320-1323` | `practice.css:1464-1467`（更完整） |
| `.ks-history-modal` 第一处 | `practice.css:1436-1443` | `practice.css:1585-1594`（最终版） |
| `.practice-ambient-topbar` 前两处 | `practice.css:351-370` | `practice.css:1189-1197`（最终版） |
| `.practice-immersive-shell` 第一处 | `practice.css:311-318` | `practice.css:1166-1169`（最终版） |

### 7.2 待提升到全局令牌

| 当前硬编码 | 位置 | 建议令牌 |
| --- | --- | --- |
| `#f0f4f7` (背景色) | `practice.css` 多处 | `--surface-guide` 或复用 `--surface-subtle` |
| `#566166` (文本色) | `practice.css` 多处 | `--color-slate-700`（已存在） |
| `rgba(255,255,255,0.78)` (毛玻璃背景) | `practice.css:1193` | `--surface-glass` |
| `rgba(255,255,255,0.88)` (半透明白) | `practice.css:1216` | `--surface-glass-strong` |
| `24px` / `28px` (大圆角) | `practice.css` 多处 | `--radius-xl` (24px) |
| `18px` (中大圆角) | `practice.css` 多处 | `--radius-lg-alt` (18px) |
| `82px` (动作区高度) | `practice.css:1414` | `--ks-action-bar-height` |

### 7.3 待提升到全局类

| 来源 | 建议全局类名 | 语义 |
| --- | --- | --- |
| `.similarity-map-hero` 布局 | `ks-page-hero` | 页面头部 flex 布局 |
| `.similarity-detail-block` | `ks-detail-block` | 详情信息块 |
| `.similarity-state` pill | `ks-state-pill` | 状态标签 |
| `.practice-canvas-zone` 边框/圆角 | `ks-focus-canvas` | 焦点画布容器 |
| `.practice-guide-zone` 边框/圆角 | `ks-focus-rail` | 指导栏容器 |
| `.ks-action-dock` 布局 | `ks-focus-action-bar` | 紧凑动作条 |

---

## 8. 阶段出口检查

- [x] 形成规则迁移表（§7）
- [x] 每个待删除的旧规则都有明确替代项（§7.1）
- [x] 桌面固定视口的高度链路得到确认（§4.3）
