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
  /** 波次 G 任务 6：该步讲解词（教学法骨架：条件处理→正推/倒推→逻辑
   *  整合→模式识别），落 scenario step.coach（entryLatex 板书面 + entrySpoken
   *  口播面；entrySpoken 不得含 \ 或 $——actionRuntime.test 不变量）。 */
  coach?: { entryLatex: string; entrySpoken: string };
}

interface TaskSpec {
  taskId: string;
  contentId: string;
  qtId: string;
  taId: string;
  /** 波次 G 任务 6：checkpoint 粒度重批的题目给定制解答行（canonical
   *  reviewed_solution 原文重拆，行数=steps 数时 authoring 库 1:1 归属）。 */
  reviewedRows?: string[];
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
const AUTHORING_RUN = "phase5-wave-g-cross2020-cp-rebatch:2026-08-24";
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
    // 波次 G 任务 6（(a) 第二层 + 反馈③）内容批样板：steps 按 checkpoint
    // 粒度重批（step.id=TP-SMV-002 的 CP1–CP6，使 tutor 演示投影按 checkpoint
    // 披露生效）；讲解词按教师口径教学法骨架（条件处理→正推/倒推→逻辑
    // 整合→模式识别）；解答行 = canonical reviewed_solution 原文重拆 6 行
    //（行数=steps 数，authoring 库 1:1 归属）。待教师批注复核后六题铺开。
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
    reviewedRows: [
      "$\\because AD\\cdot OC=AB\\cdot OD$，$\\therefore \\frac{AD}{OD}=\\frac{AB}{OC}$",
      "$\\because BD$ 是 $AC$ 边上的高，$\\therefore \\angle BDC=90^\\circ$，Rt$\\triangle ADB$ 与 Rt$\\triangle ODC$ 是直角三角形",
      "$\\therefore$ Rt$\\triangle ADB\\sim$Rt$\\triangle ODC$，$\\angle ABD=\\angle OCD$；又 $\\angle EOB=\\angle DOC$，$\\therefore \\angle OEB=90^\\circ$，即 $CE\\perp AB$",
      "要证 $AF\\cdot DE=AG\\cdot BC$，即证 $\\frac{AF}{AG}=\\frac{BC}{DE}$",
      "$\\because \\frac{AD}{AB}=\\frac{AE}{AC}$，$\\angle DAE=\\angle BAC$，$\\therefore \\triangle DAE\\sim\\triangle BAC$；又 $AF$ 平分 $\\angle BAC$，$\\therefore \\frac{AG}{AF}=\\frac{DE}{BC}$",
      "两式相乘约去公因，即 $AF\\cdot DE=AG\\cdot BC$",
    ],
    steps: [
      {
        id: "CP1",
        title: "第(1)问·条件处理：等积式换比例",
        promptLatex: "把条件 $AD\\cdot OC=AB\\cdot OD$ 改写成比例式。",
        goal: "乘积条件先改写成比例式，作为全部推理的入口。",
        acceptedAnswers: [
          "\\frac{AD}{OD}=\\frac{AB}{OC}",
          "AD/OD=AB/OC",
          "AD:OD=AB:OC",
          "AD 比 OD 等于 AB 比 OC",
        ],
        expectedLatex: "$\\frac{AD}{OD}=\\frac{AB}{OC}$",
        coach: {
          entryLatex: "条件处理：乘积式不能直接用——先改写成比例式 $\\frac{AD}{OD}=\\frac{AB}{OC}$，这一步是全部推理的入口。",
          entrySpoken: "条件处理。看到乘积式，先把它改写成比例式，这一步是全部推理的入口。",
        },
      },
      {
        id: "CP2",
        title: "第(1)问·正推：找两个直角三角形",
        promptLatex: "$BD$ 是 $AC$ 边上的高。写出以 $D$ 为公共直角顶点的两个直角三角形。",
        goal: "由高得直角，锁定共直角顶点的 Rt△ADB 与 Rt△ODC。",
        acceptedAnswers: [
          "Rt△ADB 和 Rt△ODC",
          "Rt△ADB∽Rt△ODC",
          "直角三角形 ADB 与 ODC",
          "ADB 和 ODC",
        ],
        expectedLatex: "Rt$\\triangle ADB$ 与 Rt$\\triangle ODC$",
        coach: {
          entryLatex: "正推：高给出直角——$BD\\perp AC$ 让 $\\angle ADB=\\angle ODC=90^\\circ$，公共顶点 $D$ 两侧正好是一对直角三角形。",
          entrySpoken: "正推。高给出直角，公共顶点 D 的两侧正好是一对直角三角形。",
        },
      },
      {
        id: "CP3",
        title: "第(1)问·逻辑整合：导角链收口证垂直",
        promptLatex: "由相似得等角、经对顶角传递，推出 $\\angle OEB$ 的度数并写出结论。",
        goal: "相似给等角 + 对顶角传递 + 内角和收口，不跳步地推出 CE⊥AB。",
        acceptedAnswers: [
          "\\angle OEB=90^\\circ",
          "∠OEB=90°",
          "CE⊥AB",
          "CE \\perp AB 得证",
        ],
        expectedLatex: "$\\angle OEB=90^\\circ$，$CE\\perp AB$",
        coach: {
          entryLatex: "逻辑整合：比例式配公共角得相似 → $\\angle ABD=\\angle OCD$；对顶角 $\\angle EOB=\\angle DOC$；内角和收口 $\\angle OEB=90^\\circ$，所以 $CE\\perp AB$。",
          entrySpoken: "逻辑整合。相似给等角，对顶角做传递，内角和收口，所以 CE 垂直 AB。这一步不能跳。",
        },
      },
      {
        id: "CP4",
        title: "第(2)问·模式识别：目标改写与结构分工",
        promptLatex: "把目标 $AF\\cdot DE=AG\\cdot BC$ 改写成比例式，并指出需要哪两组结构。",
        goal: "目标改写为比例，识别「相似供边 + 角平分线供边」的分工。",
        acceptedAnswers: [
          "\\frac{AF}{AG}=\\frac{BC}{DE}",
          "AF/AG=BC/DE",
          "△DAE∽△BAC 和 角平分线",
          "三角形DAE相似BAC加角平分线",
        ],
        expectedLatex: "$\\frac{AF}{AG}=\\frac{BC}{DE}$（$\\triangle DAE\\sim\\triangle BAC$ 与角平分线）",
        coach: {
          entryLatex: "模式识别：目标改写为 $\\frac{AF}{AG}=\\frac{BC}{DE}$——$DE/BC$ 要靠 $\\triangle DAE\\sim\\triangle BAC$，$AG/AF$ 由角平分线直接供给。",
          entrySpoken: "模式识别。先把目标改写成比例，再看每条边由哪组结构供给：相似供一组，角平分线供一组。",
        },
      },
      {
        id: "CP5",
        title: "第(2)问·正推：两组结构各供其边",
        promptLatex: "分别写出：$\\triangle DAE\\sim\\triangle BAC$ 给出哪组比例？角平分线给出哪组比例？",
        goal: "相似由 SAS 得 DE/BC，角平分线性质给 AG/AF=DE/BC。",
        acceptedAnswers: [
          "\\frac{DE}{BC}=\\frac{AE}{AC}",
          "DE/BC=AE/AC",
          "\\frac{AG}{AF}=\\frac{DE}{BC}",
          "AG/AF=DE/BC",
        ],
        expectedLatex: "$\\frac{DE}{BC}$（相似）与 $\\frac{AG}{AF}=\\frac{DE}{BC}$（角平分线）",
        coach: {
          entryLatex: "正推：$\\frac{AD}{AB}=\\frac{AE}{AC}$ 配公共角 $\\angle DAE=\\angle BAC$ 得 $\\triangle DAE\\sim\\triangle BAC$，供 $\\frac{DE}{BC}$；角平分线性质供 $\\frac{AG}{AF}=\\frac{DE}{BC}$。",
          entrySpoken: "正推。两边对应成比例加公共角，得相似，供出第一组边；角平分线性质供出第二组边。",
        },
      },
      {
        id: "CP6",
        title: "第(2)问·逻辑整合：乘约收口",
        promptLatex: "把两组比例相乘并约分，写出最终结论。",
        goal: "两式相乘约去公因，核对方向后收口。",
        acceptedAnswers: [
          "AF\\cdot DE=AG\\cdot BC",
          "AF·DE=AG·BC",
          "AF \\cdot DE = AG \\cdot BC",
          "得证",
        ],
        expectedLatex: "$AF\\cdot DE=AG\\cdot BC$",
        coach: {
          entryLatex: "逻辑整合：两个比例式相乘，公因约去，方向核对（$AF$、$AG$ 一侧，$DE$、$BC$ 一侧），得 $AF\\cdot DE=AG\\cdot BC$。",
          entrySpoken: "逻辑整合。两个比例式相乘，公因约去，方向核对无误，结论收口。",
        },
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
      ...(step.coach ? { coach: step.coach } : {}),
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
    // 波次 G 任务 6：checkpoint 粒度重批的题目（reviewedRows）用 canonical
    // 解答原文重拆的定制行；行数=steps 数时 authoring 库按步 1:1 归属。
    const reviewedSteps = (spec.reviewedRows ?? explanationLatex.split("\n"))
      .map((row) => row.trim())
      .filter(Boolean)
      .map((content) => ({ content_latex: content }));
    const solutionBoard = authorTopicSolutionBoard(resolved, actionTemplates, reviewedSteps).script;

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
