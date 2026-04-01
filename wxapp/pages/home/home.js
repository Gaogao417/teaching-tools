const { getTaskTree, getTaskHistory, DIFFICULTY_LABELS } = require('../../services/api')
const { formatMs, formatDateTime } = require('../../utils/format')
const { getLayoutState } = require('../../utils/layout')

function findFirstTask(grades) {
  if (!grades.length) {
    return null
  }
  const firstGrade = grades[0]
  if (!firstGrade.chapters || !firstGrade.chapters.length) {
    return null
  }
  const firstChapter = firstGrade.chapters[0]
  if (!firstChapter.tasks || !firstChapter.tasks.length) {
    return null
  }
  return {
    gradeId: firstGrade.id,
    chapterId: firstChapter.id,
    task: firstChapter.tasks[0]
  }
}

function findTaskById(grades, taskId) {
  for (let gradeIndex = 0; gradeIndex < grades.length; gradeIndex += 1) {
    const grade = grades[gradeIndex]
    for (let chapterIndex = 0; chapterIndex < grade.chapters.length; chapterIndex += 1) {
      const chapter = grade.chapters[chapterIndex]
      for (let taskIndex = 0; taskIndex < chapter.tasks.length; taskIndex += 1) {
        const task = chapter.tasks[taskIndex]
        if (task.id === taskId) {
          return task
        }
      }
    }
  }
  return null
}

function buildRenderTree(grades, expandedGradeIdsMap, expandedChapterIdsMap, selectedTaskId) {
  return grades.map((grade) => ({
    id: grade.id,
    name: grade.name,
    expanded: Boolean(expandedGradeIdsMap[grade.id]),
    arrowText: expandedGradeIdsMap[grade.id] ? '−' : '+',
    chapters: (grade.chapters || []).map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      expanded: Boolean(expandedChapterIdsMap[chapter.id]),
      arrowText: expandedChapterIdsMap[chapter.id] ? '−' : '+',
      tasks: (chapter.tasks || []).map((task) => ({
        id: task.id,
        title: task.title,
        summary: task.summary,
        active: selectedTaskId === task.id,
        rowClass: selectedTaskId === task.id ? 'tree-node task-row active' : 'tree-node task-row'
      }))
    }))
  }))
}

