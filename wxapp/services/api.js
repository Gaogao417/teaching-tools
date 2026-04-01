const STORAGE_KEY = 'trig-practice-wxapp'
const AUTO_PROBLEM_COUNT = 5
const TASK_TREE = [
  {
    id: 'grade-9',
    name: '九年级',
    chapters: [
      {
        id: 'chapter-trig-ratio',
        name: '锐角三角比',
        tasks: [
          {
            id: 'meaning',
            title: '认清 sin / cos / tan / cot 的意思',
            summary: '识别三角比对应的分子边与分母边。',
            difficulty: 'easy',
            sample: {
              prompt: '已知参考角 A，指出 sin A 的分子边和分母边。'
            },
            steps: [
              '先找清题目给出的参考角。',
              '判断贴着参考角的直角边是哪条邻边，另一条直角边是哪条对边。',
              '根据三角比定义，按顺序选出分子边和分母边。'
            ],
            color: '#c96f3a'
          },
          {
            id: 'ratioToSide',
            title: '已知三角比，把数字放到对应边上',
            summary: '根据已知三角比，补全三边长度。',
            difficulty: 'medium',
            sample: {
              prompt: '已知 sin A = 3/5，请把三个边长填到三角形对应位置。'
            },
            steps: [
              '先根据参考角判断三条边分别对应对边、邻边和斜边。',
              '把已知三角比中的分子和分母放回到对应角色的边上。',
              '若第三边未给出，再用勾股关系补全三边。'
            ],
            color: '#2f8f77'
          },
          {
            id: 'guidedSolve',
            title: '已知两边，分步求三角比',
            summary: '根据两条已知边，逐步求出目标三角比。',
            difficulty: 'hard',
            sample: {
              prompt: '已知两条边的长度关系，分步求出目标三角比。'
            },
            steps: [
              '先把已知长度标到图上，并判断它们对应的边角色。',
              '把实际长度化成最简的比例形式，明确缺失的是哪一边。',
              '补出第三边后，再把结果代回目标三角比。'
            ],
            color: '#d18a23'
          }
        ]
      }
    ]
  }
]

const DIFFICULTY_LABELS = {
  easy: '入门',
  medium: '进阶',
  hard: '挑战'
}

const ROLE_LABELS = {
  opposite: '对边',
  adjacent: '邻边',
  hypotenuse: '斜边'
}

const ROLE_BY_TRIG = {
  sin: ['opposite', 'hypotenuse'],
  cos: ['adjacent', 'hypotenuse'],
  tan: ['opposite', 'adjacent'],
  cot: ['adjacent', 'opposite']
}

const SIDE_BY_ROLE = {
  opposite: 'BC',
  adjacent: 'AB',
  hypotenuse: 'AC'
}

const MEANING_TEMPLATES = [
  { trig: 'sin', angle: 'A' },
  { trig: 'cos', angle: 'A' },
  { trig: 'tan', angle: 'A' },
  { trig: 'cot', angle: 'A' }
]

const RATIO_TEMPLATES = [
  {
    trig: 'sin',
    angle: 'A',
    ratio: '3/5',
    triple: { AB: '4', BC: '3', AC: '5' }
  },
  {
    trig: 'cos',
    angle: 'A',
    ratio: '5/13',
    triple: { AB: '5', BC: '12', AC: '13' }
  },
  {
    trig: 'tan',
    angle: 'A',
    ratio: '7/24',
    triple: { AB: '24', BC: '7', AC: '25' }
  }
]

const GUIDED_TEMPLATES = [
  {
    prompt: '已知对边=6、斜边=10，求 tan A。',
    knownMap: { opposite: '6', hypotenuse: '10' },
    ratioMap: { opposite: '3', hypotenuse: '5' },
    thirdRole: 'adjacent',
    thirdValue: '4',
    final: { numerator: '3', denominator: '4' }
  },
  {
    prompt: '已知邻边=8、斜边=17，求 sin A。',
    knownMap: { adjacent: '8', hypotenuse: '17' },
    ratioMap: { adjacent: '8', hypotenuse: '17' },
    thirdRole: 'opposite',
    thirdValue: '15',
    final: { numerator: '15', denominator: '17' }
  }
]

function wait(ms = 120) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function readStore() {
  const fallback = {
    historyByTask: {
      meaning: [],
      ratioToSide: [],
      guidedSolve: []
    },
    sessions: {},
    results: {}
  }
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    if (!value) {
      return fallback
    }
    return Object.assign({}, fallback, value)
  } catch (error) {
    return fallback
  }
}

