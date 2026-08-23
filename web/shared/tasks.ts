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
  reverseAFourSimilarity: {
    id: "reverseAFourSimilarity",
    title: "反 A 一图四相似：发现候选、规划证明",
    summary: "同一张反 A 图里交替训练正推与反推：扫图产生相似猜想，看目标选判定、找缺口，用上一问的结论补缺口。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.reverse-a-four-similarity.v1",
    sample: {
      prompt: "从 ∠ADE=∠ACB 出发，图中可以依次推出四对相似三角形。",
      answerPreview: "扫图找等角 → 猜相似 → 选判定 → 补缺口 → 写格式 → 提取新结论。",
    },
    steps: [
      "正推发现：扫图找公共角、对顶角，猜出可能相似的三角形并命名。",
      "反推规划：看证明目标，盘点判定路线，反推子目标并加工上一问的结论。",
      "在图上点出对应边（交叉对应），写出规范证明并提取新结论入库。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#0f766e",
    },
  },
  // ---- Phase 5 UI 集成波次 E：golden 六题独立 Topic（教师裁定 2026-08-23：
  // 一题一 Topic，不绑定既有 topic）。题目内容权威在 canonical
  //（QT/TP/Binding），此处只是产品入口骨架 + legacy/训练最小场景。----
  goldenMinhangFold2020: {
    id: "goldenMinhangFold2020",
    title: "一模·闵行 2020 Q18：折叠等腰求长",
    summary: "等腰三角形中翻折出不变量：等角对等边定 AD=DC，翻折保长保角，在斜三角形里收口求 BE。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.golden-minhang-fold-2020.v1",
    sample: {
      prompt: "AB=AC=4，BC=6，∠DAC=∠ACD，将 △ACD 沿 AD 翻折，求 BE。",
      answerPreview: "等角对等边设 t → 翻折不变量 → 余弦定理收口，BE=1。",
    },
    steps: [
      "读题标注：把等腰条件与等角条件落到图上，由等角对等边定出 AD=DC。",
      "抓翻折不变量：翻折保长保角，列出对应边、对应角相等关系。",
      "在斜三角形中选工具（勾股/余弦定理）列式收口求 BE。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#6d28d9",
    },
  },
  goldenMinhangCross2020: {
    id: "goldenMinhangCross2020",
    title: "一模·闵行 2020 Q23：双垂直交叉证明",
    summary: "高与斜线交叉构成 8 字结构：由等积式换比例定相似，再经等角传递证垂直与比例迁移。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.golden-minhang-cross-2020.v1",
    sample: {
      prompt: "BD 是 AC 边上的高，AD·OC=AB·OD，AF 平分 ∠BAC。求证：(1) CE⊥AB；(2) AF·DE=AG·BC。",
      answerPreview: "等积式换比例 → 直角三角形相似 → 8 字等角传递 → 垂直与比例式。",
    },
    steps: [
      "条件处理：把等积式 AD·OC=AB·OD 换成比例式。",
      "正推：由高锁定共直角顶点的 Rt△ADB 与 Rt△ODC。",
      "逻辑整合：相似得等角、对顶角传递、内角和收口，推出 CE⊥AB。",
      "模式识别：目标改写为比例，分清「相似供边 + 角平分线供边」。",
      "正推：△DAE∽△BAC 与角平分线各供一组比例。",
      "逻辑整合：两组比例相乘约分，收口 AF·DE=AG·BC。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#9333ea",
    },
  },
  goldenMinhangParentChild2020: {
    id: "goldenMinhangParentChild2020",
    title: "一模·闵行 2020 Q25：母子型综合压轴",
    summary: "共边相似（母子型）三问递进：等角证明、设元建函数、等腰存在性分类讨论。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.golden-minhang-parent-child-2020.v1",
    sample: {
      prompt: "Rt△ABC 与 Rt△ACD 共直角边，CD=2，射线 CD 交 AB 于 E。三问：证等角、求 y 关于 x 的函数、等腰分类求 AD。",
      answerPreview: "母子型共角相似 → 设元列比例建 y=(x²+4)/(x+2) → 以 CG 为腰分类，AD=1 或 √14。",
    },
    steps: [
      "识别母子型（共边共角）结构，用公共角加直角证 ∠DAB=∠DCF。",
      "设 AE=x、CE=y，按相似比列方程，建出 y 关于 x 的函数并写取值范围。",
      "按以 CG 为腰的等腰三角形分两类讨论，解出 AD 的所有可能值。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#c026d3",
    },
  },
  goldenHuangpuTreeHeight2025: {
    id: "goldenHuangpuTreeHeight2025",
    title: "一模·黄浦 2025 Q22：A 字型测高应用",
    summary: "测高仪两次实践互证的建模题：把仪器边长与视线关系落成 A 字型相似，迁移比例求树高。",
    difficulty: "medium",
    engineKind: "topic-practice",
    contentId: "topic-practice.golden-huangpu-tree-height-2025.v1",
    sample: {
      prompt: "简易测高仪 AB=40cm、CD=60cm、DB=20cm，两次实践测量树木高度，还需测量哪些量？MN 各是多少？",
      answerPreview: "画 A 字型 → 对应边成比例 → 两次实践各列 MN 表达式互证。",
    },
    steps: [
      "按两次实践各画出 A 字型相似示意图，标出仪器边长与待测量。",
      "由平行/垂直条件定对应边，按比例迁移写出 MN 的表达式。",
      "对比两次实践的结果互证，写出还需测量的量与 MN 的长。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#7e22ce",
    },
  },
  goldenHuangpuAngleBisector2025: {
    id: "goldenHuangpuAngleBisector2025",
    title: "一模·黄浦 2025 Q23：共角 SAS 证明与平行推比例",
    summary: "角平分线加等腰的证明题：共角 SAS 定 △CEA∽△CDB，再由 CF∥AE 换比例证乘积式。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.golden-huangpu-angle-bisector-2025.v1",
    sample: {
      prompt: "CD 平分 ∠ACB，E 在 CD 延长线上且 AE=AD。求证：(1) △CEA∽△CDB；(2) CF∥AE 时 BD/AD=BF/CF。",
      answerPreview: "共角（角平分线）+ 等腰换边 → SAS 相似 → 平行等角传递 → 比例式。",
    },
    steps: [
      "用角平分线得公共角，结合 AE=AD 换出对应边成比例，SAS 证 △CEA∽△CDB。",
      "由 CF∥AE 得等角，把相似比迁移到含 BD、AD、BF、CF 的比例。",
      "整理成乘积式 BD/AD=BF/CF，核对对应关系完成证明。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#a21caf",
    },
  },
  goldenHuangpuMovingPoint2025: {
    id: "goldenHuangpuMovingPoint2025",
    title: "一模·黄浦 2025 Q25：动点相似压轴",
    summary: "平行四边形里的动点压轴：等角证明、锁定相似求 BP、面积比分类求 AH/AC。",
    difficulty: "hard",
    engineKind: "topic-practice",
    contentId: "topic-practice.golden-huangpu-moving-point-2025.v1",
    sample: {
      prompt: "▱ABCD 中 AB=9、BC=5、sinB=4/5，P 在 AB 上动，PE⊥PC。三问：证 ∠BAC=∠PCF、求 BP、求 AH/AC。",
      answerPreview: "等角互余传递 → 相似锁定解出 BP=17/3 → 面积比 1/3 分类得 2/7 或 1/5。",
    },
    steps: [
      "由垂直与平行四边形条件做等角的互余传递，证 ∠BAC=∠PCF。",
      "按 △APC∽△EFC 锁定对应边比例，解出 BP 的长。",
      "用面积比 1/3 建立关于 H 位置的关系，分类解出 AH/AC 的两个值。",
    ],
    catalogMeta: {
      gradeId: "grade-8",
      gradeName: "八年级",
      chapterId: "chapter-similarity",
      chapterName: "相似三角形与比例",
      color: "#86198f",
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
  "topic-practice.reverse-a-four-similarity.v1": {
    id: "topic-practice.reverse-a-four-similarity.v1",
    engineKind: "topic-practice",
    taskId: "reverseAFourSimilarity",
    version: "v1",
    sourceExplanation: "artifacts/2026-08-14-相似模型混合32题/02-student-explanation.tex",
    sourceBanks: ["artifacts/题库/2026-08-15-反A一图四相似证明/question-bank.yaml"],
    guideTemplate: {
      banner: "反 A 一图四相似：正推发现 → 反推规划",
      hint: "先扫图找等角猜相似；目标给定时，看目标选判定，缺什么就到上一问的结论里找。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },

  // Phase 5 UI 集成波次 E：golden 六题薄内容定义（题目内容在 canonical
  // ScenarioRecord/Binding，代码内不含题干）。
  "topic-practice.golden-minhang-fold-2020.v1": {
    id: "topic-practice.golden-minhang-fold-2020.v1",
    engineKind: "topic-practice",
    taskId: "goldenMinhangFold2020",
    version: "v1",
    sourceExplanation: "migration/manifests/golden-slice-manifest.yaml（PRDS 仓 golden slice QT-SMV-001）",
    sourceBanks: ["golden-similarity-mvp-001"],
    guideTemplate: {
      banner: "折叠：等角对等边 → 翻折不变量 → 斜三角形收口",
      hint: "先定 AD=DC，再列翻折保持的相等关系。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.golden-minhang-cross-2020.v1": {
    id: "topic-practice.golden-minhang-cross-2020.v1",
    engineKind: "topic-practice",
    taskId: "goldenMinhangCross2020",
    version: "v1",
    sourceExplanation: "migration/manifests/golden-slice-manifest.yaml（PRDS 仓 golden slice QT-SMV-002）",
    sourceBanks: ["golden-similarity-mvp-001"],
    guideTemplate: {
      banner: "8 字交叉：等积式换比例 → 相似 → 等角传递",
      hint: "把 AD·OC=AB·OD 先换成比例式再看两个直角三角形。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.golden-minhang-parent-child-2020.v1": {
    id: "topic-practice.golden-minhang-parent-child-2020.v1",
    engineKind: "topic-practice",
    taskId: "goldenMinhangParentChild2020",
    version: "v1",
    sourceExplanation: "migration/manifests/golden-slice-manifest.yaml（PRDS 仓 golden slice QT-SMV-003）",
    sourceBanks: ["golden-similarity-mvp-001"],
    guideTemplate: {
      banner: "母子型：公共角相似 → 设元建函数 → 分类讨论",
      hint: "三问递进，前一问的结论是后一问的工具。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.golden-huangpu-tree-height-2025.v1": {
    id: "topic-practice.golden-huangpu-tree-height-2025.v1",
    engineKind: "topic-practice",
    taskId: "goldenHuangpuTreeHeight2025",
    version: "v1",
    sourceExplanation: "migration/manifests/golden-slice-manifest.yaml（PRDS 仓 golden slice QT-SMV-004）",
    sourceBanks: ["golden-similarity-mvp-001"],
    guideTemplate: {
      banner: "A 字型应用：画图 → 对应边成比例 → 两次实践互证",
      hint: "把仪器边长和视线关系画成 A 字型相似。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.golden-huangpu-angle-bisector-2025.v1": {
    id: "topic-practice.golden-huangpu-angle-bisector-2025.v1",
    engineKind: "topic-practice",
    taskId: "goldenHuangpuAngleBisector2025",
    version: "v1",
    sourceExplanation: "migration/manifests/golden-slice-manifest.yaml（PRDS 仓 golden slice QT-SMV-005）",
    sourceBanks: ["golden-similarity-mvp-001"],
    guideTemplate: {
      banner: "共角 SAS：角平分线公共角 → 等腰换边 → 平行推比例",
      hint: "AE=AD 用来换对应边的比例，CF∥AE 用来做等角传递。",
    },
    feedbackTemplate: { correct: ["correct"], wrong: ["wrong"], finish: ["finish"] },
  },
  "topic-practice.golden-huangpu-moving-point-2025.v1": {
    id: "topic-practice.golden-huangpu-moving-point-2025.v1",
    engineKind: "topic-practice",
    taskId: "goldenHuangpuMovingPoint2025",
    version: "v1",
    sourceExplanation: "migration/manifests/golden-slice-manifest.yaml（PRDS 仓 golden slice QT-SMV-006）",
    sourceBanks: ["golden-similarity-mvp-001"],
    guideTemplate: {
      banner: "动点压轴：等角互余 → 锁相似 → 面积比分类",
      hint: "sinB=4/5 给出数值化可能；分类讨论别漏解。",
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
            TASK_NODES.reverseAFourSimilarity,
            // 波次 E：golden 六题（一模真题）独立 Topic，教师裁定一题一 Topic。
            TASK_NODES.goldenMinhangFold2020,
            TASK_NODES.goldenMinhangCross2020,
            TASK_NODES.goldenMinhangParentChild2020,
            TASK_NODES.goldenHuangpuTreeHeight2025,
            TASK_NODES.goldenHuangpuAngleBisector2025,
            TASK_NODES.goldenHuangpuMovingPoint2025,
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
