import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import topicActionAuthoring from "./lib/topicActionTemplateAuthoring.ts";

const { authorTopicActionTemplates, authorTopicSolutionBoard } = topicActionAuthoring;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const SOURCE_ROOT = process.env.TEACHING_SKILLS_ROOT || "/Users/gaochong/develop/teaching_skills";
const OUTPUT_JSON = path.join(REPO_ROOT, "web/backend/src/content/topicScenarioBundle.json");
const ASSET_ROOT = path.join(REPO_ROOT, "web/frontend/public/topic-assets");
const BUNDLE_VERSION = "2026-08-07.1";
const RECORD_VERSION = "v1";
const IMPORT_TOOL = "import-topic-artifacts.mjs/v2";
const AUTHORING_RUN_ID = `topic-import:${BUNDLE_VERSION}`;
const GENERATED_AT = new Date().toISOString();

const CONFIG = {
  quadraticCompletion: {
    contentId: "topic-practice.quadratic-completion.v1",
    title: "二次函数配方",
    objective: "把一般式稳定地化成顶点式，并让每一步等式都有依据。",
    explanations: ["artifacts/专题/2026-07-17-二次函数配方/02-student-explanation.tex"],
    banks: ["artifacts/题库/2026-07-18-二次函数配方"],
  },
  parallelLineRatios: {
    contentId: "topic-practice.parallel-line-ratios.v1",
    title: "三角形一边平行线：知三推一",
    objective: "已知三条边求第四条边：先标已知边长，在草稿区算出对应边比，再按份数乘法列式。",
    explanations: ["artifacts/专题/2026-07-12-平行线对应边比例-待审核/02-student-explanation.resolved.tex"],
    banks: ["artifacts/题库/2026-07-17-三边求第四边-A字型8字型"],
  },
  auxiliaryTwoRatios: {
    contentId: "topic-practice.auxiliary-two-ratios.v1",
    title: "比例辅助线两组整数比",
    objective: "用一条平行辅助线串起两组相似，并持续保留共同边份数。",
    explanations: ["artifacts/专题/2026-07-12-比例辅助线两组比例-待审核/02-student-explanation.resolved.tex"],
    banks: ["artifacts/题库/2026-07-17-比例辅助线两组比例-50题"],
  },
  reverseASimilarity: {
    contentId: "topic-practice.reverse-a-similarity.v1",
    title: "反 A 形相似",
    objective: "在反 A 构型中按标边长、标比例、列式三步求边。",
    explanations: ["artifacts/专题/2026-07-14-反A形相似求第四边/02-student-explanation.resolved.tex"],
    banks: ["artifacts/题库/2026-07-16-反A形相似"],
  },
  nestedSimilarity: {
    contentId: "topic-practice.nested-similarity.v1",
    title: "子母型相似",
    objective: "在子母型中处理共线边，并按标边长、标比例、列式三步求边。",
    explanations: ["artifacts/专题/2026-07-14-子母型相似比与对应边/02-student-explanation.resolved.tex"],
    banks: ["artifacts/题库/2026-07-16-子母型相似"],
  },
  butterflySimilarity: {
    contentId: "topic-practice.butterfly-similarity.v1",
    title: "蝶形相似",
    objective: "在蝶形构型中按标边长、标比例、列式三步求边。",
    explanations: ["artifacts/专题/2026-07-14-蝶形相似求第四边/02-student-explanation.resolved.tex"],
    banks: ["artifacts/题库/2026-07-16-蝶形相似"],
  },
};

function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, "utf8"));
}

function slug(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function isEscaped(text, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function readBrace(text, index) {
  let cursor = index;
  while (/\s/.test(text[cursor] || "")) cursor += 1;
  if (text[cursor] !== "{") throw new Error(`Expected { near ${text.slice(cursor, cursor + 30)}`);
  let depth = 0;
  for (let i = cursor; i < text.length; i += 1) {
    if (text[i] === "{" && !isEscaped(text, i)) depth += 1;
    if (text[i] === "}" && !isEscaped(text, i)) depth -= 1;
    if (depth === 0) return { value: text.slice(cursor + 1, i), end: i + 1 };
  }
  throw new Error("Unclosed TeX argument");
}

function macroCalls(text, macro, argCount) {
  const needle = `\\${macro}`;
  const calls = [];
  let from = 0;
  while (true) {
    const start = text.indexOf(needle, from);
    if (start < 0) break;
    let cursor = start + needle.length;
    const args = [];
    try {
      for (let i = 0; i < argCount; i += 1) {
        const arg = readBrace(text, cursor);
        args.push(arg.value.trim());
        cursor = arg.end;
      }
      calls.push({ start, end: cursor, args });
      from = cursor;
    } catch {
      from = start + needle.length;
    }
  }
  return calls;
}

function environmentBlocks(text, name) {
  const beginNeedle = `\\begin{${name}}`;
  const endNeedle = `\\end{${name}}`;
  const blocks = [];
  let from = 0;
  while (true) {
    const start = text.indexOf(beginNeedle, from);
    if (start < 0) break;
    let bodyStart = start + beginNeedle.length;
    let label = "";
    while (/\s/.test(text[bodyStart] || "")) bodyStart += 1;
    if (text[bodyStart] === "[") {
      const endLabel = text.indexOf("]", bodyStart);
      label = text.slice(bodyStart + 1, endLabel).trim();
      bodyStart = endLabel + 1;
    }
    const endStart = text.indexOf(endNeedle, bodyStart);
    if (endStart < 0) throw new Error(`Unclosed ${name}`);
    blocks.push({ start, end: endStart + endNeedle.length, label, body: text.slice(bodyStart, endStart).trim() });
    from = endStart + endNeedle.length;
  }
  return blocks;
}

function cleanTexBody(value) {
  return value
    .replace(/\\begin\{diagramcoltikz\}[\s\S]*?\\end\{diagramcoltikz\}/g, "")
    .replace(/\\begin\{minipage\}(?:\[[^\]]*\])?\{[^\n]*\}/g, "")
    .replace(/\\end\{minipage\}|\\noindent|\\hfill|\\vspace\{[^}]*\}/g, "")
    .replace(/\\begin\{enumerate\}(?:\[[^\]]*\])?|\\end\{enumerate\}/g, "")
    .replace(/\\item\s*/g, "\n")
    .replace(/\\\s+\\\s+/g, "\n")
    .replace(/\\needspace\{[^}]*\}/g, "")
    .replace(/\\par\b/g, "\n")
    .replace(/\\begingroup|\\endgroup|\\setlength\{[^}]*\}\{[^}]*\}/g, "")
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

function diagramInput(text) {
  const match = text.match(/\\input\{\\detokenize\{([^}]+)\}\}/);
  return match?.[1];
}

function resolvePreview(sourceFile, tikzPath) {
  if (!tikzPath) return undefined;
  const assignmentDir = path.dirname(sourceFile);
  const candidates = [path.resolve(assignmentDir, tikzPath)];
  const itemMatch = sourceFile.match(/(.+\/items\/[^/]+)\/[^/]+$/);
  if (itemMatch) candidates.push(path.resolve(itemMatch[1], tikzPath));
  for (const texPath of candidates) {
    const dir = path.dirname(texPath);
    const base = path.basename(texPath).replace(/\.fragment\.tex$/, "");
    const svg = path.join(dir, `${base}.preview.svg`);
    if (fs.existsSync(svg)) return svg;
  }
  return undefined;
}