function writeStore(store) {
  wx.setStorageSync(STORAGE_KEY, store)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function getTask(taskId) {
  for (let gradeIndex = 0; gradeIndex < TASK_TREE.length; gradeIndex += 1) {
    const grade = TASK_TREE[gradeIndex]
    for (let chapterIndex = 0; chapterIndex < grade.chapters.length; chapterIndex += 1) {
      const chapter = grade.chapters[chapterIndex]
      for (let taskIndex = 0; taskIndex < chapter.tasks.length; taskIndex += 1) {
        const task = chapter.tasks[taskIndex]
        if (task.id === taskId) {
          return clone(task)
        }
      }
    }
  }
  return null
}

function buildMeaningProblems(problemCount) {
  const problems = []
  for (let index = 0; index < problemCount; index += 1) {
    const template = MEANING_TEMPLATES[index % MEANING_TEMPLATES.length]
    const roles = ROLE_BY_TRIG[template.trig]
    problems.push({
      id: uid('meaning'),
      kind: 'meaning',
      prompt: `指出 ${template.trig} ${template.angle} 的分子边和分母边`,
      formula: `${template.trig} ${template.angle}`,
      expected: {
        numerator: roles[0],
        denominator: roles[1]
      },
      hint: '先分清参考角，再判断对边、邻边和斜边。',
      status: 'pending'
    })
  }
  return problems
}

function buildRatioProblems(problemCount) {
  const problems = []
  for (let index = 0; index < problemCount; index += 1) {
    const template = RATIO_TEMPLATES[index % RATIO_TEMPLATES.length]
    problems.push({
      id: uid('ratio'),
      kind: 'ratioToSide',
      prompt: `已知 ${template.trig} ${template.angle} = ${template.ratio}，请填写三边长度`,
      formula: `${template.trig} ${template.angle} = ${template.ratio}`,
      expected: clone(template.triple),
      hint: '三角比里的分子和分母先落位，剩下的一条边再补全。',
      status: 'pending'
    })
  }
  return problems
}

function buildGuidedProblems(problemCount) {
  const problems = []
  for (let index = 0; index < problemCount; index += 1) {
    const template = GUIDED_TEMPLATES[index % GUIDED_TEMPLATES.length]
    problems.push({
      id: uid('guided'),
      kind: 'guidedSolve',
      prompt: template.prompt,
      teacherSteps: [
        '先把已知长度标到边角色上',
        '再化成最简 z 比',
        '再补第三边',
        '最后代回目标三角比'
      ],
      expected: clone(template),
      hint: '只处理当前展开的一步，不要提前跳步。',
      status: 'pending'
    })
  }
  return problems
}

function buildProblems(taskId, problemCount) {
  if (taskId === 'meaning') {
    return buildMeaningProblems(problemCount)
  }
  if (taskId === 'ratioToSide') {
    return buildRatioProblems(problemCount)
  }
  return buildGuidedProblems(problemCount)
}

function computeAccuracy(problems) {
  let correctCount = 0
  problems.forEach((problem) => {
    if (problem.firstTryCorrect) {
      correctCount += 1
    }
  })
  const ratio = problems.length ? Number((correctCount / problems.length).toFixed(2)) : 0
  return {
    correctCount,
    ratio
  }
}

function average(values) {
  if (!values.length) {
    return null
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase()
}

function evaluateAnswer(problem, payload) {
  if (problem.kind === 'meaning') {
    const isCorrect =
      payload.numerator === problem.expected.numerator &&
      payload.denominator === problem.expected.denominator
    return {
      correct: isCorrect,
      problemState: Object.assign({}, problem, {
        status: isCorrect ? 'solved' : 'retry'
      }),
      hint: isCorrect ? '分子边和分母边都找对了。' : problem.hint
    }
  }

  if (problem.kind === 'ratioToSide') {
    const expected = problem.expected
    const isCorrect = ['AB', 'BC', 'AC'].every((side) => normalizeText(payload[side]) === normalizeText(expected[side]))
    return {
      correct: isCorrect,
      problemState: Object.assign({}, problem, {
        status: isCorrect ? 'solved' : 'retry'
      }),
      hint: isCorrect ? '三条边都已正确落位。' : problem.hint
    }
  }

  const expected = problem.expected
  const markOk = ['opposite', 'adjacent', 'hypotenuse'].every((role) => {
    if (!expected.knownMap[role]) {
      return !payload.knownMap[role]
    }
    return normalizeText(payload.knownMap[role]) === normalizeText(expected.knownMap[role])
  })
  const ratioOk = ['opposite', 'adjacent', 'hypotenuse'].every((role) => {
    if (!expected.ratioMap[role]) {
      return !payload.ratioMap[role]
    }
    return normalizeText(payload.ratioMap[role]) === normalizeText(expected.ratioMap[role])
  })
  const thirdOk = normalizeText(payload.thirdValue) === normalizeText(expected.thirdValue)
  const finalOk =
    normalizeText(payload.final.numerator) === normalizeText(expected.final.numerator) &&
    normalizeText(payload.final.denominator) === normalizeText(expected.final.denominator)
  const isCorrect = markOk && ratioOk && thirdOk && finalOk

  return {
    correct: isCorrect,
    problemState: Object.assign({}, problem, {
      status: isCorrect ? 'solved' : 'retry'
    }),
    hint: isCorrect ? '四步都已经完成。' : problem.hint
  }
}

async function getTaskTree() {
  await wait()
  return {
    grades: clone(TASK_TREE)
  }
}

async function getTaskHistory(taskId) {
  await wait(80)
  const store = readStore()
  return clone((store.historyByTask[taskId] || []).slice(-5).reverse())
}

async function startPractice(request) {
  await wait()
  const taskId = request.taskId
  const task = getTask(taskId)
  const problemCount = request.problemCount || AUTO_PROBLEM_COUNT
  const problems = buildProblems(taskId, problemCount)
  const store = readStore()
  const sessionId = uid('session')
  store.sessions[sessionId] = {
    sessionId,
    taskId,
    title: task ? task.title : taskId,
    color: task && task.color ? task.color : '#c96f3a',
    problems: clone(problems),
    startAt: Date.now(),
    finished: false,
    problemCount
  }
  writeStore(store)
  return {
    sessionId,
    taskId,
    problems
  }
}

async function submitAnswer(request) {
  await wait(100)
  const store = readStore()
  const session = store.sessions[request.sessionId]
  if (!session) {
    throw new Error('session not found')
  }
  const problemIndex = session.problems.findIndex((problem) => problem.id === request.problemId)
  const current = session.problems[problemIndex]
  if (!current) {
    throw new Error('problem not found')
  }

  const result = evaluateAnswer(current, request.payload || {})
  const nextProblemState = Object.assign({}, result.problemState)

  if (!current.attemptCount) {
    nextProblemState.attemptCount = 0
  }
  nextProblemState.attemptCount += 1
  if (result.correct) {
    nextProblemState.firstTryCorrect = nextProblemState.attemptCount === 1
  } else {
    nextProblemState.firstTryCorrect = false
  }
  session.problems[problemIndex] = nextProblemState
  writeStore(store)

  return {
    correct: result.correct,
    allSolved: result.correct,
    hint: result.hint,
    problemState: clone(nextProblemState)
  }
}

async function finishPractice(request) {
  await wait(120)
  const store = readStore()
  const session = store.sessions[request.sessionId]
  if (!session) {
    throw new Error('session not found')
  }
  const history = store.historyByTask[session.taskId] || []
  const elapsedMs = Date.now() - session.startAt
  const previousEntry = history.length ? history[history.length - 1] : null
  const accuracy = computeAccuracy(session.problems)
  const nextHistory = history.concat([
    {
      elapsedMs,
      clearedAt: new Date().toISOString(),
      problemCount: session.problemCount,
      firstTryAccuracy: accuracy.ratio
    }
  ])
  store.historyByTask[session.taskId] = nextHistory
  const bestMs = Math.min.apply(null, nextHistory.map((item) => item.elapsedMs))
  const avgMs = average(nextHistory.slice(-5).map((item) => item.elapsedMs))
  const task = getTask(session.taskId)
  const snapshot = {
    sessionId: session.sessionId,
    taskId: session.taskId,
    title: task ? task.title : session.taskId,
    groupLabel: task ? DIFFICULTY_LABELS[task.difficulty] : '训练',
    elapsedMs,
    bestMs,
    avgMs,
    copy: `本次完成 ${session.problemCount} 题，先看整体表现，再决定是否继续下一组。`,
    problemCount: session.problemCount,
    firstTryAccuracy: accuracy.ratio,
    firstTryCorrectCount: accuracy.correctCount,
    color: task && task.color ? task.color : '#c96f3a',
    deltaVsPreviousMs: previousEntry ? elapsedMs - previousEntry.elapsedMs : null,
    history: nextHistory.slice(-10).map((item) => ({
      elapsedMs: item.elapsedMs,
      clearedAt: item.clearedAt
    }))
  }

  session.finished = true
  session.elapsedMs = elapsedMs
  store.results[session.sessionId] = snapshot
  writeStore(store)

  return {
    sessionId: session.sessionId,
    resultSnapshot: clone(snapshot)
  }
}

async function getPracticeResult(sessionId) {
  await wait(100)
  const store = readStore()
  return clone(store.results[sessionId] || null)
}

module.exports = {
  DIFFICULTY_LABELS,
  ROLE_LABELS,
  SIDE_BY_ROLE,
  getTaskTree,
  getTaskHistory,
  startPractice,
  submitAnswer,
  finishPractice,
  getPracticeResult
}
