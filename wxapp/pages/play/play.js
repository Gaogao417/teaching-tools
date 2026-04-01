const { startPractice, submitAnswer, finishPractice, ROLE_LABELS, SIDE_BY_ROLE } = require('../../services/api')
const { formatMs } = require('../../utils/format')
const { getLayoutState } = require('../../utils/layout')

const AUTO_ADVANCE_DELAY = 700

function buildProgress(currentIndex, total) {
  if (!total) {
    return 0
  }
  return Math.round(((currentIndex + 1) / total) * 100)
}

Page({
  data: {
    loading: true,
    layoutMode: 'wide',
    taskId: '',
    sessionId: '',
    problems: [],
    currentIndex: 0,
    currentProblem: null,
    elapsedMs: 0,
    formattedTime: '00:00',
    phase: 'answering',
    selectedRoles: {
      numerator: '',
      denominator: ''
    },
    edgeInputs: {
      AB: '',
      BC: '',
      AC: ''
    },
    knownMap: {
      opposite: '',
      adjacent: '',
      hypotenuse: ''
    },
    ratioMap: {
      opposite: '',
      adjacent: '',
      hypotenuse: ''
    },
    thirdInput: '',
    finalInputs: {
      numerator: '',
      denominator: ''
    },
    actionBanner: '当前任务：先看公式，再根据提示完成本题。',
    feedbackMessage: '',
    progressPercent: 0,
    selectedNumeratorLabel: '未选择',
    selectedDenominatorLabel: '未选择',
    edgeFields: [],
    knownFields: [],
    ratioFields: [],
    roleCards: [
      { id: 'opposite', label: ROLE_LABELS.opposite, side: SIDE_BY_ROLE.opposite, color: '#db6d48' },
      { id: 'adjacent', label: ROLE_LABELS.adjacent, side: SIDE_BY_ROLE.adjacent, color: '#2f8f77' },
      { id: 'hypotenuse', label: ROLE_LABELS.hypotenuse, side: SIDE_BY_ROLE.hypotenuse, color: '#64748b' }
    ]
  },

  onLoad(query) {
    this.applyLayout()
    this.loadSession(query.taskId || '')
  },

  onResize(event) {
    this.applyLayout(event)
  },

  onUnload() {
    this.clearTimer()
    this.clearAdvanceTimer()
  },

  async loadSession(taskId) {
    this.setData({ loading: true })
    const response = await startPractice({ taskId })
    this.setData({
      loading: false,
      taskId,
      sessionId: response.sessionId,
      problems: response.problems,
      currentIndex: 0,
      currentProblem: response.problems[0] || null,
      progressPercent: buildProgress(0, response.problems.length),
      actionBanner: this.buildActionBanner(response.problems[0]),
      feedbackMessage: ''
    })
    this.resetInputs()
    this.startTimer()
  },

  applyLayout(source) {
    const layoutState = getLayoutState(source)
    this.setData({
      layoutMode: layoutState.layoutMode
    })
  },

  startTimer() {
    this.clearTimer()
    const startAt = Date.now()
    this.timerHandle = setInterval(() => {
      const elapsedMs = Date.now() - startAt
      this.setData({
        elapsedMs,
        formattedTime: formatMs(elapsedMs)
      })
    }, 1000)
  },

  clearTimer() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle)
      this.timerHandle = null
    }
  },

  clearAdvanceTimer() {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer)
      this.advanceTimer = null
    }
  },

  buildActionBanner(problem) {
    if (!problem) {
      return '当前任务：准备开始。'
    }
    if (problem.kind === 'meaning') {
      return '当前任务：先选分子边，再选分母边。'
    }
    if (problem.kind === 'ratioToSide') {
      return '当前任务：把三角比落回到 AB / BC / AC 三条边上。'
    }
    return '当前任务：按 4 个教师口令顺序完成本题。'
  },

  resetInputs() {
    this.setData(
      {
        selectedRoles: { numerator: '', denominator: '' },
        edgeInputs: { AB: '', BC: '', AC: '' },
        knownMap: { opposite: '', adjacent: '', hypotenuse: '' },
        ratioMap: { opposite: '', adjacent: '', hypotenuse: '' },
        thirdInput: '',
        finalInputs: { numerator: '', denominator: '' },
        phase: 'answering'
      },
      () => {
        this.syncFormViews()
      }
    )
  },

  syncFormViews() {
    const { roleCards, selectedRoles, edgeInputs, knownMap, ratioMap } = this.data
    const selectedNumerator = roleCards.find((item) => item.id === selectedRoles.numerator)
    const selectedDenominator = roleCards.find((item) => item.id === selectedRoles.denominator)
    this.setData({
      selectedNumeratorLabel: selectedNumerator ? selectedNumerator.label : '未选择',
      selectedDenominatorLabel: selectedDenominator ? selectedDenominator.label : '未选择',
      edgeFields: roleCards.map((item) => ({
        id: item.id,
        side: item.side,
        label: item.label,
        value: edgeInputs[item.side] || ''
      })),
      knownFields: roleCards.map((item) => ({
        id: item.id,
        label: item.label,
        value: knownMap[item.id] || ''
      })),
      ratioFields: roleCards.map((item) => ({
        id: item.id,
        label: item.label,
        value: ratioMap[item.id] || ''
      }))
    })
  },

  chooseRole(event) {
    const role = event.detail.role
    const slot = event.detail.slot
    const key = `selectedRoles.${slot}`
    const payload = {}
    payload[key] = role
    this.setData(payload, () => {
      this.syncFormViews()
    })
  },

  handleEdgeInput(event) {
    const key = `edgeInputs.${event.detail.side}`
    const payload = {}
    payload[key] = event.detail.value
    this.setData(payload, () => {
      this.syncFormViews()
    })
  },

  handleKnownInput(event) {
    const key = `knownMap.${event.detail.role}`
    const payload = {}
    payload[key] = event.detail.value
    this.setData(payload, () => {
      this.syncFormViews()
    })
  },

  handleRatioInput(event) {
    const key = `ratioMap.${event.detail.role}`
    const payload = {}
    payload[key] = event.detail.value
    this.setData(payload, () => {
      this.syncFormViews()
    })
  },

  handleThirdInput(event) {
    this.setData({ thirdInput: event.detail.value })
  },

  handleFinalInput(event) {
    const key = `finalInputs.${event.detail.slot}`
    const payload = {}
    payload[key] = event.detail.value
    this.setData(payload)
  },

  async submitCurrent() {
    const { currentProblem, sessionId, selectedRoles, edgeInputs, knownMap, ratioMap, thirdInput, finalInputs, phase } = this.data
    if (!currentProblem || phase === 'correct_pause') {
      return
    }

    let payload = {}
    if (currentProblem.kind === 'meaning') {
      payload = selectedRoles
    } else if (currentProblem.kind === 'ratioToSide') {
      payload = edgeInputs
    } else {
      payload = {
        knownMap,
        ratioMap,
        thirdValue: thirdInput,
        final: finalInputs
      }
    }

    const response = await submitAnswer({
      sessionId,
      problemId: currentProblem.id,
      payload
    })

    const problems = this.data.problems.slice()
    problems[this.data.currentIndex] = response.problemState
    this.setData({
      problems,
      currentProblem: response.problemState,
      feedbackMessage: response.hint,
      phase: response.correct ? 'correct_pause' : 'wrong_feedback'
    })

    if (response.correct) {
      this.clearAdvanceTimer()
      this.advanceTimer = setTimeout(() => {
        this.advanceOrFinish()
      }, AUTO_ADVANCE_DELAY)
    }
  },

  async advanceOrFinish() {
    const { currentIndex, problems, sessionId } = this.data
    const nextIndex = currentIndex + 1
    if (nextIndex < problems.length) {
      this.setData({
        currentIndex: nextIndex,
        currentProblem: problems[nextIndex],
        progressPercent: buildProgress(nextIndex, problems.length),
        actionBanner: this.buildActionBanner(problems[nextIndex]),
        feedbackMessage: ''
      })
      this.resetInputs()
      return
    }

    this.clearTimer()
    const result = await finishPractice({ sessionId })
    wx.redirectTo({
      url: `/pages/result/result?sessionId=${result.sessionId}`
    })
  },

  restart() {
    this.clearTimer()
    this.clearAdvanceTimer()
    this.loadSession(this.data.taskId)
  },

  backHome() {
    this.clearTimer()
    this.clearAdvanceTimer()
    wx.reLaunch({
      url: '/pages/home/home'
    })
  }
})