function resolveRenderedArtifact(sourceFile, tikzPath) {
  const svg = resolvePreview(sourceFile, tikzPath);
  if (!svg) return undefined;
  const renderedDir = path.dirname(svg);
  const base = path.basename(svg, ".preview.svg");
  const tikzSpec = path.join(renderedDir, `${base}.tikz_spec.json`);
  const request = path.join(path.dirname(renderedDir), "request.json");
  if (!fs.existsSync(tikzSpec) || !fs.existsSync(request)) return undefined;
  return { svg, renderedDir, base, tikzSpec, request };
}

function canonicalSegment(value) {
  return [...value.replace(/[^A-Z]/g, "")].sort().join("");
}

function sceneSpec(requestFile) {
  const request = readYaml(requestFile);
  return request.engine_options?.scene_payload?.diagram_spec
    || request.scene_payload?.diagram_spec
    || request.diagram_spec
    || {};
}

function geometryFromDiagram(sourceFile, tikzPath, extraSegments = []) {
  const artifact = resolveRenderedArtifact(sourceFile, tikzPath);
  if (!artifact) return undefined;
  const tikz = readYaml(artifact.tikzSpec);
  const svgText = fs.readFileSync(artifact.svg, "utf8");
  const viewBox = svgText.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const matrix = svgText.match(/transform="matrix\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)"/);
  if (!viewBox || !matrix) return undefined;
  const [, a, b, c, d, tx, ty] = matrix.map(Number);
  const cmToPt = 72 / 2.54;
  const points = (tikz.coordinates || []).map((point) => {
    const rawX = Number(point.x) * cmToPt;
    const rawY = Number(point.y) * cmToPt;
    return {
      id: point.name,
      x: a * rawX + c * rawY + tx,
      y: b * rawX + d * rawY + ty,
    };
  });
  const pointIds = new Set(points.map((point) => point.id));
  const spec = sceneSpec(artifact.request);
  const pairs = [
    ...(spec.segments || []).map((segment) => Array.isArray(segment) ? segment : [segment.from, segment.to]),
    ...(spec.annotations || []).map((annotation) => annotation.target),
    ...extraSegments.map((segment) => [segment[0], segment[1]]),
  ];
  const segments = [];
  const seen = new Set();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pointIds.has(pair[0]) || !pointIds.has(pair[1])) continue;
    const id = canonicalSegment(`${pair[0]}${pair[1]}`);
    if (seen.has(id)) continue;
    seen.add(id);
    segments.push({ id, from: pair[0], to: pair[1] });
  }
  return {
    viewBox: { width: Number(viewBox[1]), height: Number(viewBox[2]) },
    points,
    segments,
  };
}

function publishDiagram(sourceFile, tikzPath, publicParts) {
  const svg = resolvePreview(sourceFile, tikzPath);
  if (!svg) return undefined;
  const relative = path.join(...publicParts, `${slug(path.basename(path.dirname(path.dirname(svg))))}-${path.basename(svg)}`);
  const target = path.join(ASSET_ROOT, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(svg, target);
  return `/topic-assets/${relative.split(path.sep).join("/")}`;
}

function parseSolutionBox(tex, beforeIndex) {
  const begins = [...tex.slice(0, beforeIndex).matchAll(/\\begin\{eduSolutionBox\}\{([^}]*)\}/g)];
  const latest = begins.at(-1);
  if (!latest) return { title: undefined, rules: [] };
  const bodyStart = latest.index + latest[0].length;
  const end = tex.indexOf("\\end{eduSolutionBox}", bodyStart);
  if (end < 0 || end > beforeIndex) return { title: undefined, rules: [] };
  const body = cleanTexBody(tex.slice(bodyStart, end));
  const rules = body ? [body] : [];
  return { title: latest[1].trim(), rules };
}

function parseExplanationTex(taskId, relativeFile, exampleOffset) {
  const sourceFile = path.join(SOURCE_ROOT, relativeFile);
  const tex = fs.readFileSync(sourceFile, "utf8");
  const problems = environmentBlocks(tex, "eduProblemBlock");
  const sections = macroCalls(tex, "eduSectionTitle", 1);
  return problems.map((problem, problemIndex) => {
    const nextStart = problems[problemIndex + 1]?.start ?? tex.length;
    const segment = tex.slice(problem.end, nextStart);
    const section = sections.filter((item) => item.start < problem.start).at(-1)?.args[0] || "";
    const core = parseSolutionBox(tex, problem.start);
    const label = taskId.endsWith("Similarity") && /^例题(?:\s*\d+)?$/.test(problem.label)
      ? `${section.split(/[：—]/)[0]}例题`
      : problem.label || `例题 ${exampleOffset + problemIndex + 1}`;
    const stepCalls = macroCalls(segment, "eduExplainStep", 3);
    const steps = stepCalls.map((call, index) => {
      const until = stepCalls[index + 1]?.start ?? segment.length;
      const after = segment.slice(call.end, until);
      const input = diagramInput(after);
      return {
        id: `${slug(path.basename(path.dirname(relativeFile)))}-${exampleOffset + problemIndex + 1}-step-${index + 1}`,
        title: call.args[1],
        contentLatex: call.args[2],
        diagramAsset: publishDiagram(sourceFile, input, ["lesson", taskId]),
      };
    });
    const sideItems = [
      ...macroCalls(segment, "eduSideHint", 2).map((call) => ({ kind: "hint", title: call.args[0], contentLatex: call.args[1] })),
      ...macroCalls(segment, "eduSideMistake", 2).map((call) => ({ kind: "mistake", title: call.args[0], contentLatex: call.args[1] })),
    ];
    const mistake = environmentBlocks(segment, "eduMistakeBox")[0];
    if (mistake) sideItems.push({ kind: "mistake", title: "易错提醒", contentLatex: cleanTexBody(mistake.body.replace(/\\eduSubTitle\{[^}]*\}/, "")) });
    return {
      id: `${taskId}-tex-example-${exampleOffset + problemIndex + 1}`,
      label,
      sectionTitle: section,
      stemLatex: cleanTexBody(problem.body),
      promptDiagramAsset: publishDiagram(sourceFile, diagramInput(problem.body), ["lesson", taskId]),
      coreTitle: core.title,
      coreRules: core.rules,
      steps,
      sideItems,
      sourceTex: relativeFile,
    };
  });
}

const DISTRACTORS = {
  quadraticCompletion: [
    "直接把原式的一次项系数除以 $2$，不处理二次项系数。",
    "只在括号里补平方，不把减去的常数乘回括号外系数。",
  ],
  parallelLineRatios: [
    "忽略点序，把分段比直接当作两个相似三角形的对应边比。",
    "一组边按小三角形比大三角形，另一组边反向书写。",
  ],
  auxiliaryTwoRatios: [
    "进入第二组相似时清空第一组已经标出的共同边份数。",
    "把分段比直接当整段比，不先补出完整线段。",
  ],
  reverseASimilarity: [
    "只凭一组等角就判定两个三角形相似。",
    "按边在图上的位置配对，不按等角顶点的顺序配对。",
  ],
  nestedSimilarity: [
    "没有先处理共线整段就直接代入比例。",
    "按边在图上的位置配对，不按等角顶点的顺序配对。",
  ],
  butterflySimilarity: [
    "只凭一组等角就判定两个三角形相似。",
    "按边在图上的位置配对，不按等角顶点的顺序配对。",
  ],
};

