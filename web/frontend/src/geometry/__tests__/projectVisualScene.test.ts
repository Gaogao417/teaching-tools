import { describe, expect, it } from "vitest";
import type { VisualView } from "../../../../shared/canonical/visualSchemas";
import { GeometryModel } from "../domain/model";
import { projectVisualScene } from "../react/projectVisualScene";
import { visualMathLabel } from "../react/visualMathLabel";
const model = new GeometryModel({ points: [
  { id: "pt-A", x: 40, y: 40 }, { id: "pt-B", x: 120, y: 40 }, { id: "pt-C", x: 40, y: 120 },
  { id: "pt-D", x: 200, y: 40 }, { id: "pt-E", x: 240, y: 40 }, { id: "pt-F", x: 200, y: 80 },
] });
const viewport = { width: 400, height: 300, project: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }) };
const triangles: NonNullable<VisualView["annotations"][number]["resolved_targets"]["triangles"]> = { left: ["pt-C", "pt-A", "pt-B"], right: ["pt-F", "pt-D", "pt-E"] };
function view(): VisualView { return { visual_revision: 1, digest: "a".repeat(64), annotations: [], focus: null }; }
describe("authorized ordered visual projections", () => {
  it("renders angle focus from explicit rays", () => {
    const v = view();
    v.focus = { group_id: "group", binding_ref: "binding", mode: "pulse", owner_key: "owner", resolved_targets: {
      entity_ids: ["pt-C", "pt-B", "pt-A"], angles: [{ vertex: "pt-A", ray_points: ["pt-B", "pt-C"], sector: "minor" }],
    } };
    expect(projectVisualScene(v, model, viewport).glyphs).toEqual([expect.objectContaining({ kind: "angle", id: "focus:group/angle/0", vertex: { x: 40, y: 40 }, rays: [{ x: 120, y: 40 }, { x: 40, y: 120 }] })]);
  });
  it("renders ordered triangle focus without pair_index", () => {
    const v = view();
    v.focus = { group_id: "group", binding_ref: "binding", mode: "steady", owner_key: "owner", resolved_targets: { entity_ids: ["pt-A", "pt-D"], triangles } };
    const glyphs = projectVisualScene(v, model, viewport).glyphs;
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0]).toMatchObject({ kind: "path", closed: true, description: "△CAB", points: [{ x: 40, y: 120 }, { x: 40, y: 40 }, { x: 120, y: 40 }] });
    expect(glyphs[1]).toMatchObject({ description: "△FDE" });
  });
  it("expands annotation triangles into three unequal corresponding pairs", () => {
    const v = view();
    v.annotations = [{ annotation_id: "annotation", binding_ref: "binding", form: "paired-sides", role_key: "sides", version: 1, owner_keys: ["owner"], resolved_targets: { entity_ids: ["pt-A", "pt-B", "pt-C", "pt-D", "pt-E", "pt-F"], triangles } }];
    const glyphs = projectVisualScene(v, model, viewport).glyphs;
    expect(glyphs.filter(g => g.kind === "path")).toHaveLength(6);
    expect(new Set(glyphs.map(g => g.color)).size).toBe(3);
    expect(glyphs.filter(g => g.kind === "label").map(g => g.text)).toEqual(["CA", "FD", "AB", "DE", "BC", "EF"]);
    expect(glyphs.some(g => g.description.includes("="))).toBe(false);
  });
  it("formats fractions without exposing LaTeX syntax or evaluating content", () => {
    expect(visualMathLabel("$AD=\\frac{8}{3}$")).toBe("AD=8/3");
    expect(visualMathLabel("$\\frac{AB}{DE}=\\frac{2}{3}$")).toBe("AB/DE=2/3");
    expect(visualMathLabel("$\\frac{a+b}{c+d}$")).toBe("(a+b)/(c+d)");
    expect(() => visualMathLabel("$\\unknown{bad}$")).toThrow();
  });
});


describe("resolved segment attention", () => {
  const geometry = new GeometryModel({ points: [...model.pointsList()], lines: [
    { id: "segment-CA", kind: "segment", from: "pt-C", to: "pt-A" },
    { id: "segment-CB", kind: "segment", from: "pt-C", to: "pt-B" },
    { id: "bounded", kind: "parallel-line", through: "pt-D", parallelTo: "segment-CA", endPoint: "pt-F" },
    { id: "infinite", kind: "parallel-line", through: "pt-D", parallelTo: "segment-CA" },
  ] });
  const focusView = (ids: string[], mode: "steady" | "pulse" = "steady"): VisualView => ({ ...view(), focus: {
    group_id: "ratio", binding_ref: "VB105", mode, owner_key: "teach", resolved_targets: { entity_ids: ids },
  } });
  it.each(["steady", "pulse"] as const)("projects %s attention only from explicit segments, without inferred correspondence", mode => {
    const scene = projectVisualScene(focusView(["segment-CA", "pt-C", "segment-CB", "pt-A", "pt-B", "segment-CA"], mode), geometry, viewport);
    expect(scene.glyphs).toHaveLength(2);
    expect(scene.glyphs.map(g => g.kind)).toEqual(["path", "path"]);
    expect(new Set(scene.glyphs.map(g => g.color)).size).toBe(1);
    expect(scene.glyphs[0]).toMatchObject({ id: "focus:ratio/segment/segment-CA", points: [{ x: 40, y: 120 }, { x: 40, y: 40 }], ownerKeys: ["teach"] });
    expect(scene.glyphs.map(g => g.description)).toEqual(["关注线段 CA", "关注线段 CB"]);
    expect(scene.glyphs.some(g => /[=↔]/.test(g.description))).toBe(false);
  });
  it("rejects a nonsegment even when it has a display endpoint", () => {
    expect(() => projectVisualScene(focusView(["bounded", "pt-D", "pt-F"]), geometry, viewport)).toThrow(/bounded segment/);
  });
  it.each([["pt-A", "pt-B"], ["segment-CA", "unknown"], ["infinite"], []])("rejects unknown, point-only or unbounded targets %j", (...ids) => {
    expect(() => projectVisualScene(focusView(ids), geometry, viewport)).toThrow();
  });
});
