# Home Screen Design Report

## 1. Scope

本次只重做 Home Screen 的页面排布和交互逻辑。

- `task` 的含义等于当前的 `group`
- 左侧改为“年级 -> 章节 -> 任务”的级联树
- 单击任务后，右侧展示任务详情
- Play Screen 和 Result Screen 的用户体验不改
- 目标实现形态是前后端分离的微信小程序

## 2. Design Goal

Home Screen 从“3 张并列 group-card 的入口页”改为“课程树 + 详情面板”的任务选择页。

核心目标：

- 把训练入口嵌入课程结构
- 降低首页的信息噪声
- 用户先定位到任务，再决定开始练习

## 3. Information Architecture

后端提供树结构，前端只负责渲染与交互。

```text
年级
  └─ 章节
      └─ 任务
          └─ taskId = 当前 group.id
```

约束：

- “任务”不是单题，而是当前 3 个训练 group 之一
- 年级、章节数据由后端提供
- 任务详情中的难度、样题、steps 也由后端返回
- 训练历史可按 taskId 单独查询

## 4. Page Layout

桌面端采用左右分栏：

```text
┌────────────────────┬──────────────────────────────────────┐
│ 左：任务树         │ 右：任务详情                         │
│ 年级               │ 标题 / 难度 / 样题 / steps / 历史    │
│  └ 章节            │                                      │
│     └ 任务         │ [开始练习]                           │
└────────────────────┴──────────────────────────────────────┘
```

移动端：

- 左侧任务树收起成抽屉
- 默认展示右侧详情区域
- 通过顶部按钮打开任务树

## 5. Interaction Design

### 5.1 Tree Behavior

- 单击年级：展开 / 收起该年级
- 单击章节：展开 / 收起该章节
- 单击任务：选中任务，并刷新右侧详情
// TODO: so when would task id unveil?

不做的事：

- 不双击进入练习
- 不在树节点上直接展示复杂统计

### 5.2 Detail Panel

任务被选中后，右侧展示：

- 任务标题
- 难度
- 样题
- 解题步骤
- 训练历史
- 开始练习按钮

空状态：

- 未选择任务时，展示“请先从左侧选择任务”

### 5.3 Start Practice

- 点击“开始练习”后跳转到 Play Screen
- 传参使用 `taskId`
- `taskId` 直接映射到现有 group 逻辑

## 6. Backend Contract

这是 Home Screen 需要的最小接口，不扩展到 Play / Result。

### 6.1 Task Tree

`GET /api/task-tree`

```ts
interface TaskTreeResponse {
  grades: GradeNode[]
}

interface GradeNode {
  id: string
  name: string
  chapters: ChapterNode[]
}

interface ChapterNode {
  id: string
  name: string
  tasks: TaskNode[]
}

interface TaskNode {
  id: 'meaning' | 'ratioToSide' | 'guidedSolve'
  title: string
  summary: string
  difficulty: 'easy' | 'medium' | 'hard'
  sample: {
    prompt: string
    answerPreview?: string
  }
  steps: string[]
  color?: string
}
```

### 6.2 Task History

`GET /api/task-history/:taskId`

```ts
interface TaskHistoryItem {
  elapsedMs: number
  clearedAt: string
  problemCount: number
  firstTryAccuracy: number
}
```

说明：

- `taskId` 与现有 group id 对齐
- 难度、样题、steps 不在前端硬编码
- 历史记录单独查，避免树接口过重

## 7. Mini Program Page State

```ts
interface HomePageData {
  loading: boolean
  isMobile: boolean
  drawerOpen: boolean
  tree: GradeNode[]
  expandedGradeIds: string[]
  expandedChapterIds: string[]
  expandedGradeIdsMap: Record<string, boolean>
  expandedChapterIdsMap: Record<string, boolean>
  selectedTaskId: string
  selectedTask: TaskNode | null
  taskHistory: TaskHistoryItem[]
}
```

说明：

- 不要把 `Set` 直接放进页面数据
- 小程序 `data` 里用数组或对象映射

## 8. Key Implementation Plan

### 8.1 File Structure

```text
pages/
  home/
    home.wxml
    home.wxss
    home.js
    home.json
services/
  api.js
```

