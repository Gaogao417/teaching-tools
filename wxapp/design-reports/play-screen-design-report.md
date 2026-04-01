# Play Screen Design Report

## 1. Scope

Play Screen 的用户体验不重做，保留当前页面结构和交互方式。

本次设计报告只解决两件事：

- 把现有 Play Screen 迁移成前后端分离的微信小程序页面
- 明确 Home Screen 改为 task-tree 后，Play Screen 如何无缝承接 `taskId`

## 2. Kept Behavior

保留当前核心体验：

- 顶部状态栏：返回、重开、进度、计时、表现指标
- 中部左右结构：左图形，右交互
- 三类任务的现有玩法不变
- 完成整组后进入结果流

换句话说：

- 不改题型
- 不改答题节奏
- 不改练习流程

## 3. Page Responsibility

Play Screen 负责一次完整的练习会话：

1. 根据 `taskId` 创建 session
2. 拉取题目列表
3. 逐题提交答案
4. 维护本地界面状态
5. 整组结束后提交 finish
6. 跳转 Result Screen

## 4. Input Contract

Home Screen 跳转时传入：

```text
taskId = meaning | ratioToSide | guidedSolve
```

这与当前 group id 一致，因此 Play Screen 的业务含义不变。

## 5. Backend Contract

### 5.1 Start Practice

`POST /api/practice/start`

```ts
interface StartPracticeRequest {
  taskId: 'meaning' | 'ratioToSide' | 'guidedSolve'
  problemCount?: number
  guidedDifficulty?: 'simple' | 'hard'
}

interface StartPracticeResponse {
  sessionId: string
  taskId: string
  problems: Problem[]
}
```

### 5.2 Submit Answer

`POST /api/practice/answer`

```ts
interface AnswerRequest {
  sessionId: string
  problemId: string
  payload: Record<string, any>
}

interface AnswerResponse {
  correct: boolean
  allSolved: boolean
  hint?: string
  problemState: Problem
}
```

### 5.3 Finish Practice

`POST /api/practice/finish`

```ts
interface FinishPracticeRequest {
  sessionId: string
}

interface FinishPracticeResponse {
  sessionId: string
  resultSnapshot: ResultSnapshot
}
```

说明：

- 前端不再本地生成整组题目
- 前端保留界面级状态
- 题目正确性判断由后端负责

## 6. Mini Program Page State

```ts
interface PlayPageData {
  loading: boolean
  taskId: string
  sessionId: string
  problems: Problem[]
  currentIndex: number
  currentProblem: Problem | null
  elapsedMs: number
  phase: 'answering' | 'correct_pause' | 'wrong_feedback' | 'group_finished'

  selectedRoles: string[]
  edgeInputs: Record<string, string>
  ratioInputs: Record<string, string>
  thirdInput: string
  finalInputs: {
    numerator: string
    denominator: string
  }

  actionBanner: string
  feedbackMessage: string
}
```

## 7. Page Structure

小程序页面结构保持现有信息架构，不引入新的区块。

```text
顶部状态栏
主舞台
  左：三角形图形
  右：当前题交互区
底部辅助区
```

实现上可以拆成 3 类组件：

- `practice-header`
- `triangle-stage`
- `practice-panel`

## 8. Key Implementation Plan

### 8.1 Load Flow

```text
onLoad(taskId)
  -> startPractice(taskId)
  -> set sessionId + problems
  -> render first problem
```

### 8.2 Submit Flow

```text
用户作答
  -> submitAnswer(problemId, payload)
  -> 后端返回 correct/problemState
  -> 更新当前 problem
  -> 若 allSolved，则切到下一题
```

### 8.3 Finish Flow

```text
最后一题完成
  -> finishPractice(sessionId)
  -> 拿到 resultSnapshot
  -> navigateTo result page
```

## 9. Brief Code

### 9.1 WXML

```xml
<view class="play-screen" wx:if="{{!loading && currentProblem}}">
  <view class="topbar">
    <button bindtap="backHome">返回首页</button>
    <button bindtap="restart">重新开始本组</button>
    <text>第 {{currentIndex + 1}} / {{problems.length}} 题</text>
    <text>{{formattedTime}}</text>
  </view>

  <view class="main-stage">
    <view class="left-panel">
      <triangle-stage problem="{{currentProblem}}" />
    </view>

    <view class="right-panel">
      <practice-panel
        problem="{{currentProblem}}"
        selectedRoles="{{selectedRoles}}"
        edgeInputs="{{edgeInputs}}"
        ratioInputs="{{ratioInputs}}"
        thirdInput="{{thirdInput}}"
        finalInputs="{{finalInputs}}"
      />
    </view>
  </view>

  <view class="bottom-panel">
    <text>{{actionBanner}}</text>
    <text>{{feedbackMessage}}</text>
  </view>
</view>
```

### 9.2 JS

```js
import {
  startPractice,
  submitAnswer,
  finishPractice
} from '../../services/api'

Page({
  data: {
    loading: true,
    taskId: '',
    sessionId: '',
    problems: [],
    currentIndex: 0,
    currentProblem: null
  },

  async onLoad(query) {
    const taskId = query.taskId
    const res = await startPractice({ taskId })

    this.setData({
      loading: false,
      taskId,
      sessionId: res.sessionId,
      problems: res.problems,
      currentIndex: 0,
      currentProblem: res.problems[0]
    })
  },

  async handleSubmit(payload) {
    const { sessionId, currentProblem, currentIndex, problems } = this.data
    const res = await submitAnswer({
      sessionId,
      problemId: currentProblem.id,
      payload
    })

    const nextProblems = [...problems]
    nextProblems[currentIndex] = res.problemState

    this.setData({
      problems: nextProblems,
      currentProblem: res.problemState
    })

    if (res.allSolved) this.advanceOrFinish()
  },

  async advanceOrFinish() {
    const { currentIndex, problems, sessionId } = this.data
    if (currentIndex < problems.length - 1) {
      this.setData({
        currentIndex: currentIndex + 1,
        currentProblem: problems[currentIndex + 1]
      })
      return
    }

    const res = await finishPractice({ sessionId })
    getApp().globalData.resultSnapshot = res.resultSnapshot
    wx.navigateTo({ url: `/pages/result/result?sessionId=${sessionId}` })
  }
})
```

## 10. Summary

Play Screen 的设计决定很简单：

- 继续沿用当前 UI 结构
- 只把本地会话改成服务端 session
- 用 `taskId` 承接新的 Home Screen 任务树入口

因此这个页面是“迁移实现”，不是“重新设计”。
