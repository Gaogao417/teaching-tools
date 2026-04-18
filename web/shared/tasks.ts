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
