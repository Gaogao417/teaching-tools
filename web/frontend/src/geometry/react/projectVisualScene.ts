import type { VisualView } from "../../../../shared/canonical/visualSchemas";
import type { GeometryModel } from "../domain/model";
import { VisualRenderError, type PixelRect, type PixelPoint, type VisualGlyph, type VisualRenderScene } from "./visualRenderTypes";

export interface VisualViewport {
  width: number;
  height: number;
  labelObstacles?: readonly PixelRect[];
  project(point: { x: number; y: number }): PixelPoint;
}
const colors = ["#0369a1", "#a16207", "#7c3aed"];
const name = (id: string) => id.replace(/^pt-([A-Z](?:[0-9]+|['′])?)$/, "$1");

/** Only geometry-to-pixels translation. The server has already decided visible
 * owners, authorized text and ordered targets; no binding resolution here. */
export function projectVisualScene(view: VisualView, model: GeometryModel, viewport: VisualViewport): VisualRenderScene {
  const glyphs: VisualGlyph[] = [];
  const point = (id: string) => {
    const p = model.getPoint(id);
    if (!p) throw new VisualRenderError("identity", `visual target point missing: ${id}`);
    return viewport.project(p);
  };
  const segment = (id: string): [PixelPoint, PixelPoint] => {
    const line = model.getLine(id);
    if (!line) throw new VisualRenderError("identity", `visual segment missing: ${id}`);
    if (line.kind === "segment") return [point(line.from), point(line.to)];
    if (line.endPoint) return [point(line.through), point(line.endPoint)];
    throw new VisualRenderError("identity", `visual label requires a bounded segment: ${id}`);
  };
  const angleBindings = [...new Set(view.annotations.filter(a => a.form === "angle-arcs").map(a => a.binding_ref))].sort();
  if (angleBindings.length > 2) throw new VisualRenderError("layout", "more than two simultaneous angle styles");
  const mergedAngles = new Map<string, Extract<VisualGlyph, { kind: "angle" }>>();
  const paired = (id: string, ownerKeys: readonly string[], pairs: NonNullable<VisualView["annotations"][number]["resolved_targets"]["paired_sides"]>, color: string) => {
    const description = pairs.map(pair => pair.endpoints.map(name).join("")).join(" ↔ ");
    pairs.forEach((pair, index) => {
      const points = pair.endpoints.map(point);
      glyphs.push({ id: `${id}/${index}`, ownerKeys, color, description, kind: "path", points });
      glyphs.push({ id: `${id}/label/${index}`, ownerKeys, color, description, kind: "label", text: pair.endpoints.map(name).join(""),
        anchor: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } });
    });
  };
  for (const annotation of view.annotations) {
    const base = { id: annotation.annotation_id, ownerKeys: annotation.owner_keys, color: colors[0], description: annotation.content ?? annotation.role_key };
    if (annotation.form === "angle-arcs") {
      const angles = annotation.resolved_targets.angles;
      if (!angles?.length) throw new VisualRenderError("identity", "angle annotation has no explicit rays");
      const style = angleBindings.indexOf(annotation.binding_ref);
      for (const [index, angle] of angles.entries()) {
        const vertex = point(angle.vertex);
        const rays: [PixelPoint, PixelPoint] = [point(angle.ray_points[0]), point(angle.ray_points[1])];
        const directions = rays.map(p => {
          const length = Math.hypot(p.x - vertex.x, p.y - vertex.y);
          if (!length) throw new VisualRenderError("layout", "degenerate angle ray");
          return `${((p.x - vertex.x) / length).toFixed(8)},${((p.y - vertex.y) / length).toFixed(8)}`;
        }).sort();
        const key = `${vertex.x},${vertex.y}:${directions.join(";")}`;
        const description = `∠${name(angle.ray_points[0])}${name(angle.vertex)}${name(angle.ray_points[1])}`;
        const previous = mergedAngles.get(key);
        if (previous) {
          previous.description += ` / ${description}`;
          previous.ownerKeys = [...new Set([...previous.ownerKeys, ...annotation.owner_keys])];
        } else {
          const glyph: Extract<VisualGlyph, { kind: "angle" }> = { ...base, id: `${base.id}/angle/${index}`, kind: "angle", vertex, rays,
            color: colors[style], arcCount: style === 0 ? 1 : 2, description };
          mergedAngles.set(key, glyph); glyphs.push(glyph);
        }
      }
      continue;
    }
    if (annotation.form === "length-label" || annotation.form === "ratio-label") {
      if (!annotation.content) throw new VisualRenderError("identity", "mathematical label lacks authorized content");
      const ids = annotation.resolved_targets.entity_ids.filter(id => model.getLine(id));
      if (!ids.length) throw new VisualRenderError("identity", "mathematical label has no segment target");
      const [a, b] = segment(ids[0]);
      glyphs.push({ ...base, kind: "label", text: annotation.content, anchor: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
      continue;
    }
    if (annotation.form === "paired-sides") {
      const pairs = annotation.resolved_targets.paired_sides;
      if (pairs) paired(base.id, base.ownerKeys, pairs, base.color);
      else {
        const triangles = annotation.resolved_targets.triangles;
        if (!triangles) throw new VisualRenderError("identity", "paired sides lack ordered endpoints or triangles");
        for (const [index, next] of [[0, 1], [1, 2], [2, 0]]) {
          paired(`${base.id}/pair/${index}`, base.ownerKeys, [
            { endpoints: [triangles.left[index], triangles.left[next]] },
            { endpoints: [triangles.right[index], triangles.right[next]] },
          ], colors[index]);
        }
      }
    } else {
      const triangles = annotation.resolved_targets.triangles;
      if (!triangles) throw new VisualRenderError("identity", "triangle outlines lack ordered vertices");
      [triangles.left, triangles.right].forEach((vertices, index) => {
        const description = `△${vertices.map(name).join("")}`;
        const points = vertices.map(point);
        glyphs.push({ ...base, id: `${base.id}/triangle/${index}`, kind: "path", points, closed: true, description });
        glyphs.push({ ...base, id: `${base.id}/role/${index}`, kind: "label", text: description,
          anchor: { x: points.reduce((sum, p) => sum + p.x, 0) / 3, y: points.reduce((sum, p) => sum + p.y, 0) / 3 } });
      });
    }
  }
  if (view.focus) {
    const focus = view.focus;
    if (focus.resolved_targets.paired_sides) {
      paired(`focus:${focus.group_id}`, [focus.owner_key], focus.resolved_targets.paired_sides, colors[(focus.pair_index ?? 0) % colors.length]);
    } else if (focus.resolved_targets.angles?.length) {
      focus.resolved_targets.angles.forEach((angle, index) => {
        glyphs.push({ id: `focus:${focus.group_id}/angle/${index}`, ownerKeys: [focus.owner_key],
          color: colors[0], description: `∠${name(angle.ray_points[0])}${name(angle.vertex)}${name(angle.ray_points[1])}`,
          kind: "angle", vertex: point(angle.vertex), rays: [point(angle.ray_points[0]), point(angle.ray_points[1])], arcCount: 1 });
      });
    } else if (focus.resolved_targets.triangles) {
      const triangles = focus.resolved_targets.triangles;
      [triangles.left, triangles.right].forEach((vertices, index) => {
        glyphs.push({ id: `focus:${focus.group_id}/triangle/${index}`, ownerKeys: [focus.owner_key],
          color: colors[0], description: `△${vertices.map(name).join("")}`, kind: "path", points: vertices.map(point), closed: true });
      });
    } else {
      throw new VisualRenderError("identity", "focus lacks explicit angle or ordered similarity targets");
    }
  }
  const protectedSegments: [PixelPoint, PixelPoint][] = [];
  for (const line of model.linesList()) {
    if (line.kind === "segment") {
      protectedSegments.push([point(line.from), point(line.to)]);
      if (line.extensionPoint) protectedSegments.push([point(line.to), point(line.extensionPoint)]);
    } else if (line.endPoint) protectedSegments.push([point(line.through), point(line.endPoint)]);
    else {
      const origin = model.getPoint(line.through)!;
      const direction = model.lineDirection(line.id);
      const a = viewport.project(origin), b = viewport.project({ x: origin.x + direction.dx, y: origin.y + direction.dy });
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length) {
        const extent = Math.hypot(viewport.width, viewport.height) * 2;
        protectedSegments.push([{ x: a.x - (b.x-a.x)/length*extent, y: a.y - (b.y-a.y)/length*extent }, { x: a.x + (b.x-a.x)/length*extent, y: a.y + (b.y-a.y)/length*extent }]);
      }
    }
  }
  return { width: viewport.width, height: viewport.height, glyphs, protectedSegments,
    labelObstacles: [...(viewport.labelObstacles ?? []), ...model.pointsList().map(p => {
      const pixel = viewport.project(p); return { x: pixel.x - 6, y: pixel.y - 6, width: 12, height: 12 };
    })] };

}