### 8.2 Rendering Strategy

- `onLoad` 拉取任务树
- 默认展开第一个年级和第一个章节
- 默认选中第一个任务
- 选中任务后再请求该任务历史

这样首屏简单，逻辑也稳定。

### 8.3 Format And UI Rules

为了避免首页做成“后台树控件”，这里需要明确格式约束：

- 左树右详情，而不是左右都塞满统计卡片
- 树节点只展示名称，不展示样题、steps、历史摘要
- 详情区按“标题 -> 难度 -> 样题 -> steps -> 历史 -> CTA”固定顺序排布
- `steps` 用编号列表，不用长段落
- 历史最多展示最近 5 条，完整历史不在首页展开
- 移动端抽屉打开时，详情区只保留遮罩下的背景，不做双栏压缩

### 8.4 Resolved Decisions

这里不再保留开放式 TODO，直接给出实现决策：

- `task-tree` 接口由后端保证顺序，前端按返回顺序直接渲染，不再额外排序
- `difficulty` 在 UI 上统一映射成中文文案：
  - `easy -> 入门`
  - `medium -> 进阶`
  - `hard -> 挑战`
- `sample.answerPreview` 默认不展示，只展示题干，避免首页提前剧透答案
- 训练历史在首页最多展示最近 5 条；若后端返回更多，前端自行截断
- 移动端判断采用 `wx.getSystemInfoSync()` 配合样式响应式，两者都保留：
  - JS 决定是否显示“任务导航”按钮
  - WXSS 负责抽屉样式和窄屏布局

补充约束：

- 若 `task-tree` 首个年级或章节为空，页面不自动兜底生成节点，只展示空状态
- 若历史接口失败，详情区历史模块显示“历史记录加载失败”，但不影响开始练习
- `difficulty`、`sample`、`steps` 缺失时，详情区显示占位文案，不让页面塌掉

## 9. Brief Code

### 9.1 WXML

```xml
<view class="home-screen">
  <view class="mobile-topbar" wx:if="{{isMobile}}">
    <button bindtap="toggleDrawer">任务导航</button>
  </view>

  <view class="home-layout">
    <view class="tree-panel {{drawerOpen ? 'open' : ''}}">
      <block wx:for="{{tree}}" wx:key="id">
        <view class="grade-row" bindtap="toggleGrade" data-id="{{item.id}}">
          <text>{{item.name}}</text>
        </view>

        <view wx:if="{{expandedGradeIdsMap[item.id]}}">
          <block wx:for="{{item.chapters}}" wx:key="id">
            <view class="chapter-row" bindtap="toggleChapter" data-id="{{item.id}}">
              <text>{{item.name}}</text>
            </view>

            <view wx:if="{{expandedChapterIdsMap[item.id]}}">
              <block wx:for="{{item.tasks}}" wx:key="id">
                <view
                  class="task-row {{selectedTaskId === item.id ? 'active' : ''}}"
                  bindtap="selectTask"
                  data-task-id="{{item.id}}"
                >
                  <text>{{item.title}}</text>
                </view>
              </block>
            </view>
          </block>
        </view>
      </block>
    </view>

    <view class="detail-panel">
      <view wx:if="{{!selectedTask}}" class="empty-state">
        <text>请先从左侧选择任务</text>
      </view>

      <view wx:else class="detail-content">
        <text class="title">{{selectedTask.title}}</text>
        <text class="summary">{{selectedTask.summary}}</text>
        <text class="section">难度：{{selectedTask.difficulty}}</text>

        <view class="card">
          <text class="section">样题</text>
          <text>{{selectedTask.sample.prompt}}</text>
        </view>

        <view class="card">
          <text class="section">解题步骤</text>
          <view wx:for="{{selectedTask.steps}}" wx:key="index">
            <text>{{index + 1}}. {{item}}</text>
          </view>
        </view>

        <view class="card">
          <text class="section">训练历史</text>
          <view wx:if="{{!taskHistory.length}}">
            <text>暂无练习记录</text>
          </view>
          <view wx:else wx:for="{{taskHistory}}" wx:key="clearedAt">
            <text>{{item.clearedAt}} · {{item.problemCount}}题</text>
          </view>
        </view>

        <button class="primary-btn" bindtap="startPractice">开始练习</button>
      </view>
    </view>
  </view>
</view>
```

