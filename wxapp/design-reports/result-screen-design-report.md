# Result Screen Design Report

## 1. Scope

Result Screen 的用户体验也不重做，保留当前结果页的基本结构和用途。

本次只明确：

- 小程序里如何承接 Play Screen 的结束结果
- 前后端分离后，结果数据如何取得
- 页面需要保留哪些展示内容

## 2. Kept Behavior

保留当前结果页的核心内容：

- 标题与完成说明
- 本次耗时
- 本组最佳
- 最近平均
- 历史趋势
- 再练一组 / 返回首页

不额外扩展成复杂复盘系统。

## 3. Page Responsibility

Result Screen 是一次练习完成后的静态结果展示页。

职责：

- 展示单次练习结果
- 展示最近趋势
- 提供下一步操作

它不负责：

- 重新计算成绩
- 重新生成题目
- 承载复杂编辑行为

## 4. Data Strategy

有两种可行方案：

### 方案 A

Play 调用 `finishPractice` 后，直接拿到 `resultSnapshot`，写入全局内存，再跳转 Result。

优点：

- 快
- 页面切换简单

缺点：

- 依赖全局内存

### 方案 B

Play 结束后只带 `sessionId` 跳转；Result 页面自行请求结果。

优点：

- 页面职责清晰
- 刷新后仍可恢复

缺点：

- 结果页多一次请求

对于前后端分离的小程序，建议用方案 B。

## 5. Backend Contract

`GET /api/practice/result/:sessionId`

```ts
interface ResultSnapshot {
  sessionId: string
  taskId: 'meaning' | 'ratioToSide' | 'guidedSolve'
  title: string
  groupLabel: string
  elapsedMs: number
  bestMs: number | null
  avgMs: number | null
  copy: string
  problemCount: number
  firstTryAccuracy: number
  firstTryCorrectCount: number
  color: string
  deltaVsPreviousMs: number | null
  history: {
    elapsedMs: number
    clearedAt: string
  }[]
}
```

这已经足够支持当前结果页，不需要额外扩大接口。

## 6. Mini Program Page State

```ts
interface ResultPageData {
  loading: boolean
  sessionId: string
  snapshot: ResultSnapshot | null
}
```

## 7. Page Structure

沿用当前结构：

```text
标题区
指标卡
趋势图
操作区
```

建议不要在这个阶段加入更多区块，否则会偏离“结果页不改”的要求。

## 8. Key Implementation Plan

### 8.1 Enter Flow

```text
Play finish
  -> navigateTo /pages/result/result?sessionId=xxx
  -> Result onLoad(sessionId)
  -> getPracticeResult(sessionId)
  -> render
```

### 8.2 Retry Flow

- 点击“再练一组”
- 使用 `snapshot.taskId` 跳回 Play Screen

### 8.3 Back Home Flow

- 点击“返回首页”
- 回到 Home Screen

## 9. Brief Code

### 9.1 WXML

```xml
<view class="result-screen">
  <view wx:if="{{loading}}">
    <text>加载中...</text>
  </view>

  <view wx:elif="{{snapshot}}">
    <view class="header">
      <view class="pill">本组完成</view>
      <text class="title">{{snapshot.title}}</text>
      <text class="copy">{{snapshot.copy}}</text>
    </view>

    <view class="metrics">
      <view class="metric-card">
        <text>本次耗时</text>
        <text>{{formatMs(snapshot.elapsedMs)}}</text>
      </view>
      <view class="metric-card">
        <text>本组最佳</text>
        <text>{{formatMs(snapshot.bestMs)}}</text>
      </view>
      <view class="metric-card">
        <text>最近平均</text>
        <text>{{formatMs(snapshot.avgMs)}}</text>
      </view>
    </view>

    <view class="history-card">
      <text>历史趋势</text>
      <canvas canvas-id="history-chart" class="chart"></canvas>
    </view>

    <view class="actions">
      <button class="primary-btn" bindtap="retry">再练一组</button>
      <button bindtap="backHome">返回首页</button>
    </view>
  </view>
</view>
```

### 9.2 JS

```js
import { getPracticeResult } from '../../services/api'

Page({
  data: {
    loading: true,
    sessionId: '',
    snapshot: null
  },

  async onLoad(query) {
    const sessionId = query.sessionId
    const snapshot = await getPracticeResult(sessionId)
    this.setData({ loading: false, sessionId, snapshot })
    this.drawChart(snapshot.history)
  },

  retry() {
    const { snapshot } = this.data
    wx.redirectTo({
      url: `/pages/play/play?taskId=${snapshot.taskId}`
    })
  },

  backHome() {
    wx.reLaunch({ url: '/pages/home/home' })
  }
})
```

## 10. Summary

Result Screen 不需要重新设计。

迁移到小程序时，最稳妥的做法是：

- Play 结束后带 `sessionId` 跳转
- Result 页面自行拉取结果
- 页面继续保持当前简洁的“指标 + 趋势 + 操作”结构
