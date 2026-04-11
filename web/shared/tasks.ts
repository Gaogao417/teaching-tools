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
  ],
};
