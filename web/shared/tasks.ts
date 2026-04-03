import { TaskId, TaskNode, TaskTreeResponse } from "./contracts";

export const TASK_COLORS: Record<TaskId, string> = {
  meaning: "#b85c38",
  ratioToSide: "#1f8a70",
  guidedSolve: "#d97706",
};

export const TASK_LABELS: Record<TaskId, string> = {
  meaning: "认清 sin / cos / tan / cot 的意思",
  ratioToSide: "已知三角比，把数字放到对应边上",
  guidedSolve: "已知两边，分步求三角比",
};

export const TASK_NODES: Record<TaskId, TaskNode> = {
  meaning: {
    id: "meaning",
    title: TASK_LABELS.meaning,
    summary: "识别三角比对应的分子边与分母边。",
    difficulty: "easy",
    engineKind: "triangle-trig",
    sample: {
      prompt: "已知参考角 A，指出 sin A 的分子边和分母边。",
    },
    steps: [
      "先找清题目给出的参考角。",
      "判断贴着参考角的直角边是哪条邻边，另一条直角边是哪条对边。",
      "根据三角比定义，按顺序选出分子边和分母边。",
    ],
    color: TASK_COLORS.meaning,
  },
  ratioToSide: {
    id: "ratioToSide",
    title: TASK_LABELS.ratioToSide,
    summary: "根据已知三角比，补全三边长度。",
    difficulty: "medium",
    engineKind: "triangle-trig",
    sample: {
      prompt: "已知 sin A = 3/5，请把三个边长填到三角形对应位置。",
    },
    steps: [
      "先根据参考角判断三条边分别对应对边、邻边和斜边。",
      "把已知三角比中的分子和分母放回到对应角色的边上。",
      "若第三边未给出，再用勾股关系补全三边。",
    ],
    color: TASK_COLORS.ratioToSide,
  },
  guidedSolve: {
    id: "guidedSolve",
    title: TASK_LABELS.guidedSolve,
    summary: "根据两条已知边，逐步求出目标三角比。",
    difficulty: "hard",
    engineKind: "triangle-trig",
    sample: {
      prompt: "已知两条边的长度关系，分步求出目标三角比。",
    },
    steps: [
      "先把已知长度标到图上，并判断它们对应的边角色。",
      "把实际长度化成最简的比例形式，明确缺失的是哪一边。",
      "补出第三边后，再把结果代回目标三角比。",
    ],
    color: TASK_COLORS.guidedSolve,
  },
};

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
