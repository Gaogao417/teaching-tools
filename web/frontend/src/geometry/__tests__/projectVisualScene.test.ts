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