function rotateOptions(options, seed) {
  const offset = seed % options.length;
  return [...options.slice(offset), ...options.slice(0, offset)];
}

function answerAliases(answer) {
  const plain = answer.replace(/\$/g, "").replace(/[。；;]$/g, "").trim();
  const primary = plain.split(/，其中|,\s*其中/)[0].trim();
  const rhs = primary.includes("=") ? primary.slice(primary.indexOf("=") + 1).trim() : primary;
  return [...new Set([answer, plain, primary, rhs])];
}

function genericContracts(taskId, itemId, block) {
  const solutionSteps = block.solution_steps || [];
  if (!solutionSteps.length) throw new Error(`${taskId}/${itemId} has no solution_steps`);
  return solutionSteps.map((step, index) => {
    const id = `${itemId.toLowerCase()}-step-${index + 1}`;
    const final = index === solutionSteps.length - 1;
    const content = step.content_latex || step.content || "";
    const nextStepId = final ? undefined : `${itemId.toLowerCase()}-step-${index + 2}`;
    const base = {
      id,
      title: step.title || `第 ${index + 1} 步`,
      goal: final ? "独立写出本题的最终结论。" : "选择能正确推进当前数学对象的下一步。",
      primitive: final ? "input" : "select",
      target: "topic-answer",
      promptLatex: final ? "根据已经完成的推理，写出最终答案。" : `下一步应怎样完成“${step.title || `第 ${index + 1} 步`}”？`,
      acceptedAnswers: final ? answerAliases(block.answer || content) : [`correct-${index + 1}`],
      expectedLatex: final ? (block.answer || content) : content,
      successCondition: final ? "提交内容与教师版规范答案数学等价。" : "选出的数学陈述与教师版当前步骤一致。",
      errorDiagnosis: block.teaching?.expected_blocker || DISTRACTORS[taskId][0],
      feedbackLatex: content,
      hintLatex: block.teaching?.fallback_move || block.explanation || "只检查当前一步。",
      nextStepId,
    };
    if (!final) {
      base.options = rotateOptions([
        { value: `correct-${index + 1}`, labelLatex: content },
        { value: `wrong-a-${index + 1}`, labelLatex: DISTRACTORS[taskId][0], diagnosis: block.teaching?.expected_blocker },
        { value: `wrong-b-${index + 1}`, labelLatex: DISTRACTORS[taskId][1], diagnosis: DISTRACTORS[taskId][1] },
      ], itemId.charCodeAt(itemId.length - 1) + index);
    }
    return base;
  });
}

function labelToken(labels) {
  return labels
    .map((label) => `${label.segmentId}=${label.valueLatex}`)
    .sort()
    .join(";");
}

function extractSegmentLabels(tex) {
  const labels = [];
  for (const match of tex.matchAll(/([A-Z]{2})\s*=\s*([^$，。,；;]+)/g)) {
    labels.push({
      segmentId: canonicalSegment(match[1]),
      displayName: match[1],
      valueLatex: match[2].trim(),
    });
  }
  for (const match of tex.matchAll(/([A-Z]{2})\s*:\s*([A-Z]{2})\s*=\s*([^:$，。\s]+)\s*:\s*([^$，。\s]+)/g)) {
    labels.push(
      { segmentId: canonicalSegment(match[1]), displayName: match[1], valueLatex: match[3] },
      { segmentId: canonicalSegment(match[2]), displayName: match[2], valueLatex: match[4] },
    );
  }
  return [...new Map(labels.map((label) => [label.segmentId, label])).values()];
}

function pointBetween(geometry, middleId, firstId, secondId) {
  const point = (id) => geometry?.points.find((item) => item.id === id);
  const middle = point(middleId);
  const first = point(firstId);
  const second = point(secondId);
  if (!middle || !first || !second) return false;
  const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
  return Math.abs(distance(first, middle) + distance(middle, second) - distance(first, second)) < 1;
}

function subtractSimpleLatex(whole, part) {
  const wholeNumber = Number(whole);
  const partNumber = Number(part);
  return Number.isFinite(wholeNumber) && Number.isFinite(partNumber) ? String(wholeNumber - partNumber) : undefined;
}

function labelsOnSmallSegments(labels, geometry) {
  const byId = new Map(labels.map((label) => [label.segmentId, label]));
  const substitutions = new Map();
  const replaceWhole = (middle, first, second) => {
    if (!pointBetween(geometry, middle, first, second)) return;
    const wholeId = canonicalSegment(`${first}${second}`);
    const firstPartId = canonicalSegment(`${first}${middle}`);
    const secondPartId = canonicalSegment(`${middle}${second}`);
    const whole = byId.get(wholeId);
    const firstPart = byId.get(firstPartId);
    if (!whole || !firstPart) return;
    const valueLatex = subtractSimpleLatex(whole.valueLatex, firstPart.valueLatex);
    if (!valueLatex) return;
    substitutions.set(wholeId, { segmentId: secondPartId, displayName: `${middle}${second}`, valueLatex });
  };
  replaceWhole("A", "P", "C");
  replaceWhole("P", "A", "C");
  replaceWhole("B", "P", "D");
  replaceWhole("P", "B", "D");
  return labels.map((label) => substitutions.get(label.segmentId) || label);
}

function findProportion(tex) {
  const fraction = tex.match(/\\(?:d?frac)\{([A-Z]{2})\}\{([A-Z]{2})\}\s*=\s*\\(?:d?frac)\{([A-Z]{2})\}\{([A-Z]{2})\}/);
  if (fraction) return fraction.slice(1, 5);
  const colon = tex.match(/([A-Z]{2})\s*:\s*([A-Z]{2})\s*=\s*([A-Z]{2})\s*:\s*([A-Z]{2})/);
  return colon?.slice(1, 5);
}

function extractShareLabels(tex) {
  const labels = [];
  const plain = tex.replace(/\$/g, "");
  for (const match of plain.matchAll(/([A-Z]{2})\s*对应\s*([^，。]+?)\s*份/g)) {
    labels.push({
      segmentId: canonicalSegment(match[1]),
      displayName: match[1],
      valueLatex: match[2].trim(),
    });
  }
  return [...new Map(labels.map((label) => [label.segmentId, label])).values()];
}

function extractRatioCalculation(steps) {
  const step = steps.find((item) => /计算并约分|对应边.*比/.test(`${item.title || ""}${item.content_latex || item.content || ""}`));
  const content = step?.content_latex || step?.content || "";
  const match = content.match(/\\(?:d?frac)\{([A-Z]{2})\}\{([A-Z]{2})\}\s*=\s*\\(?:d?frac)\{([^{}]+)\}\{([^{}]+)\}\s*=\s*\\(?:d?frac)\{([^{}]+)\}\{([^{}]+)\}/);
  if (!match) return undefined;
  return {
    content,
    firstDisplayName: match[1],
    firstSegmentId: canonicalSegment(match[1]),
    secondDisplayName: match[2],
    secondSegmentId: canonicalSegment(match[2]),
    firstValueLatex: match[3].trim(),
    secondValueLatex: match[4].trim(),
    simplifiedFirstLatex: match[5].trim(),
    simplifiedSecondLatex: match[6].trim(),
  };
}

