import {
  ContentDefinition,
  TaskDefinition,
  TaskId,
  TaskNode,
  TaskTreeResponse,
} from "./contracts";

export const TASK_DEFINITIONS: Record<TaskId, TaskDefinition> = {
  meaning: {
    id: "meaning",
    title: "认清 sin / cos / tan / cot 的意思",
    summary: "识别三角比对应的分子边与分母边。",
    difficulty: "easy",
    engineKind: "triangle-trig",
    contentId: "triangle-trig.meaning.v1",
    sample: {
      prompt: "已知参考角 A，指出 sin A 的分子边和分母边。",
    },
    steps: [
      "先找清题目给出的参考角。",
      "判断贴着参考角的直角边是哪条邻边，另一条直角边是哪条对边。",
      "根据三角比定义，按顺序选出分子边和分母边。",
    ],
    catalogMeta: {
      gradeId: "grade-9",
      gradeName: "九年级",
      chapterId: "chapter-trig-ratio",
      chapterName: "锐角三角比",
      color: "#b85c38",
    },
  },
  ratioToSide: {
    id: "ratioToSide",
    title: "已知三角比，把数字放到对应边上",
    summary: "根据已知三角比，补全三边长度。",
    difficulty: "medium",
    engineKind: "triangle-trig",
    contentId: "triangle-trig.ratio-to-side.v1",
    sample: {
      prompt: "已知 sin A = 3/5，请把三个边长填到三角形对应位置。",
    },
    steps: [
      "先根据参考角判断三条边分别对应对边、邻边和斜边。",
      "把已知三角比中的分子和分母放回到对应角色的边上。",
      "若第三边未给出，再用勾股关系补全三边。",
    ],
    catalogMeta: {
      gradeId: "grade-9",
      gradeName: "九年级",
      chapterId: "chapter-trig-ratio",
      chapterName: "锐角三角比",
      color: "#1f8a70",
    },
  },
  guidedSolve: {
    id: "guidedSolve",
    title: "已知两边，分步求三角比",
    summary: "根据两条已知边，逐步求出目标三角比。",
    difficulty: "hard",
    engineKind: "triangle-trig",
    contentId: "triangle-trig.guided-solve.v1",
    sample: {
      prompt: "已知两条边的长度关系，分步求出目标三角比。",
    },
    steps: [
      "先把已知长度标到图上，并判断它们对应的边角色。",
      "把实际长度化成最简的比例形式，明确缺失的是哪一边。",
      "补出第三边后，再把结果代回目标三角比。",
    ],
    catalogMeta: {
      gradeId: "grade-9",
      gradeName: "九年级",
      chapterId: "chapter-trig-ratio",
      chapterName: "锐角三角比",
      color: "#d97706",
    },
  },
  demoCounter: {
    id: "demoCounter",
    title: "演示引擎任务",
    summary: "用于验证 generic engine 平台链路的最小演示任务。",
    difficulty: "easy",
    engineKind: "demo-counter",
    contentId: "demo-counter.basic.v1",
    sample: {
      prompt: "输入指定口令并提交。",
    },
    steps: [
      "在左侧输入框中输入口令。",
      "提交后观察通用 runtime-action 和结果持久化链路。",
    ],
    catalogMeta: {
      gradeId: "grade-internal",
      gradeName: "内部验证",
      chapterId: "chapter-demo",
      chapterName: "平台演示",
      color: "#4c6ef5",
    },
  },
  trigEquationRange: {
    id: "trigEquationRange",
    title: "范围约束下解三角函数方程",
    summary: "已知 sin/cos/tan(omega x + phi) = value，在给定范围内求待求量。",
    difficulty: "medium",
    engineKind: "angle-equation",
    contentId: "angle-equation.trig-equation-range.v1",
    sample: {
      prompt: "已知 sin(2x + pi/6) = 1/2，x in [0, 2pi]，求 x 的所有值。",
    },
    steps: [
      "找出满足该函数值的全部基准角。",
      "把待求量的范围变换成 omega*x+phi 的范围。",
      "在新范围内筛选出全部合法角 theta。",
      "分别解 omega*x+phi = theta，得到待求量的全部解。",
    ],
    catalogMeta: {
      gradeId: "grade-10",
      gradeName: "高中",
      chapterId: "chapter-trig-equation",
      chapterName: "三角函数与三角方程",
      color: "#7c3aed",
    },
  },
  isoscelesRightCoord: {
    id: "isoscelesRightCoord",
    title: "等腰直角三角形一线三垂直求坐标",
    summary: "利用一线三垂直模型，通过全等三角形列方程组求第三点坐标。",
    difficulty: "medium",
    engineKind: "coordinate-isosceles-right",
    contentId: "coord-isosceles-right.basic.v1",
    sample: {
      prompt: "已知等腰 Rt△ABC，∠A=90°，B(0,0)，C(4,0)，求 A 的坐标。",
    },
    steps: [
      "选择正确的辅助线构造方式。",
      "识别全等三角形及对应边关系。",
      "列出关于 a、b 的二元一次方程组。",
      "解方程组，求出 A 点坐标。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-coordinate-congruent",
      chapterName: "平面直角坐标系与全等三角形",
      color: "#0891b2",
    },
  },
  buoyancyForceAnalysis: {
    id: "buoyancyForceAnalysis",
    title: "浮力受力分析——知三求二",
    summary: "弹簧测力计吊物块部分浸入水中，已知三个物理量求两个未知量。",
    difficulty: "medium",
    engineKind: "buoyancy-force-analysis",
    contentId: "buoyancy-force-analysis.basic.v1",
    sample: {
      prompt: "已知 F = 3 N，F浮 = 2 N，G水 = 4 N，求 G物 和 F桌。",
    },
    steps: [
      "根据已知条件选择受力分析对象（物块或整体）。",
      "代入对应方程求出第一个未知量。",
      "再用另一个方程求出第二个未知量。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-buoyancy",
      chapterName: "液体压强与浮力",
      color: "#0e7490",
    },
  },
  quadraticCompletion: {
    id: "quadraticCompletion",
    title: "二次函数配方：统一三步",
    summary: "把一般式稳定地化成顶点式，不被整数、分数或根式外观干扰。",
    difficulty: "medium",
    engineKind: "topic-practice",
    contentId: "topic-practice.quadratic-completion.v1",
    sample: {
      prompt: "将 y=2x²+8x+5 配方。",
      answerPreview: "先提 a，再找 2m，最后合并常数。",
    },
    steps: [
      "先提取二次项系数，使括号内 x² 的系数变为 1。",
      "把括号内一次项写成 2mx，由一次项系数求出 m。",
      "写成 (x+m)²-m²，拆开括号并合并常数。",
    ],
    catalogMeta: {
      gradeId: "grade-9",
      gradeName: "九年级",
      chapterId: "chapter-quadratic",
      chapterName: "二次函数",
      color: "#7c3aed",
    },
  },
  parallelLineRatios: {
    id: "parallelLineRatios",
    title: "三角形一边平行线：知三推一",
    summary: "已知三条边求第四条：标边长、标对应份数，再按固定乘法结构列式。",
    difficulty: "medium",
    engineKind: "topic-practice",
    contentId: "topic-practice.parallel-line-ratios.v1",
    sample: {
      prompt: "AB∥CD，已知 PA=3、PC=6、CD=8，求 AB。",
      answerPreview: "先标三条已知边，再标 AB 为 1 份、CD 为 2 份，最后求出 AB=4。",
    },
    steps: [
      "点击题图中的已知线段，把题干边长逐一标到图上。",
      "把比例约成最简整数比，在未知边和对应已知边上标出份数。",
      "列式：未知 = 已知 × 未知份数 / 已知份数，并求值。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#0f766e",
    },
  },
  auxiliaryTwoRatios: {
    id: "auxiliaryTwoRatios",
    title: "比例辅助线：两组整数比",
    summary: "亲手作出平行辅助线，再在两张连续讲解图上把目标线段标成份数。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.auxiliary-two-ratios.v1",
    sample: {
      prompt: "AE:EC=2:3，BD:DC=4:5，求 AP:PD。",
      answerPreview: "作平行线，先解第一组相似，再沿用共同边份数。",
    },
    steps: [
      "点击一个顶点和一条线段，作过该点且与该线段平行的直线。",
      "再点击平行线外的两个点；连接两点，并让它与刚作的平行线相交。",
      "点击第一组相似中要求的线段并标份数；保留结果，再标第二组相似中新出现的份数。",
      "直接比较两条目标边的份数并化成最简整数比。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#d97706",
    },
  },
  reverseASimilarity: {
    id: "reverseASimilarity",
    title: "反 A 形相似：对应边求长",
    summary: "在反 A 构型中先标边长、再标比例，最后按份数列式求未知边。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.reverse-a-similarity.v1",
    sample: {
      prompt: "在反 A 构型中，根据三条已知边求第四边。",
      answerPreview: "标边长 → 标对应比例 → 未知 = 已知 × 未知份数/已知份数。",
    },
    steps: [
      "点击已知线段，把题干边长标到图上。",
      "按对应顶点依次点击两组对应边，标出同方向比例。",
      "列式：未知 = 已知 × 未知份数 / 已知份数，并求值。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#be123c",
    },
  },
  nestedSimilarity: {
    id: "nestedSimilarity",
    title: "子母型相似：对应边求长",
    summary: "在子母型中处理共线边后，按标边长、标比例、列式三步求解。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.nested-similarity.v1",
    sample: {
      prompt: "在子母型构型中，根据已知边求指定边。",
      answerPreview: "先补齐需要的共线边，再把对应比例落到图上。",
    },
    steps: [
      "点击已知线段，并把题干边长及必要的共线整段标到图上。",
      "按对应顶点依次点击两组对应边，标出同方向比例。",
      "列式：未知 = 已知 × 未知份数 / 已知份数，并求值。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#9333ea",
    },
  },
  butterflySimilarity: {
    id: "butterflySimilarity",
    title: "蝶形相似：对应边求长",
    summary: "在蝶形构型中先标边长、再标比例，最后按份数列式求未知边。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.butterfly-similarity.v1",
    sample: {
      prompt: "在蝶形构型中，根据三条已知边求第四边。",
      answerPreview: "标边长 → 标对应比例 → 未知 = 已知 × 未知份数/已知份数。",
    },
    steps: [
      "点击已知线段，把题干边长标到图上。",
      "按对应顶点依次点击两组对应边，标出同方向比例。",
      "列式：未知 = 已知 × 未知份数 / 已知份数，并求值。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#db2777",
    },
  },
};

