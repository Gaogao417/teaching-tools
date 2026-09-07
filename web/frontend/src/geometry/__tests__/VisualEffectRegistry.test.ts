import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualEffectRegistry, minorAngleArc } from "../react/VisualEffectRegistry";
import type { VisualRenderExecution, VisualRenderScene } from "../react/visualRenderTypes";

const mounted: { host: HTMLElement; registry: VisualEffectRegistry }[] = [];
function mount(reduced = true) {
  const host = document.createElement("div"); document.body.appendChild(host);
  const registry = new VisualEffectRegistry(host, { surfaceGeneration: 1, reducedMotion: () => reduced,
    measureText: el => ({ x: Number(el.getAttribute("x")) - 30, y: Number(el.getAttribute("y")) - 9, width: 60, height: 18 }) });
  mounted.push({ host, registry }); return { host, registry };
}
const execution = (patch: Partial<VisualRenderExecution> = {}): VisualRenderExecution => ({ sessionId: "s", executionKey: "action-1", visualRevision: 1,
  targetDigest: "digest", surfaceGeneration: 1, operation: "installed", abort: new AbortController().signal, ...patch });
const scene = (): VisualRenderScene => ({ width: 300, height: 300, glyphs: [
  { id: "ab", ownerKeys: ["main"], color: "#123456", description: "AB对应CD", kind: "path", points: [{ x: 50, y: 50 }, { x: 150, y: 50 }] },
  { id: "cd", ownerKeys: ["main"], color: "#123456", description: "CD对应AB", kind: "path", points: [{ x: 50, y: 100 }, { x: 250, y: 100 }] },
] });
afterEach(() => { for (const item of mounted.splice(0)) { item.registry.dispose(); item.host.remove(); } vi.unstubAllGlobals(); });