function ratioToken(segments) {
  return segments.map(canonicalSegment).join(",");
}

/**
 * A-shape correspondence pairs for parallelLineRatios (tri PAB ~ tri PCD via
 * AB // CD): PA<->PC, PB<->PD, AB<->CD. Each pair is [small-tri side, large-tri
 * side]. Values are matched in either orientation (PA or AP).
 */
const PARALLEL_PAIRS = [["PA", "PC"], ["PB", "PD"], ["AB", "CD"]];

function stemSegmentValue(stem, seg) {
  for (const candidate of [seg, seg.split("").reverse().join("")]) {
    const m = stem.match(new RegExp(`\\$${candidate}\\s*=\\s*([^$]+)\\$`));
    if (m) return m[1].trim();
  }
  return undefined;
}

/** Parse a small integer / n*sqrt(m) / sqrt(m) / frac{a}{b} latex value to a number. */
function latexValueToNumber(latex) {
  const t = String(latex).trim();
  const frac = t.match(/^\\d?frac\{(-?\d+)\}\{(-?\d+)\}$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const coefSqrt = t.match(/^(-?\d+)\\sqrt\{(-?\d+)\}$/);
  if (coefSqrt) return Number(coefSqrt[1]) * Math.sqrt(Number(coefSqrt[2]));
  const sqrt = t.match(/^\\sqrt\{(-?\d+)\}$/);
  if (sqrt) return Math.sqrt(Number(sqrt[1]));
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

function simplifyIntegerRatio(a, b) {
  const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
  const g = gcd(Math.round(a), Math.round(b)) || 1;
  return [Math.round(a) / g, Math.round(b) / g];
}

/**
 * Derive the similarity ratio and per-segment shares for a parallelLineRatios
 * item directly from the stem values and the answer, rather than from the
 * narrative solution_steps. Returns the same shape as extractRatioCalculation
 * plus a shares list, so the contract builder can use either source. Falls back
 * to undefined when the stem does not contain two sides of a correspondence
 * pair (i.e. the ratio cannot be fixed from the stem alone).
 */
function deriveParallelRatioAndShares(stem, answer) {
  const target = (answer.match(/([A-Z]{2})\s*=/) || [])[1];
  if (!target) return undefined;
  const targetCanon = canonicalSegment(target);
  const known = {};
  for (const [a, b] of PARALLEL_PAIRS) {
    for (const seg of [a, b]) {
      const v = stemSegmentValue(stem, seg);
      if (v !== undefined && known[seg] === undefined) known[seg] = v;
    }
  }
  // find the correspondence pair that contains the target (either orientation)
  const targetPair = PARALLEL_PAIRS.find(
    (p) => canonicalSegment(p[0]) === targetCanon || canonicalSegment(p[1]) === targetCanon,
  );
  if (!targetPair) return undefined;
  // normalize target to the pair's stored orientation so downstream keys match
  const targetSeg = canonicalSegment(targetPair[0]) === targetCanon ? targetPair[0] : targetPair[1];
  const mate = targetSeg === targetPair[0] ? targetPair[1] : targetPair[0];
  // find a pair with BOTH sides known to fix the ratio
  const ratioPair = PARALLEL_PAIRS.find(
    (p) => p !== targetPair && known[p[0]] && known[p[1]],
  );
  if (!ratioPair) return undefined;
  const [r1, r2] = ratioPair;
  const num1 = latexValueToNumber(known[r1]);
  const num2 = latexValueToNumber(known[r2]);
  if (num1 === undefined || num2 === undefined) return undefined;
  const [s1, s2] = simplifyIntegerRatio(num1, num2);
  const finalRaw = (answer.match(/=\s*(.+?)\$?。?\s*$/) || [])[1] || "";
  const finalVal = finalRaw.replace(/^\$/, "").replace(/\$$/, "").trim();
  return {
    ratio: {
      content: `$\\dfrac{${r1}}{${r2}}=\\dfrac{${known[r1]}}{${known[r2]}}=\\dfrac{${s1}}{${s2}}$。`,
      firstDisplayName: r1,
      firstSegmentId: canonicalSegment(r1),
      secondDisplayName: r2,
      secondSegmentId: canonicalSegment(r2),
      firstValueLatex: known[r1],
      secondValueLatex: known[r2],
      simplifiedFirstLatex: String(s1),
      simplifiedSecondLatex: String(s2),
    },
    shares: [
      { segmentId: canonicalSegment(target), displayName: target, valueLatex: String(s1) },
      { segmentId: canonicalSegment(mate), displayName: mate, valueLatex: String(s2) },
    ],
    target,
    mate,
  };
}

function contractBase(itemId, index, title, primitive, content, nextStepId) {
  return {
    id: `${itemId.toLowerCase()}-step-${index + 1}`,
    title,
    goal: content,
    primitive,
    target: "topic-answer",
    promptLatex: content,
    acceptedAnswers: [],
    expectedLatex: content,
    successCondition: "完成当前图上动作，且对象、顺序和数值都正确。",
    errorDiagnosis: "当前点击对象、顺序或标注值与题目条件不一致。",
    feedbackLatex: content,
    hintLatex: "只检查当前一步：先确认点击的是哪条线段，再核对数值或比例方向。",
    nextStepId,
  };
}

function buildMarkRatioContracts(taskId, itemId, block, assignmentFile) {
  const labels = extractSegmentLabels(block.stem_latex);
  const allSolution = (block.solution_steps || []).map((step) => step.content_latex || step.content || "").join("\n");
  const proportion = findProportion(allSolution);
  const answer = block.answer || "";
  const promptTikz = block.diagram_col?.tikz_path;
  const extra = [
    ...labels.map((label) => label.displayName),
    ...(proportion || []),
  ];
  const geometry = geometryFromDiagram(assignmentFile, promptTikz, extra);
  const common = { geometry, availableSegments: geometry?.segments.map((segment) => segment.id) };
  const first = contractBase(itemId, 0, "标出已知边长", "mark-segments", "点击题干给出的线段，并把边长或份数标到图上。", `${itemId.toLowerCase()}-step-2`);
  first.acceptedAnswers = [labelToken(labels)];
  first.expectedLatex = labels.map((label) => `${label.displayName}=${label.valueLatex}`).join("，");
  first.feedbackLatex = first.expectedLatex;
  first.interaction = { kind: "mark-segments", ...common, expectedLabels: labels };

  const ratio = proportion || labels.slice(0, 4).map((label) => label.displayName);
  const second = contractBase(itemId, 1, "标出对应比例", "mark-ratio", "按同一方向依次点击四条对应边，组成两组相等的边比。", `${itemId.toLowerCase()}-step-3`);
  second.acceptedAnswers = [ratioToken(ratio)];
  second.expectedLatex = ratio.length === 4 ? `$${ratio[0]}:${ratio[1]}=${ratio[2]}:${ratio[3]}$` : allSolution;
  second.feedbackLatex = second.expectedLatex;
  second.interaction = { kind: "mark-ratio", ...common, expectedOrder: ratio.map(canonicalSegment) };

  const target = answer.match(/([A-Z]{2})/)?.[1];
  const targetIndex = target && proportion ? proportion.findIndex((segment) => canonicalSegment(segment) === canonicalSegment(target)) : -1;
  const third = contractBase(itemId, 2, "按份数列式", "equation", "把本题写成：未知 = 已知 × 未知份数 / 已知份数，并求值。", undefined);
  let factorSlots;
  if (proportion && targetIndex >= 0) {
    const [a, b, c, d] = proportion;
    factorSlots = [
      [b, c, d],
      [a, d, c],
      [d, a, b],
      [c, b, a],
    ][targetIndex];
  }
  if (target && factorSlots) {
    const token = `${canonicalSegment(target)}=${factorSlots.map(canonicalSegment).join("*")}|${answerAliases(answer).at(-1)}`;
    third.acceptedAnswers = [token, ...answerAliases(answer)];
    third.expectedLatex = `$${target}=${factorSlots[0]}\\times\\dfrac{${factorSlots[1]}}{${factorSlots[2]}}$，${answer}`;
    third.interaction = {
      kind: "equation",
      ...common,
      expectedOrder: factorSlots.map(canonicalSegment),
      equation: { targetLatex: target, factorSlots, resultLatex: answer },
    };
  } else {
    third.acceptedAnswers = answerAliases(answer);
    third.expectedLatex = answer;
    third.interaction = { kind: "equation", ...common, equation: { targetLatex: "结论", factorSlots: ["已知", "未知份数", "已知份数"], resultLatex: answer } };
  }
  third.feedbackLatex = third.expectedLatex;
  third.successCondition = "列式结构和最终结果都正确。";
  return [first, second, third];
}

function buildThreeKnownParallelContracts(itemId, block, assignmentFile) {
  const steps = block.solution_steps || [];
  const labels = extractSegmentLabels(block.stem_latex);
  const answer = block.answer || "";
  // Prefer deriving the ratio and shares from the authoritative stem/answer
  // truth; fall back to the narrative solution_steps patterns for older banks.
  const derived = deriveParallelRatioAndShares(block.stem_latex, answer);
  const ratio = derived?.ratio || extractRatioCalculation(steps);
  const shares = derived?.shares?.length
    ? derived.shares
    : (() => {
        const shareStep = steps.find((step) => /对应.*份/.test(step.content_latex || step.content || ""));
        const shareContent = shareStep?.content_latex || shareStep?.content || "";
        return extractShareLabels(shareContent);
      })();
  const target = derived?.target || answer.match(/([A-Z]{2})/)?.[1];
  const known = target && shares.length === 2
    ? shares.find((label) => canonicalSegment(label.displayName) !== canonicalSegment(target))?.displayName
    : undefined;
  const targetShare = target && shares.find((label) => canonicalSegment(label.displayName) === canonicalSegment(target));
  const knownShare = known && shares.find((label) => canonicalSegment(label.displayName) === canonicalSegment(known));
  const promptTikz = block.diagram_col?.tikz_path;
  const baseGeometry = geometryFromDiagram(assignmentFile, promptTikz, [
    ...labels.map((label) => label.displayName),
    ...shares.map((label) => label.displayName),
  ]);
  const smallSegmentLabels = labelsOnSmallSegments(labels, baseGeometry);
  const geometry = geometryFromDiagram(assignmentFile, promptTikz, [
    ...labels.map((label) => label.displayName),
    ...shares.map((label) => label.displayName),
    ...smallSegmentLabels.map((label) => label.displayName),
  ]);
  const common = { geometry, availableSegments: geometry?.segments.map((segment) => segment.id) };

  const first = contractBase(itemId, 0, "填写小段边长", "mark-segments", "在系统聚焦的小段旁填入边长。", `${itemId.toLowerCase()}-step-2`);
  first.acceptedAnswers = [labelToken(smallSegmentLabels)];
  first.expectedLatex = smallSegmentLabels.map((label) => `${label.displayName}=${label.valueLatex}`).join("，");
  first.feedbackLatex = first.expectedLatex;
  first.interaction = { kind: "mark-segments", ...common, expectedLabels: smallSegmentLabels };
  first.presentation = { autoFocusSequence: true, autoSubmitOnComplete: true };
  first.coach = {
    entryLatex: `把边长标到小段上。先填写 ${smallSegmentLabels[0]?.displayName}。`,
    idleHintsLatex: smallSegmentLabels.map((label) => `当前填写 ${label.displayName}，它的边长是 ${label.valueLatex}。`),
    invalidObjectLatex: "不用选择线段，直接填写当前亮起的小段。",
    objectCategoryHintLatex: "系统会按顺序把焦点移到需要填写的小段。",
    targetHintsLatex: Object.fromEntries(smallSegmentLabels.map((label) => [label.segmentId, `填写 ${label.displayName}=${label.valueLatex}。`])),
    nextActionLatex: "填对后会自动移到下一条小段。",
  };

  const second = contractBase(itemId, 1, "计算对应边的比", "ratio-scratch", "在图中依次点出一组已知的对应边，再在草稿区代入边长并约成最简整数比。", `${itemId.toLowerCase()}-step-3`);
  if (ratio) {
    second.acceptedAnswers = [`${ratio.firstSegmentId},${ratio.secondSegmentId}|${ratio.simplifiedFirstLatex},${ratio.simplifiedSecondLatex}`];
    second.expectedLatex = ratio.content;
    second.feedbackLatex = ratio.content;
    second.interaction = {
      kind: "ratio-scratch",
      ...common,
      expectedOrder: [ratio.firstSegmentId, ratio.secondSegmentId],
      ratioScratch: ratio,
    };
    second.coach = {
      entryLatex: "三条已知边里，有两条是相似三角形的一组对应边。先按同一方向点出它们，再把边长代入草稿式并约分。",
      idleHintsLatex: ["先找落在同一条射线上的两条已知对应边。", `先点 ${ratio.firstDisplayName}，再点 ${ratio.secondDisplayName}。`],
      invalidObjectLatex: "这条边不能组成当前要计算的那组已知对应边比。",
      objectCategoryHintLatex: "要找的是同一方向上、分别属于两个相似三角形的两条已知对应边。",
      targetHintsLatex: {
        [ratio.firstSegmentId]: `先点 ${ratio.firstDisplayName}。`,
        [ratio.secondSegmentId]: `接着点与它对应的 ${ratio.secondDisplayName}。`,
      },
      nextActionLatex: `把 ${ratio.firstValueLatex}:${ratio.secondValueLatex} 约成最简整数比，分别填进两个空。`,
      slotHints: {
        "ratio-first": { hintLatex: `先约分 ${ratio.firstValueLatex}:${ratio.secondValueLatex}，填写前项。`, correctLatex: "前项正确，再填后项。", errorLatex: "前项还没有约到最简，检查两个数的最大公因数。" },
        "ratio-second": { hintLatex: "保持同一次约分，填写最简比的后项。", correctLatex: "最简整数比正确，可以提交。", errorLatex: "后项要与前项除以同一个数。" },
      },
    };
  } else {
    const fallbackShares = shares.length
      ? shares.map((label) => `${label.displayName}=${label.valueLatex}份`).join("，")
      : "标出对应边的份数。";
    second.acceptedAnswers = [labelToken(shares)];
    second.expectedLatex = fallbackShares;
    second.feedbackLatex = fallbackShares;
    second.interaction = { kind: "mark-segments", ...common, expectedLabels: shares };
  }

  const third = contractBase(itemId, 2, "按份数列式", "equation", "根据陪练说明，填出：未知边 = 已知边 × 未知边份数 / 已知边份数，再求值。", undefined);
  if (target && known && targetShare && knownShare) {
    // Public factorSlots expose only slot SHAPE (known segment id + two role labels);
    // the actual share values are private truth via expectedOrder / shareValues below.
    const factorSlots = [known, "未知份数", "已知份数"];
    const result = answerAliases(answer).at(-1);
    third.acceptedAnswers = [
      `${canonicalSegment(target)}=${canonicalSegment(known)}*${targetShare.valueLatex}*${knownShare.valueLatex}|${result}`,
      ...answerAliases(answer),
    ];
    third.expectedLatex = `$${target}=${known}\\times\\dfrac{${targetShare.valueLatex}}{${knownShare.valueLatex}}=${result}$`;
    third.interaction = {
      kind: "equation",
      ...common,
      expectedOrder: [canonicalSegment(known), targetShare.valueLatex, knownShare.valueLatex],
      equation: {
        targetLatex: target,
        factorSlots,
        resultLatex: answer,
        shareValues: [targetShare.valueLatex, knownShare.valueLatex],
        knownValueLatex: labels.find((label) => label.segmentId === canonicalSegment(known))?.valueLatex,
      },
    };
    third.presentation = { prefillKnownFactor: true };
    const proof = ratio
      ? `因为 $${ratio.firstDisplayName}:${ratio.secondDisplayName}=${ratio.firstValueLatex}:${ratio.secondValueLatex}=${ratio.simplifiedFirstLatex}:${ratio.simplifiedSecondLatex}$；又因为 $AB\\parallel CD$，两个三角形相似，所以对应边成比例：$\\dfrac{${ratio.firstDisplayName}}{${ratio.secondDisplayName}}=\\dfrac{${target}}{${known}}=\\dfrac{${targetShare.valueLatex}}{${knownShare.valueLatex}}$。所以 ${target} 是 ${targetShare.valueLatex} 份，${known} 是 ${knownShare.valueLatex} 份。`
      : `因为 $AB\\parallel CD$，两个三角形相似，对应边成比例，所以 $${target}:${known}=${targetShare.valueLatex}:${knownShare.valueLatex}$。也就是 ${target} 是 ${targetShare.valueLatex} 份，${known} 是 ${knownShare.valueLatex} 份。`;
    third.coach = {
      entryLatex: proof,
      explanationLatex: proof,
      nextActionLatex: `把份数关系落到算式上：$${target}=${known}\\times\\dfrac{\\Box}{\\Box}$。`,
      invalidObjectLatex: `这里先要放能直接代入数值的已知边 ${known}，其他线段暂时不用。`,
      objectCategoryHintLatex: "乘号前应放已经知道具体长度、并且和未知边对应的那条边。",
      targetHintsLatex: { [canonicalSegment(known)]: `点 ${known}，把它放到乘号前。` },
      slotHints: {
        known: { hintLatex: `先点已知边 ${known}。`, correctLatex: `对，乘号前是 ${known}。`, errorLatex: `这里需要能直接代入长度的 ${known}。` },
        numerator: { hintLatex: `${target} 是 ${targetShare.valueLatex} 份，把 ${targetShare.valueLatex} 填在分子。`, correctLatex: `${target} 是 ${targetShare.valueLatex} 份，分子正确。`, errorLatex: `由 $${target}:${known}=${targetShare.valueLatex}:${knownShare.valueLatex}$ 可知 ${target} 是 ${targetShare.valueLatex} 份，所以分子填 ${targetShare.valueLatex}。` },
        denominator: { hintLatex: `${known} 是 ${knownShare.valueLatex} 份，把 ${knownShare.valueLatex} 填在分母。`, correctLatex: `${known} 是 ${knownShare.valueLatex} 份，分母正确。`, errorLatex: `由 $${target}:${known}=${targetShare.valueLatex}:${knownShare.valueLatex}$ 可知 ${known} 是 ${knownShare.valueLatex} 份，所以分母填 ${knownShare.valueLatex}。` },
        result: { hintLatex: `最后代入 ${known} 的边长并计算。`, correctLatex: "结果正确，可以提交。", errorLatex: `${known} 的长度是 ${labels.find((label) => label.segmentId === canonicalSegment(known))?.valueLatex || "已知数"}，计算 $${known}\\times\\dfrac{${targetShare.valueLatex}}{${knownShare.valueLatex}}$。` },
      },
    };
  } else {
    third.acceptedAnswers = answerAliases(answer);
    third.expectedLatex = answer;
    third.interaction = { kind: "equation", ...common, equation: { targetLatex: target || "未知", factorSlots: ["已知", "未知份数", "已知份数"], resultLatex: answer } };
  }
  third.feedbackLatex = steps.at(-1)?.content_latex || steps.at(-1)?.content || third.expectedLatex;
  third.successCondition = "列式结构和最终结果都正确。";
  return [first, second, third];
}

function annotationsFor(assignmentFile, tikzPath) {
  const artifact = resolveRenderedArtifact(assignmentFile, tikzPath);
  if (!artifact) return [];
  return (sceneSpec(artifact.request).annotations || []).filter((annotation) => Array.isArray(annotation.target) && annotation.target.length === 2);
}

function annotationLabels(annotations) {
  return annotations.map((annotation) => ({
    segmentId: canonicalSegment(annotation.target.join("")),
    displayName: annotation.target.join(""),
    valueLatex: annotation.text.replace(/份$/, ""),
  }));
}

function buildAuxiliaryContracts(itemId, block, assignmentFile) {
  const steps = block.solution_steps || [];
  const promptTikz = block.diagram_col?.tikz_path;
  const stageTikz = steps.slice(0, 3).map((step) => step.diagram_col?.tikz_path);
  const stageSpecs = stageTikz.map((tikzPath) => {
    const artifact = resolveRenderedArtifact(assignmentFile, tikzPath);
    return artifact ? sceneSpec(artifact.request) : {};
  });
  const helperSpec = stageSpecs[0] || {};
  const construction = helperSpec.auxiliary_constructions?.[0];
  const parallel = helperSpec.markers?.find((marker) => marker.type === "parallel")?.segments;
  const constructed = construction?.constructed_segment || [];
  const throughPoint = constructed.find((point) => point !== construction?.point);
  const parallelSegment = parallel?.find((segment) => canonicalSegment(segment.join("")) !== canonicalSegment(constructed.join("")));
  const route = {
    throughPoint,
    parallelSegment: canonicalSegment((parallelSegment || []).join("")),
    carrierPoints: construction?.carrier_segment || [],
    resultPoint: construction?.point,
  };
  const promptGeometry = geometryFromDiagram(assignmentFile, promptTikz, [route.parallelSegment, ...(route.carrierPoints || [])]);
  const first = contractBase(itemId, 0, "作平行辅助线", "construct-parallel", "依次点击：过线外顶点、要平行的线段、平行线外两点。系统连接后两点，并与平行线相交。", `${itemId.toLowerCase()}-step-2`);
  const routeToken = `point:${route.throughPoint}|parallel:${route.parallelSegment}|carrier:${route.carrierPoints.join(",")}`;
  first.acceptedAnswers = [routeToken];
  first.expectedLatex = steps[0]?.content || routeToken;
  first.feedbackLatex = first.expectedLatex;
  first.diagramAsset = publishDiagram(assignmentFile, stageTikz[0], ["bank", "auxiliaryTwoRatios", itemId]);
  first.interaction = {
    kind: "construct-parallel",
    geometry: promptGeometry,
    availableSegments: promptGeometry?.segments.map((segment) => segment.id),
    construction: route,
  };

  const annotationSets = stageTikz.map((tikzPath) => annotationsFor(assignmentFile, tikzPath));
  const contracts = [first];
  for (let stage = 1; stage <= 2; stage += 1) {
    const previousIds = new Set(annotationSets[stage - 1].map((annotation) => annotation.id));
    const added = annotationSets[stage].filter((annotation) => !previousIds.has(annotation.id));
    const labels = annotationLabels(added);
    const geometry = geometryFromDiagram(assignmentFile, stageTikz[stage - 1], labels.map((label) => label.displayName));
    const contract = contractBase(itemId, stage, stage === 1 ? "标第一组相似的份数" : "保留标注，再标第二组份数", "mark-segments", stage === 1 ? "点击第一张讲解图要求的线段，并标上对应数字。" : "保留上一组红色份数，点击第二张讲解图中新要求的线段并标数字。", `${itemId.toLowerCase()}-step-${stage + 2}`);
    contract.acceptedAnswers = [labelToken(labels)];
    contract.expectedLatex = labels.map((label) => `${label.displayName}=${label.valueLatex}份`).join("，");
    contract.feedbackLatex = steps[stage]?.content || contract.expectedLatex;
    contract.diagramAsset = publishDiagram(assignmentFile, stageTikz[stage], ["bank", "auxiliaryTwoRatios", itemId]);
    contract.interaction = { kind: "mark-segments", geometry, availableSegments: geometry?.segments.map((segment) => segment.id), expectedLabels: labels };
    contracts.push(contract);
  }
  const final = contractBase(itemId, 3, "比较份数，写出答案", "input", "比较题目所求两条线段的份数，写出最简整数比。", undefined);
  final.acceptedAnswers = answerAliases(block.answer || "");
  final.expectedLatex = block.answer;
  final.feedbackLatex = steps[3]?.content || block.answer;
  final.diagramAsset = publishDiagram(assignmentFile, stageTikz[2], ["bank", "auxiliaryTwoRatios", itemId]);
  contracts.push(final);
  return contracts;
}

function buildContracts(taskId, itemId, block, assignmentFile) {
  if (taskId === "auxiliaryTwoRatios") return buildAuxiliaryContracts(itemId, block, assignmentFile);
  if (taskId === "parallelLineRatios") return buildThreeKnownParallelContracts(itemId, block, assignmentFile);
  if (taskId.endsWith("Similarity")) {
    return buildMarkRatioContracts(taskId, itemId, block, assignmentFile);
  }
  return genericContracts(taskId, itemId, block);
}

function findProblemBlock(assignment) {
  return assignment.sections?.flatMap((section) => section.blocks || []).find((block) => block.stem_latex && block.answer && block.solution_steps);
}

function validateImportedScenario(record) {
  const stepIds = record.promptData.steps.map((step) => step.id);
  const uniqueStepIds = new Set(stepIds);
  const actionTemplates = record.promptData.actionTemplates || [];
  const actionIds = new Set(actionTemplates.map((action) => action.actionId));
  const nextRefs = record.promptData.steps.map((step) => step.nextStepId).filter(Boolean);
  const assetUrls = [
    record.promptData.promptDiagramAsset,
    ...record.promptData.steps.map((step) => step.diagramAsset),
  ].filter(Boolean);
  const checks = [
    { name: "ready-bank", kind: "domain", passed: true, message: `${record.metadata.sourceBankId} is marked ready` },
    {
      name: "task-content-engine",
      kind: "schema",
      passed: record.taskId in CONFIG
        && record.engineKind === "topic-practice"
        && record.contentId === CONFIG[record.taskId].contentId,
      message: "Task, content, and engine ownership agree.",
    },
    {
      name: "required-content",
      kind: "schema",
      passed: Boolean(record.promptData.promptLatex && record.answerKey.answerLatex && stepIds.length),
      message: "Stem, answer, and runtime steps are present.",
    },
    {
      name: "step-graph",
      kind: "domain",
      passed: uniqueStepIds.size === stepIds.length && nextRefs.every((stepId) => uniqueStepIds.has(stepId)),
      message: "Step ids are unique and next-step references resolve.",
    },
    {
      name: "answer-key-complete",
      kind: "domain",
      passed: stepIds.every((stepId) => record.answerKey.steps[stepId]?.acceptedAnswers?.length > 0)
        && Array.isArray(record.promptData.solutionBoard?.expressions)
        && record.promptData.solutionBoard.expressions.length > 0,
      message: "Every runtime step has a backend answer alias and the question carries a reviewed SolutionBoard document.",
    },
    {
      name: "action-templates-complete",
      kind: "schema",
      passed: actionTemplates.length > 0
        && actionIds.size === actionTemplates.length
        && actionTemplates.every((action) => uniqueStepIds.has(action.sourceStepId)
          && typeof action.kind === "string" && Number.isInteger(action.version) && action.version > 0
          && action.input && typeof action.input === "object" && Array.isArray(action.capabilities)
          && Array.isArray(action.answerSlots)),
      message: "Every published v2 record contains unique, versioned actionTemplates with resolvable source steps.",
    },
    {
      name: "published-assets",
      kind: "asset",
      passed: assetUrls.every((url) => fs.existsSync(path.join(ASSET_ROOT, url.replace(/^\/topic-assets\//, "")))),
      message: `${assetUrls.length} referenced topic assets resolve in the published asset tree.`,
    },
    {
      name: "wolfram-applicability",
      kind: "mathematical",
      passed: true,
      message: "not_applicable: reviewed bank assignments are the imported truth source; no Wolfram expression is declared.",
      evidence: { applicability: "not_applicable" },
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  if (failed.length) throw new Error(`Scenario ${record.id} failed validation: ${failed.map((check) => check.name).join(", ")}`);
  return checks;
}

function withNestedConversionContract(taskId, contracts) {
  if (taskId !== "nestedSimilarity" || contracts.some((contract) => contract.primitive === "convert-collinear")) return contracts;
  const [markKnown, mapRatio, ...remaining] = contracts;
  if (!markKnown || !mapRatio) return contracts;
  const conversionStepId = `${markKnown.id}-collinear`;
  return [
    { ...markKnown, nextStepId: conversionStepId },
    {
      id: conversionStepId,
      title: "互化共线整段与分段",
      goal: "依次点击整段、目标分段和已知分段，建立共线线段关系。",
      primitive: "convert-collinear",
      target: "topic-answer",
      promptLatex: "依次点击 $AC$、$AD$、$DC$，建立 $AC=AD+DC$。",
      acceptedAnswers: ["AC,AD,CD"],
      expectedLatex: "$AC=AD+DC$",
      successCondition: "整段、目标分段和已知分段的关系正确。",
      errorDiagnosis: "整段与两个分段的对应关系不一致。",
      feedbackLatex: "$AC=AD+DC$，因此先由整段减去已知分段得到 $AD$。",
      hintLatex: "先找包含另外两段的整段，再确定要求出的分段。",
      nextStepId: mapRatio.id,
      interaction: {
        kind: "convert-collinear",
        geometry: mapRatio.interaction?.geometry || markKnown.interaction?.geometry,
        availableSegments: ["AC", "AD", "CD"],
        expectedOrder: ["AC", "AD", "CD"],
        collinear: {
          wholeSegment: "AC",
          targetSegment: "AD",
          knownSegment: "CD",
          relationLatex: "AC=AD+DC",
        },
      },
    },
    mapRatio,
    ...remaining,
  ];
}

function importBank(taskId, relativeBankRoot) {
  const bankRoot = path.join(SOURCE_ROOT, relativeBankRoot);
  const manifest = readYaml(path.join(bankRoot, "question-bank.yaml"));
  if (manifest.bank?.status !== "ready") throw new Error(`${relativeBankRoot} is not ready`);
  return manifest.items.filter((item) => item.enabled !== false).map((item) => {
    const relativeAssignment = path.join(relativeBankRoot, item.teacher_assignment);
    const assignmentFile = path.join(SOURCE_ROOT, relativeAssignment);
    const block = findProblemBlock(readYaml(assignmentFile));
    if (!block?.stem_latex || !block?.answer) throw new Error(`${relativeAssignment} lacks stem or answer`);
    const contracts = withNestedConversionContract(taskId, buildContracts(taskId, item.id, block, assignmentFile));
    if (taskId === "quadraticCompletion") {
      for (let i = 0; i < contracts.length; i += 1) {
        const tikzPath = block.solution_steps?.[i]?.diagram_col?.tikz_path
          || (i === 0 ? block.answer_space?.diagram_col?.tikz_path : undefined);
        contracts[i].diagramAsset = publishDiagram(assignmentFile, tikzPath, ["bank", taskId, manifest.bank.id, item.id]);
      }
    }
    const modelLabel = item.skill_tags?.find((tag) => /A字|8字|反A|子母|蝶形|首项|根号|分数/.test(tag)) || item.title;
    const id = `${manifest.bank.id}:${item.id}`;
    const answerKey = Object.fromEntries(contracts.map((contract) => [contract.id, {
      acceptedAnswers: contract.acceptedAnswers,
      expectedLatex: contract.expectedLatex,
    }]));
    const promptSteps = contracts.map(({ acceptedAnswers: _acceptedAnswers, expectedLatex: _expectedLatex, ...contract }) => contract);
    const promptData = {
      sourceBankId: manifest.bank.id,
      sourceBankTitle: manifest.bank.topic,
      sourceQuestionId: item.id,
      sourceAssignment: relativeAssignment,
      title: item.title,
      modelLabel,
      difficulty: item.difficulty || "unknown",
      skillTags: item.skill_tags || [],
      promptLatex: block.stem_latex,
      promptDiagramAsset: publishDiagram(assignmentFile, block.diagram_col?.tikz_path, ["bank", taskId, manifest.bank.id, item.id]),
      promptGeometry: geometryFromDiagram(
        assignmentFile,
        block.diagram_col?.tikz_path,
        extractSegmentLabels(block.stem_latex).map((label) => label.displayName),
      ),
      explanationLatex: block.explanation || "",
      teaching: {
        goal: block.teaching?.teaching_goal || "完成本题",
        expectedBlocker: block.teaching?.expected_blocker || "",
        fallbackMove: block.teaching?.fallback_move || "",
      },
      steps: promptSteps,
    };
    // Action Runtime v2 authoring output. Runtime plan projection forwards this
    // opaque JSON list; it never reconstructs machine inputs from primitives.
    promptData.actionTemplates = authorTopicActionTemplates({
      taskId,
      ...promptData,
      steps: contracts,
    });
    const authoredSolutionBoard = authorTopicSolutionBoard({
      id,
      taskId,
      ...promptData,
      steps: contracts,
    }, promptData.actionTemplates, block.solution_steps || []);
    promptData.solutionBoard = authoredSolutionBoard.script;
    const record = {
      id,
      taskId,
      engineKind: "topic-practice",
      contentId: CONFIG[taskId].contentId,
      version: RECORD_VERSION,
      status: "approved",
      createdAt: GENERATED_AT,
      approvedAt: GENERATED_AT,
      promptData,
      answerKey: {
        answerLatex: block.answer,
        steps: answerKey,
      },
      metadata: {
        source: "reviewed-bank-import",
        authoringRunId: AUTHORING_RUN_ID,
        assignments: [relativeAssignment],
        difficulty: item.difficulty || "unknown",
        tags: item.skill_tags || [],
        sourceBankId: manifest.bank.id,
        sourceQuestionId: item.id,
        sourceAssignment: relativeAssignment,
        importTool: IMPORT_TOOL,
      },
      validation: {
        schema: "teaching-tools/scenario-validation-report/v1",
        id: `validation:${id}:${RECORD_VERSION}`,
        scenarioId: id,
        scenarioVersion: RECORD_VERSION,
        authoringRunId: AUTHORING_RUN_ID,
        passed: true,
        checks: [],
        createdAt: GENERATED_AT,
      },
    };
    record.validation.checks = validateImportedScenario(record);
    return record;
  });
}

fs.rmSync(ASSET_ROOT, { recursive: true, force: true });
fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });

const bundle = {
  schema: "teaching-tools/topic-scenario-bundle/v2",
  version: BUNDLE_VERSION,
  generatedAt: GENERATED_AT,
  sourceRoot: SOURCE_ROOT,
  authoringRun: undefined,
  lessons: {},
  scenarios: {},
};

for (const [taskId, config] of Object.entries(CONFIG)) {
  let offset = 0;
  const examples = [];
  for (const relativeFile of config.explanations) {
    const parsed = parseExplanationTex(taskId, relativeFile, offset);
    examples.push(...parsed);
    offset += parsed.length;
  }
  bundle.lessons[taskId] = {
    taskId,
    title: config.title,
    objective: config.objective,
    sourceAssignments: config.explanations,
    examples,
  };
  bundle.scenarios[taskId] = config.banks.flatMap((bank) => importBank(taskId, bank));
}

const totalScenarios = Object.values(bundle.scenarios).reduce((sum, records) => sum + records.length, 0);
bundle.authoringRun = {
  schema: "teaching-tools/authoring-run/v1",
  id: AUTHORING_RUN_ID,
  status: "completed",
  taskIds: Object.keys(CONFIG),
  startedAt: GENERATED_AT,
  finishedAt: GENERATED_AT,
  toolchainVersion: IMPORT_TOOL,
  inputSpecVersion: BUNDLE_VERSION,
  counts: {
    candidate: totalScenarios,
    validated: totalScenarios,
    approved: totalScenarios,
    rejected: 0,
  },
  outputCount: totalScenarios,
  scenarioIds: Object.values(bundle.scenarios).flatMap((records) => records.map((record) => record.id)),
};

const temporaryOutput = `${OUTPUT_JSON}.tmp`;
fs.writeFileSync(temporaryOutput, `${JSON.stringify(bundle, null, 2)}\n`);
fs.renameSync(temporaryOutput, OUTPUT_JSON);
const counts = Object.fromEntries(Object.entries(bundle.scenarios).map(([key, value]) => [key, value.length]));
console.log(JSON.stringify({ output: OUTPUT_JSON, counts, lessonExamples: Object.fromEntries(Object.entries(bundle.lessons).map(([key, value]) => [key, value.examples.length])) }, null, 2));
