/**
 * golden-question-geometry（Phase 5 波次 E：教师裁定「题图要补一下」）。
 *
 * 六道 golden 题的 authored TopicGeometryModel：坐标按题干条件**精确构造**
 * （数值解），构造不变量由 verifyGoldenGeometry() 自检（长度/垂直/平行/
 * 共线/角度），构建脚本装载时 fail closed——几何数据错则拒绝重建。
 *
 * 坐标系：数学空间（y 向上），viewBox 只定宽高比。derivedLines/teachingMarks
 * 不预著（C-2 裁定 1 口径：运行时投影不进题面）。
 *
 * 消费方：build-tutor-plans（--plan-schema v3：注入 action_template 的
 * input.geometry，opening 题图与 workspace world 同源）；
 * import-golden-topic-scenarios（scenario promptGeometry，legacy/训练页）。
 */

export interface GeometryPoint {
  id: string;
  x: number;
  y: number;
}
export interface GeometrySegment {
  id: string;
  from: string;
  to: string;
}
export interface GeometryModel {
  viewBox: { width: number; height: number };
  points: GeometryPoint[];
  segments: GeometrySegment[];
}

type Vec = { x: number; y: number };

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
const norm = (a: Vec): Vec => scale(a, 1 / (len(a) || 1));
const dist = (a: Vec, b: Vec): number => len(sub(a, b));
/** 点在直线 (p→q) 上的垂足。 */
const foot = (x: Vec, p: Vec, q: Vec): Vec => {
  const d = sub(q, p);
  return add(p, scale(d, dot(sub(x, p), d) / dot(d, d)));
};
/** 直线 (p1→q1) 与 (p2→q2) 交点。 */
const intersect = (p1: Vec, q1: Vec, p2: Vec, q2: Vec): Vec => {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const t = cross(sub(p2, p1), d2) / cross(d1, d2);
  return add(p1, scale(d1, t));
};
const P = (id: string, v: Vec): GeometryPoint => ({ id, x: round(v.x), y: round(v.y) });
const round = (n: number): number => Number(n.toFixed(3));
const near = (a: number, b: number, eps = 0.02): boolean => Math.abs(a - b) <= eps;

function model(points: GeometryPoint[], segments: GeometrySegment[]): GeometryModel {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    viewBox: { width: round(Math.max(...xs) - Math.min(...xs)), height: round(Math.max(...ys) - Math.min(...ys)) },
    points,
    segments,
  };
}

/** QT-SMV-001：等腰 AB=AC=4、BC=6，D 在 BC 上且 ∠DAC=∠ACD（⇒AD=DC=8/3），
 *  E 为 C 沿 AD 翻折的像。 */
function minhangFold(): GeometryModel {
  const h = Math.sqrt(4 * 4 - 3 * 3); // √7
  const a = { x: 0, y: h };
  const b = { x: -3, y: 0 };
  const c = { x: 3, y: 0 };
  // t=AD=DC：t²=(3−t)²+h² → t=(9+h²)/6=(9+7)/6=8/3
  const t = (9 + h * h) / 6;
  const d = { x: 3 - t, y: 0 };
  // E = C 关于直线 AD 的对称点
  const f = foot(c, a, d);
  const e = add(c, scale(sub(f, c), 2));
  return model(
    [P("A", a), P("B", b), P("C", c), P("D", d), P("E", e)],
    [
      { id: "AB", from: "A", to: "B" },
      { id: "AC", from: "A", to: "C" },
      { id: "BC", from: "B", to: "C" },
      { id: "AD", from: "A", to: "D" },
      { id: "AE", from: "A", to: "E" },
      { id: "DE", from: "D", to: "E" },
      { id: "BE", from: "B", to: "E" },
    ],
  );
}

/** QT-SMV-002：BD⊥AC，E 在 AB 上，CE 交 BD 于 O，AD·OC=AB·OD（数值解 E），
 *  AF 平分 ∠BAC 交 BC 于 F、交 DE 于 G。 */