describe("renderer owned visual lifetime", () => {
  it("keeps unequal corresponding sides visible after action completion without equality ticks", async () => {
    const { host, registry } = mount();
    await registry.install(scene(), execution({ operation: "entrance-complete", pulseIds: ["ab", "cd"] }));
    expect(host.querySelectorAll("[data-visual-id]")).toHaveLength(2);
    expect([...host.querySelectorAll("path")].map(p => p.getAttribute("stroke"))).toEqual(["#123456", "#123456"]);
    expect(host.querySelectorAll("path")).toHaveLength(2);
  });
  it("waits for one real animation shared by both sides; same-key ack retry never replays", async () => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const animate = vi.fn(() => ({ finished, cancel: vi.fn() }));
    const previous = SVGElement.prototype.animate;
    SVGElement.prototype.animate = animate as never;
    try {
      const { registry } = mount(false); const id = execution({ operation: "entrance-complete", pulseIds: ["ab", "cd"] });
      const done = vi.fn(); const waiting = registry.install(scene(), id).then(done);
      await Promise.resolve(); expect(done).not.toHaveBeenCalled(); expect(animate).toHaveBeenCalledTimes(1);
      finish(); await waiting;
      await registry.install(scene(), id); expect(animate).toHaveBeenCalledTimes(1);
    } finally { SVGElement.prototype.animate = previous; }
  });
  it("pulse in progress reflows, then same-key retry uses final layout without replay", async () => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => finish = resolve);
    const animate = vi.fn(() => ({ finished, cancel: vi.fn() }));
    const previous = SVGElement.prototype.animate;
    SVGElement.prototype.animate = animate as never;
    try {
      const { host, registry } = mount(false);
      const identity = execution({ operation: "entrance-complete", pulseIds: ["ab", "cd"] });
      const running = registry.install(scene(), identity);
      const pulse = host.querySelector("[data-visual-pulse]");
      const zoomed = scene();
      zoomed.glyphs.forEach(glyph => { if (glyph.kind === "path") glyph.points = glyph.points.map(p => ({ x: p.x * 0.8 + 10, y: p.y * 0.8 + 10 })); });
      registry.reflow(zoomed);
      expect(host.querySelector("[data-visual-pulse]")).toBe(pulse);
      expect(host.querySelector('[data-visual-id="ab"] path')?.getAttribute("d")).toBe("M 50 50 L 130 50");
      finish(); const receipt = await running;
      await expect(registry.install(zoomed, identity)).resolves.toEqual(receipt);
      expect(animate).toHaveBeenCalledTimes(1);
    } finally { SVGElement.prototype.animate = previous; }
  });
  it("abort never produces a successful entrance receipt", async () => {
    const previous = SVGElement.prototype.animate;
    SVGElement.prototype.animate = (() => ({ finished: new Promise(() => undefined), cancel: vi.fn() })) as never;
    try {
      const { registry } = mount(false); const abort = new AbortController();
      const waiting = registry.install(scene(), execution({ abort: abort.signal, operation: "entrance-complete", pulseIds: ["ab", "cd"] }));
      abort.abort(); await expect(waiting).rejects.toMatchObject({ kind: "aborted" });
    } finally { SVGElement.prototype.animate = previous; }
  });
  it("reconcile removes stale objects but preserves the target scene and ignores superseded surfaces", async () => {
    const { host, registry } = mount(); await registry.install(scene(), execution());
    const target = { ...scene(), glyphs: scene().glyphs.slice(0, 1) };
    await registry.reconcile(target, execution({ executionKey: "cleanup", operation: "removed", visualRevision: 2 }));
    expect(host.querySelectorAll("[data-visual-id]")).toHaveLength(1);
    expect(host.querySelector('[data-visual-id="ab"]')).not.toBeNull();
    await expect(registry.install(target, execution({ surfaceGeneration: 2 }))).rejects.toMatchObject({ kind: "stale-surface" });
  });
  it("does not suppress another projected owner sharing the same annotation", async () => {
    const { host, registry } = mount(); const target = scene();
    target.glyphs[0].ownerKeys = ["main", "inquiry"];
    await registry.install(target, execution()); registry.suppress("inquiry");
    expect(host.querySelector<SVGElement>('[data-visual-id="ab"]')!.style.visibility).not.toBe("hidden");
  });
  it("keeps mandatory length text off point names and base lines rather than accepting viewport-only placement", async () => {
    const { host, registry } = mount();
    const target: VisualRenderScene = { width: 300, height: 300,
      glyphs: [{ id: "length", ownerKeys: ["main"], color: "blue", description: "OE length", kind: "label", anchor: { x: 150, y: 150 }, text: "$OE=\\frac{4}{5}$" }],
      labelObstacles: [{ x: 120, y: 123, width: 60, height: 18 }],
      protectedSegments: [[{ x: 0, y: 168 }, { x: 300, y: 168 }]],
    };
    await registry.install(target, execution());
    const label = host.querySelector("text")!;
    expect(label.textContent).toBe("OE=4/5");
    const x = Number(label.getAttribute("x")), y = Number(label.getAttribute("y"));
    const pointName = target.labelObstacles![0];
    expect(x+30 <= pointName.x || x-30 >= pointName.x+pointName.width || y+9 <= pointName.y || y-9 >= pointName.y+pointName.height).toBe(true);
    expect(y+9 < 168 || y-9 > 168).toBe(true);
    expect(host.querySelectorAll("text")).toHaveLength(1);
  });
  it("rejects unreadable labels rather than silently omitting a required mark", async () => {
    const { registry } = mount();
    await expect(registry.install({ width: 20, height: 20, glyphs: [{ id: "label", ownerKeys: ["main"], color: "black", description: "比例", kind: "label", anchor: { x: 10, y: 10 }, text: "2:3" }] }, execution())).rejects.toMatchObject({ kind: "layout" });
  });
  it("uses the minor sector with a fixed pixel radius and rejects degenerate angles without inventing degree labels", () => {
    expect(minorAngleArc({ x: 100, y: 100 }, [{ x: 200, y: 100 }, { x: 100, y: 200 }], 18)).toContain("A 18 18 0 0 1");
    expect(() => minorAngleArc({ x: 0, y: 0 }, [{ x: -1, y: 0 }, { x: 1, y: 0 }], 18)).toThrow(/degenerate/);
  });
});
