import { visualMathLabel } from "./visualMathLabel";
import { VisualRenderError, sameVisualRenderIdentity, type PixelPoint, type VisualGlyph, type VisualRenderExecution, type VisualRenderReceipt, type VisualRenderScene, type VisualInspectionTarget } from "./visualRenderTypes";

const SVG = "http://www.w3.org/2000/svg";
const MARGIN = 6;
type Rect = { x: number; y: number; width: number; height: number };
export interface VisualEffectRegistryOptions {
  surfaceGeneration: number;
  /** Injection for renderer tests. Production always uses actual SVG measurement. */
  measureText?: (node: SVGTextElement) => Rect;
  reducedMotion?: () => boolean;
  inspectionEnabled?: () => boolean;
}

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}
const finite = (p: PixelPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
const within = (r: Rect, width: number, height: number) => r.x >= MARGIN && r.y >= MARGIN
  && r.x + r.width <= width - MARGIN && r.y + r.height <= height - MARGIN;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width + 4 && a.x + a.width + 4 > b.x
  && a.y < b.y + b.height + 4 && a.y + a.height + 4 > b.y;

/** Segment/rectangle clipping, used only to keep glyph text off base geometry. */
function lineCrossesLabel(a: PixelPoint, b: PixelPoint, rect: Rect): boolean {
  const left=rect.x-3, right=rect.x+rect.width+3, top=rect.y-3, bottom=rect.y+rect.height+3;
  const dx=b.x-a.x, dy=b.y-a.y;
  let start=0, end=1;
  for(const [p,q] of [[-dx,a.x-left],[dx,right-a.x],[-dy,a.y-top],[dy,bottom-a.y]]) {
    if(p===0) { if(q<0)return false; continue; }
    const t=q/p;
    if(p<0) start=Math.max(start,t); else end=Math.min(end,t);
    if(start>end)return false;
  }
  return true;
}

/** Pixel-sized minor arcs only. The angle is used for placement, never a label. */
export function minorAngleArc(vertex: PixelPoint, rays: readonly [PixelPoint, PixelPoint], radius: number): string {
  if (![vertex, ...rays].every(finite) || !(radius > 0)) throw new VisualRenderError("layout", "non-finite angle geometry");
  const lengths = rays.map(p => Math.hypot(p.x - vertex.x, p.y - vertex.y));
  if (lengths.some(length => length < 1e-6)) throw new VisualRenderError("layout", "angle ray has zero length");
  const first = Math.atan2(rays[0].y - vertex.y, rays[0].x - vertex.x);
  const second = Math.atan2(rays[1].y - vertex.y, rays[1].x - vertex.x);
  const delta = (second - first + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  if (Math.abs(delta) < 1e-6 || Math.abs(Math.abs(delta) - Math.PI) < 1e-6) throw new VisualRenderError("layout", "degenerate angle sector");
  const r = Math.min(radius, ...lengths.map(length => length * 0.4));
  const start = { x: vertex.x + Math.cos(first) * r, y: vertex.y + Math.sin(first) * r };
  const end = { x: vertex.x + Math.cos(first + delta) * r, y: vertex.y + Math.sin(first + delta) * r };
  return `M ${start.x} ${start.y} A ${r} ${r} 0 0 ${delta > 0 ? 1 : 0} ${end.x} ${end.y}`;
}

/** Renderer-owned effects only. All authoritative owners/content arrive in the
 * scene; this class never advances an action, invents leases or reports HTTP. */
export class VisualEffectRegistry {
  private readonly root: SVGSVGElement;
  private serial = 0;
  private disposed = false;
  private suppressed = false;
  private animation?: Animation;
  private cancelPending?: () => void;
  private lastReceipt?: VisualRenderReceipt;
  private lastScene?: string;
  private currentScene?: VisualRenderScene;
  private lastIds: readonly string[] = [];
  private informationCard?: HTMLDivElement;
  private inspectionAbort?: AbortController;
  private hiddenIntroductionIds: readonly string[] = [];
  private readonly owners = new Map<string, readonly string[]>();

  constructor(private readonly host: HTMLElement, private readonly options: VisualEffectRegistryOptions) {
    this.root = node("svg", { "data-visual-registry": String(options.surfaceGeneration), role: "img", "aria-label": "几何关系与标注" });
    Object.assign(this.root.style, { position: "absolute", inset: "0", width: "100%", height: "100%", overflow: "hidden", pointerEvents: "none" });
    host.appendChild(this.root);
  }

  private check(execution: VisualRenderExecution, serial: number): void {
    if (execution.abort.aborted || serial !== this.serial) throw new VisualRenderError("aborted", "visual execution cancelled");
    if (this.disposed || execution.surfaceGeneration !== this.options.surfaceGeneration || !this.root.isConnected) {
      throw new VisualRenderError("stale-surface", "visual surface was replaced");
    }
  }

  async install(scene: VisualRenderScene, execution: VisualRenderExecution): Promise<VisualRenderReceipt> {
    if (this.lastReceipt && sameVisualRenderIdentity(this.lastReceipt, execution)) {
      this.check(execution, this.serial);
      if (this.lastScene !== JSON.stringify(scene)) throw new VisualRenderError("identity", "same visual execution changed rendered payload");
      this.verifyObjects(new Set(this.lastIds));
      return this.lastReceipt;
    }
    this.cancelPending?.();
    this.clearInspection(); this.hiddenIntroductionIds = []; this.suppressed = false;
    const serial = ++this.serial;
    this.check(execution, serial);
    if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height) || scene.width <= 2 * MARGIN || scene.height <= 2 * MARGIN) {
      throw new VisualRenderError("layout", "visual viewport has no readable area");
    }
    const ids = new Set(scene.glyphs.map(g => g.id));
    const isPulsed = (id: string) => execution.pulseIds?.some(target => id === target || id.startsWith(`${target}/`)) ?? false;
    if (ids.size !== scene.glyphs.length) throw new VisualRenderError("identity", "duplicate visual glyph identity");
    if (execution.pulseIds?.some(target => ![...ids].some(id => id === target || id.startsWith(`${target}/`)))) throw new VisualRenderError("identity", "pulse target missing from safe scene");
    const layer = node("g", { "data-visual-execution": execution.executionKey });
    const pulse = node("g", { "data-visual-pulse": "true" });
    layer.appendChild(pulse);
    // Measure a staged layer in the actual mounted SVG; it is not a completion.
    layer.style.visibility = "hidden";
    this.root.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
    this.root.appendChild(layer);
    const textRects: Rect[] = [];
    const nextOwners = new Map<string, readonly string[]>();
    try {
      for (const glyph of [...scene.glyphs].sort((a, b) => a.id.localeCompare(b.id))) {
        if (!glyph.ownerKeys.length) throw new VisualRenderError("identity", "glyph has no projected owner");
        const group = node("g", { "data-visual-id": glyph.id, "aria-label": glyph.description });
        (isPulsed(glyph.id) ? pulse : layer).appendChild(group);
        this.draw(group, glyph, scene, textRects);
        nextOwners.set(glyph.id, [...glyph.ownerKeys]);
      }
      this.check(execution, serial);
      for (const child of [...this.root.children]) if (child !== layer) child.remove();
      this.owners.clear();
      for (const [id, owners] of nextOwners) this.owners.set(id, owners);
      layer.style.visibility = "visible";
      this.root.style.visibility = "visible";
      this.currentScene = scene;
      this.installInspection(scene);
      if (scene.teachingInformation?.length) this.showInformation(scene.teachingInformation, true);
      const reduced = this.options.reducedMotion?.() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      if (execution.operation === "entrance-complete" && execution.pulseIds?.length && (!reduced || execution.transientReveal)) {
        if (typeof pulse.animate !== "function") throw new VisualRenderError("layout", "finite visual animation is unavailable");
        const animation = pulse.animate(reduced ? [{ opacity: 1 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 900, iterations: 2 });
        this.animation = animation;
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { animation.cancel(); reject(new VisualRenderError("aborted", "visual animation cancelled")); };
          this.cancelPending = cancel;
          execution.abort.addEventListener("abort", cancel, { once: true });
          animation.finished.then(() => resolve(), () => reject(new VisualRenderError("aborted", "visual animation did not finish"))).finally(() => {
            execution.abort.removeEventListener("abort", cancel);
            if (this.cancelPending === cancel) this.cancelPending = undefined;
          });
        });
        animation.cancel(); // Keep the underlying static color, not an animation timer.
        if (this.animation === animation) this.animation = undefined;
      }
      this.check(execution, serial);
      this.verifyObjects(ids);
      if (execution.transientReveal) {
        this.hiddenIntroductionIds = [...(execution.presentationIds ?? [])];
        const hidden = (id: string) => this.hiddenIntroductionIds.some(prefix => id === prefix || id.startsWith(`${prefix}/`));
        for (const element of this.root.querySelectorAll<SVGElement>("[data-visual-id]")) if (hidden(element.getAttribute("data-visual-id")!)) element.remove();
        for (const id of [...ids]) if (hidden(id)) ids.delete(id);
        this.currentScene = { ...scene, glyphs: scene.glyphs.filter(g=>!hidden(g.id)), teachingInformation: scene.focusInformation ?? [] };
        this.closeInformation();
        if(this.currentScene.teachingInformation?.length)this.showInformation(this.currentScene.teachingInformation,true);
        this.verifyObjects(ids);
      }
      const { abort: _abort, pulseIds: _pulse, presentationIds: _presentations, transientReveal: _transient, ...receipt } = execution;
      this.lastReceipt = receipt;
      this.lastScene = JSON.stringify(execution.transientReveal ? scene : this.currentScene ?? scene);
      this.lastIds = [...ids];
      return receipt;
    } catch (error) {
      layer.remove(); this.clearInspection();
      this.lastReceipt = undefined;
      throw error;
    }
  }

  /** Reproject the same effects in place. Keep pulse group/Animation identity and
   * suppressed visibility; no install receipt, pulse restart, or HTTP outcome. */
  reflow(scene: VisualRenderScene): void {
    const requestedScene = scene;
    if (this.hiddenIntroductionIds.length) scene = { ...scene, glyphs: scene.glyphs.filter(g=>!this.hiddenIntroductionIds.some(id=>g.id===id||g.id.startsWith(`${id}/`))), teachingInformation: scene.focusInformation ?? [] };
    if (this.disposed || this.suppressed || !this.currentScene) return;
    const previous = this.currentScene;
    const semantic = (glyph: VisualGlyph) => {
      const { id, kind, ownerKeys, color, description } = glyph;
      return { id, kind, ownerKeys, color, description, ...(kind === "label" ? { text: glyph.text } : {}) };
    };
    if (JSON.stringify(previous.glyphs.map(semantic)) !== JSON.stringify(scene.glyphs.map(semantic))) {
      throw new VisualRenderError("identity", "layout cannot change visual ownership or content");
    }
    const groups = new Map([...this.root.querySelectorAll<SVGGElement>("[data-visual-id]")].map(group => [group.getAttribute("data-visual-id")!, group]));
    if (groups.size !== scene.glyphs.length) throw new VisualRenderError("residual", "layout has missing visual objects");
    const stage = node("g"); stage.style.visibility = "hidden"; this.root.appendChild(stage);
    const replacements = new Map<string, SVGGElement>();
    const labels: Rect[] = [];
    try {
      for (const glyph of [...scene.glyphs].sort((a, b) => a.id.localeCompare(b.id))) {
        const group = node("g"); stage.appendChild(group);
        this.draw(group, glyph, scene, labels); replacements.set(glyph.id, group);
      }
      for (const [id, group] of replacements) groups.get(id)!.replaceChildren(...group.childNodes);
      this.root.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
      this.root.style.visibility = "visible";
      this.currentScene = scene;
      if (this.lastReceipt) this.lastScene = JSON.stringify(this.hiddenIntroductionIds.length ? requestedScene : scene);
      this.installInspection(scene);
      if(scene.teachingInformation?.length) this.showInformation(scene.teachingInformation,true);
    } catch (error) {
      // Never leave a stale overlay at old coordinates over a changed board.
      this.root.style.visibility = "hidden";
      throw error;
    } finally { stage.remove(); }
  }

  reconcile(scene: VisualRenderScene, execution: VisualRenderExecution): Promise<VisualRenderReceipt> {
    if (execution.operation !== "removed" || execution.pulseIds?.length) return Promise.reject(new VisualRenderError("identity", "reconcile requires a removal receipt and no pulse"));
    return this.install(scene, execution);
  }

  suppress(ownerKey: string): void {
    if(ownerKey === "*")this.suppressed = true;
    this.clearInspection();
    if (ownerKey !== "*" && ![...this.owners.values()].some(owners => owners.length === 1 && owners.includes(ownerKey))) return;
    this.serial += 1;
    this.cancelPending?.();
    this.animation?.cancel();
    this.lastReceipt = undefined;
    for (const element of this.root.querySelectorAll<SVGElement>("[data-visual-id]")) {
      const owners = this.owners.get(element.getAttribute("data-visual-id")!);
      if (ownerKey === "*" || owners?.includes(ownerKey) && owners.length === 1) element.style.visibility = "hidden";
    }
  }

  private verifyObjects(ids: ReadonlySet<string>): void {
    const actual = [...this.root.querySelectorAll<SVGElement>("[data-visual-id]")];
    if (this.root.style.visibility === "hidden" || this.host.querySelectorAll("[data-visual-registry]").length !== 1 || actual.length !== ids.size
      || actual.some(el => !ids.has(el.getAttribute("data-visual-id")!) || el.style.visibility === "hidden")) {
      throw new VisualRenderError("residual", "visual DOM contains stale, hidden or missing objects");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.serial += 1;
    this.cancelPending?.();
    this.animation?.cancel();
    this.clearInspection();
    this.root.remove();
    this.owners.clear();
    this.lastReceipt = undefined;
  }

  setInspectionEnabled(enabled: boolean): void {
    for(const hit of this.root.querySelectorAll<SVGElement>("[data-visual-inspect-id]")) {
      hit.style.pointerEvents=enabled ? "stroke" : "none";hit.setAttribute("tabindex",enabled ? "0" : "-1");
    }
    if(!enabled) {
      this.closeInformation();
      for(const mark of this.root.querySelectorAll<SVGElement>("[data-visual-inspect-focus]"))mark.style.visibility="hidden";
    }
  }

  private closeInformation(): void {
    this.informationCard?.remove(); this.informationCard = undefined;
  }
  private clearInspection(): void {
    this.inspectionAbort?.abort(); this.inspectionAbort = undefined;
    this.closeInformation(); this.root.querySelector("[data-visual-inspection-layer]")?.remove();
  }
  private dismissInspection(): void {
    this.closeInformation();
    const teaching=this.currentScene?.teachingInformation;
    if(teaching?.length&&!this.disposed)this.showInformation(teaching,true);
  }
  private showInformation(lines: readonly string[], teaching = false): void {
    this.closeInformation();
    const card = document.createElement("div");
    card.setAttribute("data-visual-information-card", teaching ? "teaching" : "inspection");card.setAttribute("role", "tooltip");
    Object.assign(card.style,{position:"absolute",left:"8px",bottom:"8px",maxWidth:"calc(100% - 16px)",maxHeight:"calc(100% - 16px)",overflow:"auto",boxSizing:"border-box",padding:"10px 12px",background:"#fff",color:"#17202a",border:"1px solid #64748b",borderRadius:"8px",font:"14px/1.5 system-ui",zIndex:"5",pointerEvents:"auto",overflowWrap:"anywhere"});
    const visibleLines=teaching ? lines : [...(this.currentScene?.teachingInformation ?? []),...lines];
    for(const line of [...new Set(visibleLines)]) { const row=document.createElement("div");row.textContent=visualMathLabel(line);card.append(row); }
    this.host.append(card);this.informationCard=card;
    if(teaching) {
      const rect=card.getBoundingClientRect(),host=this.host.getBoundingClientRect();
      if(!this.options.measureText && (!(rect.width>0&&rect.height>0)||rect.width>host.width||rect.height>host.height||card.scrollHeight>card.clientHeight+1)) {
        this.closeInformation();throw new VisualRenderError("layout","teaching information has no readable placement");
      }
    }
    card.addEventListener("pointerleave",event=>{if(this.informationCard!==card||this.disposed)return;if(!teaching&&!(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-visual-inspect-id]")))this.dismissInspection();});
  }
  private installInspection(scene: VisualRenderScene): void {
    this.clearInspection(); if(!scene.inspectionTargets) return;
    this.root.setAttribute("role","group");
    const lifecycle=new AbortController();this.inspectionAbort=lifecycle;
    const layer=node("g",{"data-visual-inspection-layer":"true"});this.root.append(layer);
    const close=()=>this.dismissInspection();
    const open=(target:VisualInspectionTarget)=>{if(!lifecycle.signal.aborted&&!this.disposed&&this.options.inspectionEnabled?.()!==false)this.showInformation(target.descriptions);};
    for(const target of scene.inspectionTargets) {
      const hit=node("path",{"data-visual-inspect-id":target.id,"data-visual-inspect-kind":target.kind,role:"button",tabindex:"0","aria-label":target.label,fill:"none",stroke:"transparent","stroke-width":"16","vector-effect":"non-scaling-stroke"});
      const d=target.kind==="segment"&&target.points ? `M ${target.points[0].x} ${target.points[0].y} L ${target.points[1].x} ${target.points[1].y}` : target.vertex&&target.rays ? minorAngleArc(target.vertex,target.rays,22) : undefined;
      if(!d)throw new VisualRenderError("identity","inspection target lacks explicit geometry");
      hit.setAttribute("d",d);hit.style.pointerEvents="stroke";hit.style.cursor="help";hit.style.outline="none";layer.append(hit);
      const focusMark=node("path",{d,"data-visual-inspect-focus":target.id,fill:"none",stroke:"#0369a1","stroke-width":"4","vector-effect":"non-scaling-stroke"});
      focusMark.style.pointerEvents="none";focusMark.style.visibility="hidden";layer.append(focusMark);
      const emphasize=()=>{focusMark.style.visibility="visible";};
      const quiet=()=>{if(document.activeElement!==hit)focusMark.style.visibility="hidden";};
      hit.addEventListener("pointerenter",()=>{if(this.options.inspectionEnabled?.()!==false)emphasize();open(target);},{signal:lifecycle.signal});
      hit.addEventListener("focus",()=>{if(this.options.inspectionEnabled?.()!==false)emphasize();open(target);},{signal:lifecycle.signal});
      hit.addEventListener("click",()=>open(target),{signal:lifecycle.signal});
      hit.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open(target);}if(event.key==="Escape")close();},{signal:lifecycle.signal});
      hit.addEventListener("pointerleave",event=>{quiet();if(!(event.relatedTarget instanceof Node && this.informationCard?.contains(event.relatedTarget)))close();},{signal:lifecycle.signal});
      hit.addEventListener("blur",()=>{focusMark.style.visibility="hidden";close();},{signal:lifecycle.signal});
    }
    this.setInspectionEnabled(this.options.inspectionEnabled?.()!==false);
    document.addEventListener("keydown",event=>{if(event.key==="Escape")close();},{signal:lifecycle.signal});
    document.addEventListener("pointerdown",event=>{if(!(event.target instanceof Element && (event.target.closest("[data-visual-inspect-id]")||this.informationCard?.contains(event.target))))close();},{signal:lifecycle.signal});
  }

  private draw(group: SVGGElement, glyph: VisualGlyph, scene: VisualRenderScene, labels: Rect[]): void {
    const attrs = { stroke: glyph.color, "stroke-width": "3", fill: "none", "vector-effect": "non-scaling-stroke" };
    if (glyph.kind === "path") {
      if (glyph.points.length < 2 || glyph.points.some(p => !finite(p) || p.x < 0 || p.y < 0 || p.x > scene.width || p.y > scene.height)) throw new VisualRenderError("layout", "visual path is outside the viewport");
      group.appendChild(node("path", { ...attrs, d: glyph.points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") + (glyph.closed ? " Z" : "") }));
      return;
    }
    if (glyph.kind === "angle") {
      for (let i = 0; i < glyph.arcCount; i++) {
        const radius = 18 + i * 6;
        const path = minorAngleArc(glyph.vertex, glyph.rays, radius);
        const first = Math.atan2(glyph.rays[0].y - glyph.vertex.y, glyph.rays[0].x - glyph.vertex.x);
        const second = Math.atan2(glyph.rays[1].y - glyph.vertex.y, glyph.rays[1].x - glyph.vertex.x);
        const delta = (second - first + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        const r = Math.min(radius, ...glyph.rays.map(p => Math.hypot(p.x - glyph.vertex.x, p.y - glyph.vertex.y) * 0.4));
        for (let step = 0; step <= 24; step++) {
          const x = glyph.vertex.x + r * Math.cos(first + delta * step / 24);
          const y = glyph.vertex.y + r * Math.sin(first + delta * step / 24);
          if (!within({ x: x - 2, y: y - 2, width: 4, height: 4 }, scene.width, scene.height)) throw new VisualRenderError("layout", "angle arc is outside readable viewport");
        }
        group.appendChild(node("path", { ...attrs, d: path }));
      }
      return;
    }
    if (!finite(glyph.anchor) || !glyph.text.trim()) throw new VisualRenderError("layout", "label lacks an anchor or authorized text");
    const text = node("text", { fill: glyph.color, "font-size": "16", "font-family": "system-ui, sans-serif", "text-anchor": "middle", "dominant-baseline": "middle" });
    const readable = visualMathLabel(glyph.text);
    text.textContent = readable;
    group.appendChild(text);
    const candidates: [number, number][] = [[0, -18], [0, 18], [28, -18], [-28, -18], [28, 18], [-28, 18]];
    // Bounded deterministic search, including free space away from crowded
    // intersections. Every displaced label retains a leader to its own anchor.
    for (let radius = 40; radius <= Math.max(scene.width, scene.height); radius += 24) {
      for (let direction = 0; direction < 16; direction++) {
        const angle = direction * Math.PI / 8;
        candidates.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
    }
    // Break only at equality boundaries: concatenating the lines retains the
    // exact authorized expression. Never shorten ratios or shrink the font.
    const terms = readable.split(/(?==)/);
    const layouts = [[readable]];
    if (terms.length > 1) {
      const middle = Math.ceil(terms.length / 2);
      layouts.push([terms.slice(0, middle).join(""), terms.slice(middle).join("")]);
      if (terms.length > 2) layouts.push(terms);
    }
    for (const lines of layouts) {
      text.replaceChildren();
      if (lines.length === 1) text.textContent = lines[0];
      else for (const line of lines) {
        const span = node("tspan"); span.textContent = line; text.appendChild(span);
      }
    for (const [dx, dy] of candidates) {
      text.setAttribute("x", String(glyph.anchor.x + dx)); text.setAttribute("y", String(glyph.anchor.y + dy));
      [...text.children].forEach((span, index) => {
        span.setAttribute("x", String(glyph.anchor.x + dx));
        span.setAttribute("y", String(glyph.anchor.y + dy + (index - (lines.length - 1) / 2) * 20));
      });
      const rect = this.options.measureText?.(text) ?? text.getBBox();
      if (!(rect.width > 0 && rect.height > 0) || !within(rect, scene.width, scene.height) || labels.some(other => overlaps(rect, other))
        || scene.labelObstacles?.some(other => overlaps(rect, other))
        || scene.protectedSegments?.some(([a,b]) => lineCrossesLabel(a,b,rect))) continue;
      labels.push(rect);
      if (dx || Math.abs(dy) > 18) group.prepend(node("path", { ...attrs, "stroke-width": "1", d: `M ${glyph.anchor.x} ${glyph.anchor.y} L ${glyph.anchor.x + dx} ${glyph.anchor.y + dy}` }));
      return;
    }
    }
    throw new VisualRenderError("layout", `no readable placement for label ${glyph.id}`);
  }
}
