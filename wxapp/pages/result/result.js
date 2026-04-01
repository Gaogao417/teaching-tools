const { getPracticeResult } = require('../../services/api')
const { formatMs, formatDateTime } = require('../../utils/format')
const { getLayoutState } = require('../../utils/layout')

Page({
  data: {
    loading: true,
    layoutMode: 'wide',
    sessionId: '',
    snapshot: null,
    chartBars: []
  },

  async onLoad(query) {
    this.applyLayout()
    const sessionId = query.sessionId || ''
    const snapshot = await getPracticeResult(sessionId)
    this.setData({
      loading: false,
      sessionId,
      snapshot: snapshot ? this.decorateSnapshot(snapshot) : null,
      chartBars: snapshot ? this.buildBars(snapshot.history || []) : []
    })
  },

  onResize(event) {
    this.applyLayout(event)
  },

  applyLayout(source) {
    const layoutState = getLayoutState(source)
    this.setData({
      layoutMode: layoutState.layoutMode
    })
  },

  decorateSnapshot(snapshot) {
    return Object.assign({}, snapshot, {
      elapsedText: formatMs(snapshot.elapsedMs),
      bestText: formatMs(snapshot.bestMs),
      avgText: formatMs(snapshot.avgMs),
      accuracyText: `${Math.round((snapshot.firstTryAccuracy || 0) * 100)}%`,
      deltaText: snapshot.deltaVsPreviousMs === null
        ? '无上次记录'
        : `${snapshot.deltaVsPreviousMs > 0 ? '+' : ''}${Math.round(snapshot.deltaVsPreviousMs / 1000)}s`
    })
  },

  buildBars(history) {
    if (!history.length) {
      return []
    }
    const maxMs = Math.max.apply(null, history.map((item) => item.elapsedMs))
    return history.map((item) => ({
      width: maxMs ? Math.max(18, Math.round((item.elapsedMs / maxMs) * 100)) : 18,
      elapsedText: formatMs(item.elapsedMs),
      clearedAtText: formatDateTime(item.clearedAt)
    }))
  },

  retry() {
    const { snapshot } = this.data
    if (!snapshot) {
      return
    }
    wx.redirectTo({
      url: `/pages/play/play?taskId=${snapshot.taskId}`
    })
  },

  backHome() {
    wx.reLaunch({
      url: '/pages/home/home'
    })
  }
})