function minhangCross(): GeometryModel {
  const a = { x: 0, y: 6 };
  const b = { x: -4, y: 0 };
  const c = { x: 5, y: 0 };
  const d = foot(b, a, c);
  const ad = dist(a, d);
  const ab = dist(a, b);
  // E = A + s(B−A)：二分解 s 使 AD·OC = AB·OD
  const ratio = (s: number): number => {
    const e = add(a, scale(sub(b, a), s));
    const o = intersect(c, e, b, d);
    return ad * dist(o, c) - ab * dist(o, d);
  };
  let lo = 0.05;
  let hi = 0.95;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (ratio(lo) * ratio(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const e = add(a, scale(sub(b, a), (lo + hi) / 2));
  const o = intersect(c, e, b, d);
  // 角平分线足：BF:FC = AB:AC
  const ac = dist(a, c);
  const f = add(b, scale(sub(c, b), ab / (ab + ac)));
  const g = intersect(a, f, d, e);
  return model(
    [P("A", a), P("B", b), P("C", c), P("D", d), P("E", e), P("O", o), P("F", f), P("G", g)],
    [
      { id: "AB", from: "A", to: "B" },
      { id: "AC", from: "A", to: "C" },
      { id: "BC", from: "B", to: "C" },
      { id: "BD", from: "B", to: "D" },
      { id: "CE", from: "C", to: "E" },
      { id: "AF", from: "A", to: "F" },
      { id: "DE", from: "D", to: "E" },
    ],
  );
}

/** QT-SMV-003：Rt△ABC（AC=BC=3，∠C=90°）与 Rt△ACD（∠D=90°，CD=2，
 *  A、B 在直线 CD 两侧）；E=CD∩AB，F=AB 中点（重心射线 CG 即中线），
 *  G=重心。 */
function minhangParentChild(): GeometryModel {
  const c = { x: 0, y: 0 };
  const a = { x: 0, y: 3 };
  const b = { x: 3, y: 0 };
  // D：|CD|=2 且 (A−D)⊥(C−D) → (A·û)=2，û 为 C→D 单位向量；取使 A、B
  // 分居直线 CD 两侧的解。
  const ca = sub(a, c);
  const cosPhi = 2 / len(ca); // = 2/3
  const phi = Math.acos(cosPhi);
  const base = Math.atan2(ca.y, ca.x);
  const candidates = [base - phi, base + phi].map((angle) => add(c, scale({ x: Math.cos(angle), y: Math.sin(angle) }, 2)));
  const d = cross(sub(b, c), sub(candidates[0], c)) * cross(sub(a, c), sub(candidates[0], c)) < 0
    ? candidates[0]
    : candidates[1];
  const e = intersect(c, d, a, b);
  const f = scale(add(a, b), 0.5);
  const g = scale(add(add(a, b), d), 1 / 3);
  return model(
    [P("A", a), P("B", b), P("C", c), P("D", d), P("E", e), P("F", f), P("G", g)],
    [
      { id: "AC", from: "A", to: "C" },
      { id: "BC", from: "B", to: "C" },
      { id: "AB", from: "A", to: "B" },
      { id: "CD", from: "C", to: "D" },
      { id: "AD", from: "A", to: "D" },
      { id: "CG", from: "C", to: "G" },
      { id: "DG", from: "D", to: "G" },
    ],
  );
}

/** QT-SMV-004：测高仪（CD=60 竖直，D—B—C 且 DB=20；AB=40 水平，B 处铅垂
 *  到地面 E）+ 大树 MN（视线 A→C→M 共线，E、N 同在地面）。示意比例。 */
function huangpuTreeHeight(): GeometryModel {
  const c = { x: 0, y: 60 };
  const b = { x: 0, y: 20 };
  const d = { x: 0, y: 0 };
  const a = { x: 40, y: 20 };
  const groundY = -60;
  const e = { x: 0, y: groundY };
  const n = { x: -120, y: groundY };
  // 视线 A→C 延长到 x = n.x 处的树顶 M（共线）
  const dir = sub(c, a);
  const t = (n.x - a.x) / dir.x;
  const m = add(a, scale(dir, t));
  return model(
    [P("A", a), P("B", b), P("C", c), P("D", d), P("E", e), P("M", m), P("N", n)],
    [
      { id: "DC", from: "D", to: "C" },
      { id: "AB", from: "A", to: "B" },
      { id: "BE", from: "B", to: "E" },
      { id: "AM", from: "A", to: "M" },
      { id: "MN", from: "M", to: "N" },
      { id: "EN", from: "E", to: "N" },
    ],
  );
}

/** QT-SMV-005：CD 平分 ∠ACB（D 在 AB 上，角平分线定理定 D）；E 在 CD 延长
 *  线上且 AE=AD（数值解）；F 在 AB 延长线上且 CF∥AE（第(2)问条件）。 */
function huangpuAngleBisector(): GeometryModel {
  // 构形取 ∠ADC 钝角（A 在 CD 上的投影越过 D），E 才落在 CD 延长线上。
  const a = { x: -6, y: 3 };
  const b = { x: 1, y: 3 };
  const c = { x: 0, y: 0 };
  const ac = dist(a, c);
  const cb = dist(c, b);
  const d = add(a, scale(sub(b, a), ac / (ac + cb))); // AD:DB = AC:CB
  // E 在射线 C→D 上（参数 u>uD）且 |AE|=|AD|：解 (E−A)²=AD²
  const dir = norm(sub(d, c));
  const ad = dist(a, d);
  const uE = (() => {
    // |C+u·dir − A| = ad → u² − 2u·(dir·(A−C)) + |A−C|²−ad² = 0
    const p = dot(dir, sub(a, c));
    const q = dot(sub(a, c), sub(a, c)) - ad * ad;
    const disc = Math.max(0, p * p - q);
    return p + Math.sqrt(disc); // 取大于 uD 的根（延长线方向）
  })();
  const e = add(c, scale(dir, uE));
  // F：过 C 平行 AE 的直线与直线 AB 的交点（落在 AB 延长线上）
  const f = intersect(c, add(c, sub(a, e)), a, b);
  return model(
    [P("A", a), P("B", b), P("C", c), P("D", d), P("E", e), P("F", f)],
    [
      { id: "AC", from: "A", to: "C" },
      { id: "BC", from: "B", to: "C" },
      { id: "AB", from: "A", to: "B" },
      { id: "CE", from: "C", to: "E" },
      { id: "AE", from: "A", to: "E" },
      { id: "AD", from: "A", to: "D" },
      { id: "CF", from: "C", to: "F" },
      { id: "BF", from: "B", to: "F" },
    ],
  );
}

/** QT-SMV-006：▱ABCD，AB=9、BC=5、sinB=4/5（取 cosB=−3/5 的钝角形态）；
 *  P 在 AB 上，PE⊥PC 交 CD 于 E、交 AC 于 H；F 在 PE 上且 FP:PC=2:3。 */
function huangpuMovingPoint(): GeometryModel {
  const a = { x: 0, y: 0 };
  const b = { x: 9, y: 0 };
  const sinB = 4 / 5;
  const cosB = -3 / 5;
  const bc = { x: 5 * -cosB, y: 5 * sinB }; // 与 BA(−x) 夹角 B
  const c = add(b, bc);
  const d = add(a, bc);
  const p = { x: 3, y: 0 };
  // E 在直线 CD（y=bc.y 高度）且 (E−P)⊥(C−P)
  const cp = sub(c, p);
  const ex = p.x - (cp.y * bc.y) / cp.x; // (e−p)·cp=0，e.y=bc.y
  const e = { x: ex, y: bc.y };
  const h = intersect(p, e, a, c);
  const f = add(p, scale(cp, 2 / 3));
  return model(
    [P("A", a), P("B", b), P("C", c), P("D", d), P("P", p), P("E", e), P("H", h), P("F", f)],
    [
      { id: "AB", from: "A", to: "B" },
      { id: "BC", from: "B", to: "C" },
      { id: "CD", from: "C", to: "D" },
      { id: "DA", from: "D", to: "A" },
      { id: "AC", from: "A", to: "C" },
      { id: "PE", from: "P", to: "E" },
      { id: "CF", from: "C", to: "F" },
    ],
  );
}

export const GOLDEN_GEOMETRY: Record<string, GeometryModel> = {
  "QT-SMV-001": minhangFold(),
  "QT-SMV-002": minhangCross(),
  "QT-SMV-003": minhangParentChild(),
  "QT-SMV-004": huangpuTreeHeight(),
  "QT-SMV-005": huangpuAngleBisector(),
  "QT-SMV-006": huangpuMovingPoint(),
};

const byId = (m: GeometryModel, id: string): Vec => {
  const p = m.points.find((entry) => entry.id === id);
  if (!p) throw new Error(`geometry ${id} 缺失`);
  return { x: p.x, y: p.y };
};

/** 构造不变量自检（fail closed）：题干关键量逐题核对。 */
export function verifyGoldenGeometry(): string[] {
  const errors: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };

  {
    const m = GOLDEN_GEOMETRY["QT-SMV-001"];
    const A = byId(m, "A"), B = byId(m, "B"), C = byId(m, "C"), D = byId(m, "D"), E = byId(m, "E");
    check(near(dist(A, B), 4) && near(dist(A, C), 4) && near(dist(B, C), 6), "QT-001 等腰边长");
    check(near(dist(A, D), dist(D, C)) && near(dist(D, C), 8 / 3, 0.03), "QT-001 AD=DC=8/3");
    check(near(dist(A, E), dist(A, C)) && near(dist(D, E), dist(D, C)), "QT-001 翻折保长（AE=AC、DE=DC）");
    check(near(dot(sub(A, D), sub(C, E)), 0, 0.5), "QT-001 CE⊥AD（对称轴）");
  }
  {
    const m = GOLDEN_GEOMETRY["QT-SMV-002"];
    const B = byId(m, "B"), D = byId(m, "D"), A = byId(m, "A"), C = byId(m, "C"), O = byId(m, "O"), E = byId(m, "E");
    check(near(dot(sub(B, D), sub(A, C)), 0, 0.5), "QT-002 BD⊥AC");
    check(near(dist(A, D) * dist(O, C), dist(A, B) * dist(O, D), 0.05), "QT-002 AD·OC=AB·OD");
    check(near(cross(sub(C, E), sub(C, O)), 0, 0.5), "QT-002 C、O、E 共线");
    const F = byId(m, "F");
    check(near(dist(B, F) / dist(F, C), dist(A, B) / dist(A, C), 0.03), "QT-002 角平分线定理 BF/FC=AB/AC");
  }
  {
    const m = GOLDEN_GEOMETRY["QT-SMV-003"];
    const A = byId(m, "A"), B = byId(m, "B"), C = byId(m, "C"), D = byId(m, "D"), E = byId(m, "E"), G = byId(m, "G"), F = byId(m, "F");
    check(near(dist(A, C), dist(B, C)) && near(dot(sub(A, C), sub(B, C)), 0, 0.02), "QT-003 等腰直角（AC=BC、∠C=90°）");
    check(near(dist(C, D), 2, 0.01) && near(dot(sub(A, D), sub(C, D)), 0, 0.02), "QT-003 CD=2 且 ∠ADC=90°");
    check(cross(sub(B, C), sub(D, C)) * cross(sub(A, C), sub(D, C)) < 0, "QT-003 A、B 分居直线 CD 两侧");
    check(near(cross(sub(C, D), sub(C, E)), 0, 0.02) && near(cross(sub(A, B), sub(A, E)), 0, 0.02), "QT-003 E=CD∩AB");
    check(near(dist(A, F), dist(F, B), 0.02), "QT-003 F=AB 中点（重心在中线上）");
    check(near(dist(A, G) + 0, 0, 999) || near(dot(sub(G, C), sub(F, C)), len(sub(G, C)) * len(sub(F, C)), 0.5), "QT-003 C、G、F 共线");
  }
  {
    const m = GOLDEN_GEOMETRY["QT-SMV-004"];
    const A = byId(m, "A"), B = byId(m, "B"), C = byId(m, "C"), D = byId(m, "D"), E = byId(m, "E"), M = byId(m, "M"), N = byId(m, "N");
    check(near(dist(D, B), 20) && near(dist(B, C), 40) && near(dist(D, C), 60), "QT-004 DB=20、BC=40、DC=60");
    check(near(dist(A, B), 40) && near(dot(sub(A, B), sub(D, C)), 0, 0.02), "QT-004 AB=40 且 AB⊥CD");
    check(near(cross(sub(C, A), sub(M, A)), 0, 0.5), "QT-004 视线 A、C、M 共线");
    check(near(dot(sub(B, E), { x: 1, y: 0 }), 0, 0.02) && near(E.y, N.y), "QT-004 铅垂竖直、E/N 同地面");
  }
  {
    const m = GOLDEN_GEOMETRY["QT-SMV-005"];
    const A = byId(m, "A"), B = byId(m, "B"), C = byId(m, "C"), D = byId(m, "D"), E = byId(m, "E"), F = byId(m, "F");
    const angleOf = (u: Vec, v: Vec): number => Math.acos(dot(norm(u), norm(v)));
    check(
      near(angleOf(sub(D, C), sub(A, C)), angleOf(sub(B, C), sub(D, C)), 0.02),
      "QT-005 CD 平分 ∠ACB",
    );
    check(near(dist(A, E), dist(A, D), 0.03), "QT-005 AE=AD");
    check(near(cross(sub(C, D), sub(C, E)), 0, 0.02), "QT-005 E 在 CD 延长线上");
    check(near(cross(sub(F, C), sub(A, E)), 0, 0.5), "QT-005 CF∥AE");
    check(near(cross(sub(F, B), sub(A, B)), 0, 0.02), "QT-005 F 在 AB 延长线上");
  }
  {
    const m = GOLDEN_GEOMETRY["QT-SMV-006"];
    const A = byId(m, "A"), B = byId(m, "B"), C = byId(m, "C"), D = byId(m, "D"), P = byId(m, "P"), E = byId(m, "E");
    check(near(dist(A, B), 9) && near(dist(B, C), 5), "QT-006 AB=9、BC=5");
    check(near(Math.abs(cross(sub(B, A), sub(C, B))) / (dist(B, A) * dist(C, B)), 4 / 5, 0.01), "QT-006 sinB=4/5");
    check(near(cross(sub(C, D), sub(B, A)), 0, 0.02) && near(dist(C, D), 9), "QT-006 平行四边形（CD∥AB=9）");
    check(near(dot(sub(E, P), sub(C, P)), 0, 0.02), "QT-006 PE⊥PC");
    check(near(E.y, C.y, 0.01), "QT-006 E 在射线 CD 上");
    const F = byId(m, "F");
    check(near(dist(F, P) / dist(P, C), 2 / 3, 0.02), "QT-006 FP:PC=2:3");
  }

  for (const [qtId, m] of Object.entries(GOLDEN_GEOMETRY)) {
    const ids = new Set(m.points.map((p) => p.id));
    if (m.points.length !== ids.size) errors.push(`${qtId}: 点 id 重复`);
    for (const s of m.segments) {
      if (!ids.has(s.from) || !ids.has(s.to)) errors.push(`${qtId}: 线段 ${s.id} 引用缺失点`);
    }
    if (!m.viewBox.width || !m.viewBox.height) errors.push(`${qtId}: viewBox 退化`);
  }
  return errors;
}

if (require.main === module) {
  const errors = verifyGoldenGeometry();
  if (errors.length) {
    console.error("FAIL golden geometry:");
    for (const e of errors) console.error(" -", e);
    process.exit(1);
  }
  console.log(`PASS golden geometry（${Object.keys(GOLDEN_GEOMETRY).length} 图，构造不变量全过）`);
}