export const CONTENT_DEFINITIONS: Record<string, ContentDefinition> = {
  "triangle-trig.meaning.v1": {
    id: "triangle-trig.meaning.v1",
    engineKind: "triangle-trig",
    taskId: "meaning",
    version: "v1",
    promptTemplate: "请先选出 {{target}} {{angle}} 的分子边，再选分母边。",
    sceneTemplate: {
      sceneKind: "triangle",
      stage: { width: 460, height: 340 },
    },
    flowTemplate: {
      completionPolicy: "whole-problem",
      stepOrder: ["pick-roles"],
      guideSteps: [
        {
          stepId: "pick-roles",
          title: "先选分子，再选分母",
          summary: "在左侧依次点击两条边，右侧只显示步骤和反馈。",
        },
      ],
    },
    guideTemplate: {
      banner: "理解三角比的含义",
      hint: "先看参考角，再按顺序选分子边和分母边。",
    },
    feedbackTemplate: {
      correct: ["correct"],
      wrong: ["wrong"],
      finish: ["finish"],
    },
  },
  "triangle-trig.ratio-to-side.v1": {
    id: "triangle-trig.ratio-to-side.v1",
    engineKind: "triangle-trig",
    taskId: "ratioToSide",
    version: "v1",
    promptTemplate: "根据 {{target}} {{angle}} = {{numerator}}/{{denominator}} 推断三边长度，并填写到图上。",
    sceneTemplate: {
      sceneKind: "triangle",
      stage: { width: 460, height: 340 },
    },
    flowTemplate: {
      completionPolicy: "whole-problem",
      stepOrder: ["fill-lengths"],
      guideSteps: [
        {
          stepId: "fill-lengths",
          title: "把边长填到左侧图上",
          summary: "输入只在左侧锚点完成，右侧不出现主输入控件。",
        },
      ],
    },
    guideTemplate: {
      banner: "已知比值，回填边长",
      hint: "先认清参考角，再把比值对应回三条边。",
    },
    feedbackTemplate: {
      correct: ["correct"],
      wrong: ["wrong"],
      finish: ["finish"],
    },
  },
  "triangle-trig.guided-solve.v1": {
    id: "triangle-trig.guided-solve.v1",
    engineKind: "triangle-trig",
    taskId: "guidedSolve",
    version: "v1",
    promptTemplate: "已知 {{knownType}} {{angle}} 对应的两条边，逐步求 {{target}} {{angle}}。",
    sceneTemplate: {
      sceneKind: "triangle",
      stage: { width: 460, height: 340 },
    },
    flowTemplate: {
      completionPolicy: "multi-step",
      stepOrder: ["ratio", "third", "final"],
      guideSteps: [
        {
          stepId: "ratio",
          title: "写最简 z 比",
          summary: "先把两条已知边化成 z 比。",
        },
        {
          stepId: "third",
          title: "补出第三边",
          summary: "继续在左侧补全缺失边。",
        },
        {
          stepId: "final",
          title: "代回目标三角比",
          summary: "最后把分子边和分母边代回公式槽。",
        },
      ],
    },
    guideTemplate: {
      banner: "分步求三角比",
      hint: "按右侧步骤提示推进，但所有输入都只在左侧完成。",
    },
    feedbackTemplate: {
      correct: ["correct"],
      wrong: ["wrong"],
      finish: ["finish"],
    },
  },
  "demo-counter.basic.v1": {
    id: "demo-counter.basic.v1",
    engineKind: "demo-counter",
    taskId: "demoCounter",
    version: "v1",
    promptTemplate: "请输入口令\u201C{{expectedAnswer}}\u201D完成演示任务。",
    expectedAnswer: "ready",
    guideTemplate: {
      banner: "Generic Engine Demo",
      hint: "这是一个最小非 trig 引擎，用来验证平台层是否真正通用。",
    },
    feedbackTemplate: {
      correct: ["correct"],
      wrong: ["wrong"],
      finish: ["finish"],
    },
  },
  "angle-equation.trig-equation-range.v1": {
    id: "angle-equation.trig-equation-range.v1",
    engineKind: "angle-equation",
    taskId: "trigEquationRange",
    version: "v1",
    promptTemplate:
      "已知 {{equation}}，{{unknown}} ∈ {{range}}，求 {{unknown}} 的所有值。",
    sceneTemplate: {
      sceneKind: "custom",
      stage: { width: 480, height: 400 },
    },
    flowTemplate: {
      completionPolicy: "multi-step",
      stepOrder: ["find-angles", "transform-range", "filter-angles", "solve-target"],
      guideSteps: [
        {
          stepId: "find-angles",
          title: "找出基准角",
          summary: "找出单位圆上满足该函数值的全部角。",
        },
        {
          stepId: "transform-range",
          title: "变换范围",
          summary: "把待求量的范围变换成 omega*x+phi 的范围。",
        },
        {
          stepId: "filter-angles",
          title: "筛选合法角",
          summary: "在变换后的范围内选出全部合法角。",
        },
        {
          stepId: "solve-target",
          title: "回代求解",
          summary: "对每个合法角求解待求量。",
        },
      ],
    },
    guideTemplate: {
      banner: "范围约束下解三角函数方程",
      hint: "先找角、再换范围、再筛角、最后回代。",
    },
    feedbackTemplate: {
      correct: ["correct"],
      wrong: ["wrong"],
      finish: ["finish"],
    },
  },
  "coord-isosceles-right.basic.v1": {
    id: "coord-isosceles-right.basic.v1",
    engineKind: "coordinate-isosceles-right",
    taskId: "isoscelesRightCoord",
    version: "v1",
    promptTemplate:
      "已知等腰 Rt△ABC，∠A=90°，B({{bx}},{{by}})，C({{cx}},{{cy}})，AB=AC。求 A 的坐标。",
    sceneTemplate: {
      sceneKind: "custom",
      stage: { width: 480, height: 400 },
    },
    flowTemplate: {
      completionPolicy: "multi-step",
      stepOrder: ["construct-lines", "identify-congruent", "setup-equations", "solve-coordinates"],
      guideSteps: [
        {
          stepId: "construct-lines",
          title: "构造辅助线",
          summary: "选择正确的辅助线构造方式。",
        },
        {
          stepId: "identify-congruent",
          title: "识别全等与对应边",
          summary: "指出两个全等三角形及对应边关系。",
        },
        {
          stepId: "setup-equations",
          title: "列方程组",
          summary: "利用对应边相等列关于 a、b 的二元一次方程组。",
        },
        {
          stepId: "solve-coordinates",
          title: "求解坐标",
          summary: "解方程组，求出 A 的坐标。",
        },
      ],
    },
    guideTemplate: {
      banner: "等腰直角三角形一线三垂直求坐标",
      hint: "过 A 作横线和竖线，构造两个全等直角三角形。",
    },
    feedbackTemplate: {
      correct: ["correct"],
      wrong: ["wrong"],
      finish: ["finish"],
    },
  },
  "buoyancy-force-analysis.basic.v1": {
    id: "buoyancy-force-analysis.basic.v1",
    engineKind: "buoyancy-force-analysis",
    taskId: "buoyancyForceAnalysis",
    version: "v1",
    promptTemplate: "{{prompt}}",
    sceneTemplate: {
      sceneKind: "custom",
      stage: { width: 480, height: 420 },
    },
    flowTemplate: {
      completionPolicy: "multi-step",
      stepOrder: ["solve-unknown-1", "solve-unknown-2"],
      guideSteps: [
        {
          stepId: "solve-unknown-1",
          title: "求第一个未知量",
          summary: "选择正确的受力分析对象，代入方程求解。",
        },
        {
          stepId: "solve-unknown-2",
          title: "求第二个未知量",
          summary: "用另一个方程求出剩余未知量。",
        },
      ],
    },
    guideTemplate: {
      banner: "浮力受力分析——知三求二",
      hint: "物块：F + F浮 = G物；整体：F + F桌 = G水 + G物",
    },
    feedbackTemplate: {
      correct: ["correct"],
      wrong: ["wrong"],
      finish: ["finish"],
    },
  },
  "topic-practice.quadratic-completion.v1": {
    id: "topic-practice.quadratic-completion.v1",
    engineKind: "topic-practice",
    taskId: "quadraticCompletion",
    version: "v1",
    sourceExplanation: "artifacts/专题/2026-07-17-二次函数配方/02-student-explanation.tex",
    sourceBanks: ["artifacts/题库/2026-07-18-二次函数配方/question-bank.yaml"],
    guideTemplate: {
      banner: "统一三步配方",
      hint: "外观会变，动作不变：提 a → 找 2m → 合并常数。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.parallel-line-ratios.v1": {
    id: "topic-practice.parallel-line-ratios.v1",
    engineKind: "topic-practice",
    taskId: "parallelLineRatios",
    version: "v1",
    sourceExplanation: "artifacts/专题/2026-07-12-平行线对应边比例-待审核/02-student-explanation.resolved.tex",
    sourceBanks: ["artifacts/题库/2026-07-17-三边求第四边-A字型8字型/question-bank.yaml"],
    guideTemplate: {
      banner: "标边长 → 标份数 → 列式",
      hint: "列式固定写成：未知 = 已知 × 未知份数 / 已知份数。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.auxiliary-two-ratios.v1": {
    id: "topic-practice.auxiliary-two-ratios.v1",
    engineKind: "topic-practice",
    taskId: "auxiliaryTwoRatios",
    version: "v1",
    sourceExplanation: "artifacts/专题/2026-07-12-比例辅助线两组比例-待审核/02-student-explanation.resolved.tex",
    sourceBanks: ["artifacts/题库/2026-07-17-比例辅助线两组比例-50题/question-bank.yaml"],
    guideTemplate: {
      banner: "两组相似，共用一套份数",
      hint: "第一组标共同边；第二组保留这些份数，只补目标边。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.reverse-a-similarity.v1": {
    id: "topic-practice.reverse-a-similarity.v1",
    engineKind: "topic-practice",
    taskId: "reverseASimilarity",
    version: "v1",
    sourceExplanation: "artifacts/专题/2026-07-14-反A形相似求第四边/02-student-explanation.resolved.tex",
    sourceBanks: ["artifacts/题库/2026-07-16-反A形相似/question-bank.yaml"],
    guideTemplate: {
      banner: "反 A：标边长 → 标比例 → 列式",
      hint: "先把题干数字落到线段，再按对应顶点保持比例方向。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.nested-similarity.v1": {
    id: "topic-practice.nested-similarity.v1",
    engineKind: "topic-practice",
    taskId: "nestedSimilarity",
    version: "v1",
    sourceExplanation: "artifacts/专题/2026-07-14-子母型相似比与对应边/02-student-explanation.resolved.tex",
    sourceBanks: ["artifacts/题库/2026-07-16-子母型相似/question-bank.yaml"],
    guideTemplate: {
      banner: "子母型：标边长 → 标比例 → 列式",
      hint: "先处理必要的共线整段，再按对应顶点保持比例方向。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.butterfly-similarity.v1": {
    id: "topic-practice.butterfly-similarity.v1",
    engineKind: "topic-practice",
    taskId: "butterflySimilarity",
    version: "v1",
    sourceExplanation: "artifacts/专题/2026-07-14-蝶形相似求第四边/02-student-explanation.resolved.tex",
    sourceBanks: ["artifacts/题库/2026-07-16-蝶形相似/question-bank.yaml"],
    guideTemplate: {
      banner: "蝶形：标边长 → 标比例 → 列式",
      hint: "先把题干数字落到线段，再按对应顶点保持比例方向。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
};

export const TASK_COLORS: Record<TaskId, string> = Object.fromEntries(
  Object.values(TASK_DEFINITIONS).map((task) => [task.id, task.catalogMeta.color || "#b85c38"]),
) as Record<TaskId, string>;

export const TASK_LABELS: Record<TaskId, string> = Object.fromEntries(
  Object.values(TASK_DEFINITIONS).map((task) => [task.id, task.title]),
) as Record<TaskId, string>;

function toTaskNode(task: TaskDefinition): TaskNode {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    difficulty: task.difficulty,
    engineKind: task.engineKind,
    sample: task.sample,
    steps: task.steps,
    color: task.catalogMeta.color,
  };
}

export const TASK_NODES: Record<TaskId, TaskNode> = Object.fromEntries(
  Object.values(TASK_DEFINITIONS).map((task) => [task.id, toTaskNode(task)]),
) as Record<TaskId, TaskNode>;

export const TASK_TREE: TaskTreeResponse = {
  grades: [
    {
      id: "grade-8",
      name: "八年级",
      chapters: [
        {
          id: "chapter-coordinate-congruent",
          name: "平面直角坐标系与全等三角形",
          tasks: [TASK_NODES.isoscelesRightCoord],
        },
        {
          id: "chapter-buoyancy",
          name: "液体压强与浮力",
          tasks: [TASK_NODES.buoyancyForceAnalysis],
        },
        {
          id: "chapter-similarity",
          name: "相似三角形与比例",
          tasks: [
            TASK_NODES.parallelLineRatios,
            TASK_NODES.auxiliaryTwoRatios,
            TASK_NODES.reverseASimilarity,
            TASK_NODES.nestedSimilarity,
            TASK_NODES.butterflySimilarity,
          ],
        },
      ],
    },
    {
      id: "grade-9",
      name: "九年级",
      chapters: [
        {
          id: "chapter-trig-ratio",
          name: "锐角三角比",
          tasks: [
            TASK_NODES.meaning,
            TASK_NODES.ratioToSide,
            TASK_NODES.guidedSolve,
          ],
        },
        {
          id: "chapter-quadratic",
          name: "二次函数",
          tasks: [TASK_NODES.quadraticCompletion],
        },
      ],
    },
    {
      id: "grade-10",
      name: "高中",
      chapters: [
        {
          id: "chapter-trig-equation",
          name: "三角函数与三角方程",
          tasks: [TASK_NODES.trigEquationRange],
        },
      ],
    },
  ],
};