### 9.2 WXSS

```css
.home-screen {
  min-height: 100vh;
  background: #f7f4ed;
  color: #2f2a24;
}

.mobile-topbar {
  padding: 24rpx;
  border-bottom: 1rpx solid rgba(47, 42, 36, 0.08);
  background: rgba(255, 252, 246, 0.96);
}

.home-layout {
  display: flex;
  min-height: 100vh;
}

.tree-panel {
  width: 280rpx;
  flex-shrink: 0;
  padding: 24rpx;
  background: #fbf8f1;
  border-right: 1rpx solid rgba(47, 42, 36, 0.08);
  overflow-y: auto;
}

.detail-panel {
  flex: 1;
  min-width: 0;
  padding: 32rpx;
}

.grade-row,
.chapter-row,
.task-row {
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
}

.grade-row {
  font-size: 30rpx;
  font-weight: 600;
}

.chapter-row {
  margin-left: 20rpx;
  font-size: 28rpx;
  color: #5f564c;
}

.task-row {
  margin-left: 40rpx;
  font-size: 26rpx;
  color: #6c6258;
}

.task-row.active {
  background: rgba(184, 92, 56, 0.12);
  color: #b85c38;
  font-weight: 600;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.title {
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.3;
}

.summary {
  font-size: 28rpx;
  color: #6c6258;
  line-height: 1.7;
}

.section {
  font-size: 26rpx;
  font-weight: 600;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding: 24rpx;
  border-radius: 24rpx;
  background: rgba(255, 252, 246, 0.92);
  border: 1rpx solid rgba(47, 42, 36, 0.08);
}

.primary-btn {
  margin-top: 16rpx;
  border-radius: 999rpx;
  background: #b85c38;
  color: #fff;
}

@media (max-width: 768px) {
  .home-layout {
    display: block;
  }

  .tree-panel {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 76vw;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    z-index: 20;
  }

  .tree-panel.open {
    transform: translateX(0);
  }

  .detail-panel {
    padding: 24rpx;
  }
}
```

样式方向说明：

- 树区和详情区需要明显分层，但不要做成深色侧边栏
- 激活任务只强调一层，不同时加描边、阴影、背景三种强提示
- 详情区的卡片统一圆角和边框格式，避免每块一个视觉语言

### 9.3 JS

```js
import { getTaskTree, getTaskHistory } from '../../services/api'

Page({
  data: {
    loading: true,
    drawerOpen: false,
    tree: [],
    expandedGradeIds: [],
    expandedChapterIds: [],
    selectedTaskId: '',
    selectedTask: null,
    taskHistory: []
  },

  async onLoad() {
    const res = await getTaskTree()
    const tree = res.grades || []
    const firstGrade = tree[0]
    const firstChapter = firstGrade?.chapters?.[0]
    const firstTask = firstChapter?.tasks?.[0] || null

    this.setData({
      loading: false,
      tree,
      expandedGradeIds: firstGrade ? [firstGrade.id] : [],
      expandedChapterIds: firstChapter ? [firstChapter.id] : [],
      selectedTaskId: firstTask?.id || '',
      selectedTask: firstTask
    })

    if (firstTask) this.loadTaskHistory(firstTask.id)
  },

  async loadTaskHistory(taskId) {
    const taskHistory = await getTaskHistory(taskId)
    this.setData({ taskHistory })
  },

  selectTask(e) {
    const taskId = e.currentTarget.dataset.taskId
    const selectedTask = this.findTaskById(taskId)
    this.setData({ selectedTaskId: taskId, selectedTask, drawerOpen: false })
    this.loadTaskHistory(taskId)
  },

  startPractice() {
    const { selectedTaskId } = this.data
    wx.navigateTo({ url: `/pages/play/play?taskId=${selectedTaskId}` })
  }
})
```

## 10. Summary

Home Screen 的重心是“任务选择结构重做”，不是把现有 group-card 换个皮肤。

关键决定只有三个：

- `task` 直接映射当前 group
- 年级 / 章节 / 任务由后端树接口提供
- 移动端树结构收起为抽屉，详情区保持为主视图
