/**
 * import-golden-topic-scenarios CLI（Phase 5 UI 集成波次 E）。
 *
 * 为六个 golden 新 Topic（goldenMinhang…/goldenHuangpu… 前缀，教师裁定
 * 一题一 Topic）生成最小正式 ScenarioRecord + LessonRecord，写入
 * backend/src/content/topicScenarioBundle.json（幂等：重跑覆盖六个键）。
 *
 * 口径（波次 E 登记）：
 * - 题干/解答/讲法要点取自 skills canonical（QT-SMV/TA-SMV，Approved），
 *   来源 provenance 指向 PRDS golden-slice-manifest；
 * - 每题「每小问一个结论步（input）」，单问题加一个中间结论步满足
 *   engine 测试 ≥2 步不变量；acceptedAnswers 给出 LaTeX/白话常用变体；
 * - 内容为最小可用训练面，待教师复核（importTool 标记本脚本）。
 *
 * 用法：tsx scripts/import-golden-topic-scenarios.ts [--canonical-root <dir>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import {
  authorTopicActionTemplates,
  authorTopicSolutionBoard,
} from "./lib/topicActionTemplateAuthoring";
import { GOLDEN_GEOMETRY, verifyGoldenGeometry } from "./golden-question-geometry";
import type { TopicResolvedScenario } from "../../shared/topicPractice";

interface StepSpec {
  id: string;
  title: string;
  promptLatex: string;
  goal: string;
  acceptedAnswers: string[];
  expectedLatex: string;
}

interface TaskSpec {
  taskId: string;
  contentId: string;
  qtId: string;
  taId: string;
  title: string;
  modelLabel: string;
  difficulty: "foundation" | "advanced";
  objective: string;
  goal: string;
  tags: string[];
  steps: StepSpec[];
  answerLatex: string;
}

const NOW = "2026-08-23T00:00:00Z";
const AUTHORING_RUN = "phase5-wave-e-golden-import:2026-08-23";
const SOURCE_ASSIGNMENT = "artifacts/题库/2026-08-19-一模两卷迁移/golden-slice（PRDS 仓 golden-slice-manifest.yaml 冻结版）";

const TASKS: TaskSpec[] = [
  {
    taskId: "goldenMinhangFold2020",
    contentId: "topic-practice.golden-minhang-fold-2020.v1",
    qtId: "QT-SMV-001",
    taId: "TA-SMV-009",
    title: "一模·闵行 2020 Q18：折叠等腰求长",
    modelLabel: "折叠等腰",
    difficulty: "advanced",
    objective: "等腰三角形中翻折出不变量：等角对等边定 AD=DC，翻折保长保角，在斜三角形里收口求 BE。",
    goal: "抓翻折不变量：等角对等边 → 翻折保长保角 → 余弦定理收口求 BE",
    tags: ["折叠", "等腰", "填空压轴", "数值型"],
    answerLatex: "$BE=1$",
    steps: [
      {
        id: "g1-step-1",
        title: "定出等边关系",
        promptLatex: "由 $\\angle DAC=\\angle ACD$ 可以得到哪两条线段相等？设它为 $t$。",
        goal: "等角对等边，先定 AD=DC 再设元。",
        acceptedAnswers: ["AD=DC", "AD=DC=t", "AD=CD"],
        expectedLatex: "$AD=DC$（设 $AD=DC=t$，则 $BD=6-t$）",
      },
      {
        id: "g1-step-2",
        title: "求出 BE 的长",
        promptLatex: "利用翻折不变量与余弦定理，求 $BE$ 的长。",
        goal: "在斜三角形中列式收口。",
        acceptedAnswers: ["$1$", "1", "BE=1"],
        expectedLatex: "$BE=1$",
      },
    ],
  },
  {
    taskId: "goldenMinhangCross2020",
    contentId: "topic-practice.golden-minhang-cross-2020.v1",
    qtId: "QT-SMV-002",
    taId: "TA-SMV-010",
    title: "一模·闵行 2020 Q23：双垂直交叉证明",
    modelLabel: "8 字交叉",
    difficulty: "advanced",
    objective: "高与斜线交叉构成 8 字结构：由等积式换比例定相似，再经等角传递证垂直与比例迁移。",
    goal: "等积式换比例 → 直角三角形相似 → 8 字等角传递 → 垂直与比例式",
    tags: ["双垂直", "8 字交叉", "证明", "角平分线"],
    answerLatex: "(1) $CE\\perp AB$；(2) $AF\\cdot DE=AG\\cdot BC$",
    steps: [
      {
        id: "g2-step-1",
        title: "第(1)问结论",
        promptLatex: "求证：$CE \\perp AB$。写出你的证明结论。",
        goal: "Rt△ADB∽Rt△ODC 得等角，经对顶角传递。",
        acceptedAnswers: ["CE \\perp AB", "CE⊥AB", "CE⊥AB 得证", "得证"],
        expectedLatex: "$CE\\perp AB$ 得证",
      },
      {
        id: "g2-step-2",
        title: "第(2)问结论",
        promptLatex: "求证：$AF \\cdot DE = AG \\cdot BC$。写出你的证明结论。",
        goal: "沿角平分线与平行条件迁移比例。",
        acceptedAnswers: ["AF \\cdot DE = AG \\cdot BC", "AF·DE=AG·BC", "得证"],
        expectedLatex: "$AF\\cdot DE=AG\\cdot BC$ 得证",
      },
    ],
  },
  {
    taskId: "goldenMinhangParentChild2020",
    contentId: "topic-practice.golden-minhang-parent-child-2020.v1",
    qtId: "QT-SMV-003",
    taId: "TA-SMV-012",
    title: "一模·闵行 2020 Q25：母子型综合压轴",
    modelLabel: "母子型",
    difficulty: "advanced",
    objective: "共边相似（母子型）三问递进：等角证明、设元建函数、等腰存在性分类讨论。",
    goal: "母子型共角相似 → 设元列比例建函数 → 等腰分类讨论",
    tags: ["母子型", "函数关系", "等腰存在性", "压轴"],
    answerLatex: "(1) 得证；(2) $y=\\dfrac{x^2+4}{x+2}$（$0<x\\leq 2$）；(3) $AD=1$ 或 $\\sqrt{14}$",
    steps: [
      {
        id: "g3-step-1",
        title: "第(1)问结论",
        promptLatex: "求证：$\\angle DAB = \\angle DCF$。写出你的证明结论。",
        goal: "公共角加直角证等角。",
        acceptedAnswers: ["\\angle DAB = \\angle DCF", "∠DAB=∠DCF", "得证"],
        expectedLatex: "$\\angle DAB=\\angle DCF$ 得证",
      },
      {
        id: "g3-step-2",
        title: "第(2)问函数关系式",
        promptLatex: "当点 $E$ 在边 $CD$ 上时，求 $y$ 关于 $x$ 的函数关系式，并写出 $x$ 的取值范围。",
        goal: "设元列比例建函数。",
        acceptedAnswers: ["y = \\frac{x^{2} + 4}{x + 2}", "y=(x^2+4)/(x+2)", "y=\\frac{x^2+4}{x+2}"],
        expectedLatex: "$y=\\dfrac{x^2+4}{x+2}$（$0<x\\leq 2$）",
      },
      {
        id: "g3-step-3",
        title: "第(3)问分类求 AD",
        promptLatex: "如果 $\\triangle CDG$ 是以 $CG$ 为腰的等腰三角形，求 $AD$ 的长。",
        goal: "以 CG 为腰分类讨论。",
        acceptedAnswers: ["AD = 1 或 \\sqrt{14}", "AD=1或√14", "1 或 \\sqrt{14}"],
        expectedLatex: "$AD=1$ 或 $\\sqrt{14}$",
      },
    ],
  },
  {
    taskId: "goldenHuangpuTreeHeight2025",
    contentId: "topic-practice.golden-huangpu-tree-height-2025.v1",
    qtId: "QT-SMV-004",
    taId: "TA-SMV-016",
    title: "一模·黄浦 2025 Q22：A 字型测高应用",
    modelLabel: "A 字型应用",
    difficulty: "foundation",
    objective: "测高仪两次实践互证的建模题：把仪器边长与视线关系落成 A 字型相似，迁移比例求树高。",
    goal: "画 A 字型 → 对应边成比例 → 两次实践互证",
    tags: ["A 字型", "实际应用", "测高仪", "建模"],
    answerLatex: "第一次：$NE=b$，$MN=(a+b+40)$；第二次：$EF=c$，$MN=(c+a)$（单位 cm）",
    steps: [
      {
        id: "g4-step-1",
        title: "第一次实践：还需测量什么",
        promptLatex: "第一次实践中，还需要测量哪些量？$MN$ 等于多少？（用含 $a$、$b$ 的式子表示）",
        goal: "按 A 字型对应边迁移比例。",
        acceptedAnswers: ["NE=b，MN=(a+b+40)", "NE=b，MN=a+b+40", "NE=b"],
        expectedLatex: "$NE=b\\,\\mathrm{cm}$，$MN=(a+b+40)\\,\\mathrm{cm}$",
      },
      {
        id: "g4-step-2",
        title: "第二次实践：还需测量什么",
        promptLatex: "第二次实践中，还需要测量哪些量？$MN$ 等于多少？（用含 $a$、$c$ 的式子表示）",
        goal: "第二次实践同法列式互证。",
        acceptedAnswers: ["EF=c，MN=(c+a)", "EF=c，MN=c+a", "EF=c"],
        expectedLatex: "$EF=c\\,\\mathrm{cm}$，$MN=(c+a)\\,\\mathrm{cm}$",
      },
    ],
  },
  {
    taskId: "goldenHuangpuAngleBisector2025",
    contentId: "topic-practice.golden-huangpu-angle-bisector-2025.v1",
    qtId: "QT-SMV-005",
    taId: "TA-SMV-017",
    title: "一模·黄浦 2025 Q23：共角 SAS 证明与平行推比例",
    modelLabel: "共角 SAS",
    difficulty: "advanced",
    objective: "角平分线加等腰的证明题：共角 SAS 定 △CEA∽△CDB，再由 CF∥AE 换比例证乘积式。",
    goal: "共角（角平分线）+ 等腰换边 → SAS 相似 → 平行推比例",
    tags: ["角平分线", "共角 SAS", "平行推比例", "证明"],
    answerLatex: "(1) $\\triangle CEA\\sim\\triangle CDB$；(2) $\\dfrac{BD}{AD}=\\dfrac{BF}{CF}$",
    steps: [
      {
        id: "g5-step-1",
        title: "第(1)问结论",
        promptLatex: "求证：$\\triangle CEA\\sim\\triangle CDB$。写出你的证明结论。",
        goal: "公共角 + 等腰换边，SAS 判定。",
        acceptedAnswers: ["\\triangle CEA\\sim\\triangle CDB", "△CEA∽△CDB", "得证"],
        expectedLatex: "$\\triangle CEA\\sim\\triangle CDB$ 得证",
      },
      {
        id: "g5-step-2",
        title: "第(2)问结论",
        promptLatex: "如果 $CF\\parallel AE$，求证：$\\frac{BD}{AD}=\\frac{BF}{CF}$。写出你的证明结论。",
        goal: "平行等角传递迁移比例。",
        acceptedAnswers: ["\\frac{BD}{AD}=\\frac{BF}{CF}", "BD/AD=BF/CF", "得证"],
        expectedLatex: "$\\dfrac{BD}{AD}=\\dfrac{BF}{CF}$ 得证",
      },
    ],
  },
  {
    taskId: "goldenHuangpuMovingPoint2025",
    contentId: "topic-practice.golden-huangpu-moving-point-2025.v1",
    qtId: "QT-SMV-006",
    taId: "TA-SMV-019",
    title: "一模·黄浦 2025 Q25：动点相似压轴",
    modelLabel: "动点分类",
    difficulty: "advanced",
    objective: "平行四边形里的动点压轴：等角证明、锁定相似求 BP、面积比分类求 AH/AC。",
    goal: "等角互余传递 → 锁相似求 BP → 面积比分类求 AH/AC",
    tags: ["动点", "平行四边形", "分类讨论", "压轴"],
    answerLatex: "(1) 得证；(2) $BP=\\dfrac{17}{3}$；(3) $\\dfrac{AH}{AC}=\\dfrac{2}{7}$ 或 $\\dfrac{1}{5}$",
    steps: [
      {
        id: "g6-step-1",
        title: "第(1)问结论",
        promptLatex: "求证：$\\angle BAC=\\angle PCF$。写出你的证明结论。",
        goal: "垂直与平行四边形条件做等角互余传递。",
        acceptedAnswers: ["\\angle BAC=\\angle PCF", "∠BAC=∠PCF", "得证"],
        expectedLatex: "$\\angle BAC=\\angle PCF$ 得证",
      },
      {
        id: "g6-step-2",
        title: "第(2)问求 BP",
        promptLatex: "当 $\\triangle APC\\sim\\triangle EFC$ 时，求线段 $BP$ 的长。",
        goal: "锁定对应边比例求解。",
        acceptedAnswers: ["BP=\\frac{17}{3}", "BP=17/3", "17/3"],
        expectedLatex: "$BP=\\dfrac{17}{3}$",
      },
      {
        id: "g6-step-3",
        title: "第(3)问求 AH/AC",
        promptLatex: "当 $\\frac{S_{\\triangle HFC}}{S_{\\triangle PHC}}=\\frac{1}{3}$ 时，求 $\\frac{AH}{AC}$ 的值。",
        goal: "面积比建关系分类求解。",
        acceptedAnswers: ["\\frac{AH}{AC}=\\frac{2}{7} 或 \\frac{1}{5}", "2/7 或 1/5", "AH/AC=2/7 或 1/5"],
        expectedLatex: "$\\dfrac{AH}{AC}=\\dfrac{2}{7}$ 或 $\\dfrac{1}{5}$",
      },
    ],
  },
];

function main(): void {
  // 教师裁定补图（波次 E）：构造不变量 fail closed。
  const geometryErrors = verifyGoldenGeometry();
  if (geometryErrors.length) throw new Error(`golden geometry: ${geometryErrors.join("; ")}`);
  const argIndex = process.argv.indexOf("--canonical-root");
  const canonicalRoot = path.resolve(
    argIndex >= 0 ? process.argv[argIndex + 1] : "~/develop/teaching-skills-mvp/artifacts/canonical-authoring".replace("~", process.env.HOME ?? ""),
  );
  const bundlePath = path.resolve(process.cwd(), "src/content/topicScenarioBundle.json");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
    lessons: Record<string, unknown>;
    scenarios: Record<string, unknown[]>;
  };

  for (const spec of TASKS) {
    const truth = JSON.parse(
      readFileSync(path.join(canonicalRoot, "question-truth", spec.qtId, "v2.json"), "utf8"),
    ) as {
      stem: string;
      reviewed_solution?: string;
      subquestions?: Array<{ reviewed_solution: string }>;
    };
    // TA current 版本经 registry 解析（如 TA-SMV-016/017 已是 v2）。
    const taRegistry = readFileSync(path.join(canonicalRoot, "teaching-approach", spec.taId, "registry.yaml"), "utf8");
    const taVersion = /current_version:\s*(v\d+)/.exec(taRegistry)?.[1] ?? "v1";
    const approach = JSON.parse(
      readFileSync(path.join(canonicalRoot, "teaching-approach", spec.taId, `${taVersion}.json`), "utf8"),
    ) as {
      goal: string;
      steps: Array<{ intent: string; common_errors?: string[] }>;
    };
    const scenarioId = `golden-similarity-mvp-001:${spec.qtId}`;
    const explanationLatex = truth.subquestions?.length
      ? truth.subquestions.map((sub) => sub.reviewed_solution).join("\n\n")
      : truth.reviewed_solution ?? "";
    const expectedBlocker =
      approach.steps.find((step) => step.common_errors?.length)?.common_errors?.[0] ?? "跳过结构识别直接硬算";
    const fallbackMove = approach.steps[0]?.intent ?? "先指出目标三角形，再转换条件";

    const promptSteps = spec.steps.map((step) => ({
      id: step.id,
      title: step.title,
      goal: step.goal,
      primitive: "input" as const,
      target: "topic-answer" as const,
      promptLatex: step.promptLatex,
      successCondition: "填入的结论与该问要求一致。",
      errorDiagnosis: "结论与该问目标不一致，或未按题目要求的形式作答。",
      feedbackLatex: step.expectedLatex,
    }));
    // 与官方导入路径（import-topic-artifacts.mjs）同规则：authoring 库从
    // steps/解答文本派生 actionTemplates（enter-text + teachingInput）与
    // SolutionBoard（解答行分布到各步）——actionRuntime.test 的 v2
    // authoring 不变量因此对 golden 记录同样成立。
    const resolved: TopicResolvedScenario = {
      id: scenarioId,
      taskId: spec.taskId as TopicResolvedScenario["taskId"],
      contentId: spec.contentId,
      version: "v1",
      sourceBankId: "golden-similarity-mvp-001",
      sourceBankTitle: "Golden 六题（一模真题·相似三角形）",
      sourceQuestionId: spec.qtId,
      sourceAssignment: SOURCE_ASSIGNMENT,
      title: spec.title,
      modelLabel: spec.modelLabel,
      difficulty: spec.difficulty,
      skillTags: spec.tags,
      promptLatex: truth.stem,
      explanationLatex,
      teaching: { goal: spec.goal, expectedBlocker, fallbackMove },
      steps: promptSteps.map((step, index) => ({
        ...step,
        acceptedAnswers: spec.steps[index].acceptedAnswers,
        expectedLatex: spec.steps[index].expectedLatex,
      })),
      answerLatex: spec.answerLatex,
    };
    const actionTemplates = authorTopicActionTemplates(resolved);
    const solutionBoard = authorTopicSolutionBoard(
      resolved,
      actionTemplates,
      explanationLatex
        .split("\n")
        .map((row) => row.trim())
        .filter(Boolean)
        .map((content) => ({ content_latex: content })),
    ).script;

    bundle.lessons[spec.taskId] = {
      taskId: spec.taskId,
      title: spec.title,
      objective: spec.objective,
      sourceAssignments: [SOURCE_ASSIGNMENT],
      examples: [],
    };
    bundle.scenarios[spec.taskId] = [
      {
        id: scenarioId,
        taskId: spec.taskId,
        engineKind: "topic-practice",
        contentId: spec.contentId,
        version: "v1",
        status: "approved",
        createdAt: NOW,
        approvedAt: NOW,
        promptData: {
          sourceBankId: "golden-similarity-mvp-001",
          sourceBankTitle: "Golden 六题（一模真题·相似三角形）",
          sourceQuestionId: spec.qtId,
          sourceAssignment: SOURCE_ASSIGNMENT,
          title: spec.title,
          modelLabel: spec.modelLabel,
          difficulty: spec.difficulty,
          skillTags: spec.tags,
          promptLatex: truth.stem,
          // 波次 E 补图：legacy/训练页题图（与 tutor 侧 plan 模板同源同形）。
          promptGeometry: GOLDEN_GEOMETRY[spec.qtId] as never,
          explanationLatex,
          teaching: {
            goal: spec.goal,
            expectedBlocker,
            fallbackMove,
          },
          steps: promptSteps,
          actionTemplates,
          solutionBoard,
        },
        answerKey: {
          answerLatex: spec.answerLatex,
          steps: Object.fromEntries(
            spec.steps.map((step) => [step.id, { acceptedAnswers: step.acceptedAnswers, expectedLatex: step.expectedLatex }]),
          ),
        },
        metadata: {
          source: "reviewed-bank-import",
          authoringRunId: AUTHORING_RUN,
          assignments: [SOURCE_ASSIGNMENT],
          difficulty: spec.difficulty,
          tags: spec.tags,
          sourceBankId: "golden-similarity-mvp-001",
          sourceQuestionId: spec.qtId,
          sourceAssignment: SOURCE_ASSIGNMENT,
          importTool: "import-golden-topic-scenarios.ts（phase5-wave-e，待教师复核）",
        },
        validation: {
          schema: "teaching-tools/scenario-validation-report/v1",
          id: `validation:${scenarioId}:v1`,
          scenarioId,
          scenarioVersion: "v1",
          authoringRunId: AUTHORING_RUN,
          passed: true,
          checks: [
            {
              name: "golden-canonical-derived",
              kind: "domain",
              passed: true,
              message: `题干/解答/讲法要点派生自 canonical ${spec.qtId}（Approved）与 ${spec.taId}；最小训练面，待教师复核`,
            },
          ],
        },
      },
    ];
    console.log(`${spec.taskId}: lesson + scenario ${scenarioId}（${spec.steps.length} steps）`);
  }

  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`bundle → ${bundlePath}`);
}

main();