Page({
  data: {
    loading: true,
    layoutMode: 'wide',
    useDrawer: false,
    drawerOpen: false,
    drawerTreeClass: '',
    tree: [],
    expandedGradeIdsMap: {},
    expandedChapterIdsMap: {},
    selectedTaskId: '',
    selectedTask: null,
    selectedTaskSummary: '',
    selectedTaskSamplePrompt: '',
    selectedTaskColor: '#c96f3a',
    taskHistory: [],
    historyError: ''
  },

  onLoad() {
    this.applyLayout()
    this.loadPage()
  },

  onResize(event) {
    this.applyLayout(event)
  },

  async loadPage() {
    this.setData({ loading: true, historyError: '' })
    const response = await getTaskTree()
    const grades = response.grades || []
    const expandedGradeIdsMap = {}
    const expandedChapterIdsMap = {}
    const first = findFirstTask(grades)

    if (first) {
      expandedGradeIdsMap[first.gradeId] = true
      expandedChapterIdsMap[first.chapterId] = true
    }

    this.setData(
      {
        loading: false,
        tree: buildRenderTree(
          grades,
          expandedGradeIdsMap,
          expandedChapterIdsMap,
          first ? first.task.id : ''
        ),
        expandedGradeIdsMap,
        expandedChapterIdsMap,
        selectedTaskId: first ? first.task.id : '',
        selectedTask: first ? this.decorateTask(first.task) : null
      },
      async () => {
        this.syncTaskPresentation()
        if (first) {
          await this.loadHistory(first.task.id)
        }
      }
    )
  },

  applyLayout(source) {
    const layoutState = getLayoutState(source)
    this.setData({
      layoutMode: layoutState.layoutMode,
      useDrawer: layoutState.useDrawer,
      drawerOpen: layoutState.useDrawer ? this.data.drawerOpen : false,
      drawerTreeClass: layoutState.useDrawer
        ? `drawer-tree ${this.data.drawerOpen ? 'open' : ''}`
        : ''
    })
  },

  decorateTask(task) {
    return Object.assign({}, task, {
      difficultyLabel: DIFFICULTY_LABELS[task.difficulty] || '未分级'
    })
  },

  async loadHistory(taskId) {
    try {
      const history = await getTaskHistory(taskId)
      this.setData({
        taskHistory: history.map((item) => ({
          elapsedText: formatMs(item.elapsedMs),
          clearedAtText: formatDateTime(item.clearedAt),
          accuracyText: `${Math.round((item.firstTryAccuracy || 0) * 100)}%`
        })),
        historyError: ''
      })
    } catch (error) {
      this.setData({
        taskHistory: [],
        historyError: '历史记录加载失败'
      })
    }
  },

  toggleGrade(event) {
    const id = event.currentTarget.dataset.id
    const key = `expandedGradeIdsMap.${id}`
    const nextExpanded = !this.data.expandedGradeIdsMap[id]
    const nextExpandedGradeIdsMap = Object.assign({}, this.data.expandedGradeIdsMap)
    const payload = {}
    nextExpandedGradeIdsMap[id] = nextExpanded
    payload[key] = nextExpanded
    payload.tree = buildRenderTree(
      this.data.tree,
      nextExpandedGradeIdsMap,
      this.data.expandedChapterIdsMap,
      this.data.selectedTaskId
    )
    this.setData(payload)
  },

  toggleChapter(event) {
    const id = event.currentTarget.dataset.id
    const key = `expandedChapterIdsMap.${id}`
    const nextExpanded = !this.data.expandedChapterIdsMap[id]
    const nextExpandedChapterIdsMap = Object.assign({}, this.data.expandedChapterIdsMap)
    const payload = {}
    nextExpandedChapterIdsMap[id] = nextExpanded
    payload[key] = nextExpanded
    payload.tree = buildRenderTree(
      this.data.tree,
      this.data.expandedGradeIdsMap,
      nextExpandedChapterIdsMap,
      this.data.selectedTaskId
    )
    this.setData(payload)
  },

  async selectTask(event) {
    const taskId = event.currentTarget.dataset.taskId
    const task = findTaskById(this.data.tree, taskId)
    if (!task) {
      return
    }
    this.setData(
      {
        selectedTaskId: task.id,
        selectedTask: this.decorateTask(task),
        tree: buildRenderTree(
          this.data.tree,
          this.data.expandedGradeIdsMap,
          this.data.expandedChapterIdsMap,
          task.id
        )
      },
      async () => {
        this.syncTaskPresentation()
        if (this.data.useDrawer) {
          this.closeDrawer()
        }
        await this.loadHistory(task.id)
      }
    )
  },

  syncTaskPresentation() {
    const task = this.data.selectedTask
    this.setData({
      selectedTaskSummary: task && task.summary ? task.summary : '暂无任务说明',
      selectedTaskSamplePrompt: task && task.sample && task.sample.prompt ? task.sample.prompt : '暂无样题',
      selectedTaskColor: task && task.color ? task.color : '#c96f3a'
    })
  },

  toggleDrawer() {
    const nextDrawerOpen = !this.data.drawerOpen
    this.setData({
      drawerOpen: nextDrawerOpen,
      drawerTreeClass: this.data.useDrawer
        ? `drawer-tree ${nextDrawerOpen ? 'open' : ''}`
        : ''
    })
  },

  closeDrawer() {
    this.setData({
      drawerOpen: false,
      drawerTreeClass: this.data.useDrawer ? 'drawer-tree' : ''
    })
  },

  startPractice() {
    const { selectedTaskId } = this.data
    if (!selectedTaskId) {
      return
    }
    wx.navigateTo({
      url: `/pages/play/play?taskId=${selectedTaskId}`
    })
  }
})
