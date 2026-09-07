/** Controlled layout/JSXGraph boundary test, not a browser pixel assertion. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeometryModel } from "../domain/model";
const native = vi.hoisted(() => ({ initBoard: vi.fn(), freeBoard: vi.fn(), resizeContainer: vi.fn(), setBoundingBox: vi.fn(), fullUpdate: vi.fn() }));
vi.mock("jsxgraph", () => ({ default: { JSXGraph: { initBoard: native.initBoard, freeBoard: native.freeBoard } } }));
import { mountGeometryBoard, fitBBoxToViewport, resolveCanvasEmphasis } from "../react/jsxgraph-board";
let notify: () => void;
const disconnect = vi.fn(), observe = vi.fn();
let handles: ReturnType<typeof mountGeometryBoard> | undefined;
let host: HTMLDivElement, width = 0, height = 0;
const model = new GeometryModel({
  points: [{ id: "A", x: 0, y: 3 }, { id: "B", x: -3, y: 0 }, { id: "C", x: 3, y: 0 }, { id: "E", x: 1, y: -1 }],
  lines: [{ id: "AB", kind: "segment", from: "A", to: "B" }],
});
function mount() { handles = mountGeometryBoard(host, model, { getEntities: () => ({}), onHit: vi.fn(), onMiss: vi.fn(), onPointerMove: vi.fn() }); }
beforeEach(() => {
  vi.clearAllMocks(); width = 0; height = 0;
  native.initBoard.mockReturnValue({ on: vi.fn(), resizeContainer: native.resizeContainer, setBoundingBox: native.setBoundingBox, fullUpdate: native.fullUpdate });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notify = callback; }
    observe = observe; disconnect = disconnect;
  });
  host = document.createElement("div"); document.body.appendChild(host);
  Object.defineProperties(host, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
  host.getBoundingClientRect = () => ({ width: width * 2, height: height * 2 }) as DOMRect;
});
afterEach(() => { handles?.destroy(); handles = undefined; host.remove(); vi.unstubAllGlobals(); });
describe("JSXGraph responsive model viewport", () => {
  it("renders the mathematical label O while preserving canonical pt-O in the geometry DOM identity", () => {
    const pointNode = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const create = vi.fn(() => ({ rendNode: pointNode }));
    native.initBoard.mockReturnValue({
      on: vi.fn(), resizeContainer: native.resizeContainer,
      setBoundingBox: native.setBoundingBox, fullUpdate: native.fullUpdate,
      suspendUpdate: vi.fn(), unsuspendUpdate: vi.fn(), create,
    });
    const construction = new GeometryModel({ points: [{ id: "pt-O", x: 1, y: 2 }], lines: [] });
    handles = mountGeometryBoard(host, construction, {
      getEntities: () => ({}), onHit: vi.fn(), onMiss: vi.fn(), onPointerMove: vi.fn(),
    });
    handles.render();
    expect(create).toHaveBeenCalledExactlyOnceWith("point", [1, 2], expect.objectContaining({ name: "O" }));
    expect(pointNode.getAttribute("data-geometry-id")).toBe("pt-O");
    expect(construction.pointsList()[0].id).toBe("pt-O");
  });

  it("recovers zero-size mounting when grid allocates space, without double-counting CSS transforms", () => {
    mount(); expect(observe).toHaveBeenCalledWith(host);
    expect(native.resizeContainer).not.toHaveBeenCalled();
    width = 620; height = 350; notify();
    expect(native.resizeContainer).toHaveBeenCalledWith(620, 350, true, true);
    expect(native.setBoundingBox).toHaveBeenCalledWith(fitBBoxToViewport(model.boundingBox(0), 620, 350), false);
    expect(native.resizeContainer.mock.invocationCallOrder[0]).toBeLessThan(native.setBoundingBox.mock.invocationCallOrder[0]);
    expect(native.fullUpdate).toHaveBeenCalledOnce();
    expect(host.style.width).toBe(""); expect(host.style.height).toBe("");
    notify(); expect(native.fullUpdate).toHaveBeenCalledOnce();
  });
  it("narrow/wide and hide/show always refit the model, not the expanded previous box; late callbacks are inert", () => {
    width = 620; height = 350; mount();
    width = 180; height = 480; notify();
    width = 900; height = 230; notify();
    width = 0; height = 0; notify();
    expect(native.setBoundingBox).toHaveBeenCalledTimes(3);
    width = 900; height = 230; notify();
    expect(native.setBoundingBox.mock.calls).toEqual([[620, 350], [180, 480], [900, 230], [900, 230]].map(([w, h]) => [fitBBoxToViewport(model.boundingBox(0), w, h), false]));
    expect(native.initBoard.mock.calls[0][1].resize.enabled).toBe(false);
    handles!.destroy(); handles = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
    width = 700; notify(); expect(native.fullUpdate).toHaveBeenCalledTimes(4);
    expect(native.freeBoard).toHaveBeenCalledOnce();
  });
  it("fits positive initial dimensions and cleans up window-resize fallback", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    width = 480; height = 320; mount();
    expect(native.resizeContainer).toHaveBeenLastCalledWith(480, 320, true, true);
    expect(native.initBoard.mock.calls[0][1]).toMatchObject({
      boundingbox: fitBBoxToViewport(model.boundingBox(0), 480, 320), keepaspectratio: false,
    });
    width = 300; window.dispatchEvent(new Event("resize"));
    expect(native.resizeContainer).toHaveBeenLastCalledWith(300, 320, true, true);
    handles!.destroy(); handles = undefined;
    width = 600; window.dispatchEvent(new Event("resize"));
    expect(native.resizeContainer).toHaveBeenCalledTimes(2);
  });
});

describe("contain fit preserves geometry", () => {
  it.each([[178, 600], [600, 178], [320, 320], [80, 900]])("all points and pairwise distances fit %i×%i without stretching", (w, h) => {
    const box = fitBBoxToViewport(model.boundingBox(0), w, h, 24);
    const scaleX = w / (box[2] - box[0]), scaleY = h / (box[1] - box[3]);
    expect(scaleX).toBeCloseTo(scaleY, 12);
    const points = model.pointsList();
    const projected = points.map(p => ({ x: (p.x - box[0]) * scaleX, y: (box[1] - p.y) * scaleY }));
    const margin = Math.min(24, Math.min(w, h) / 4);
    for (const p of projected) {
      expect(p.x).toBeGreaterThanOrEqual(margin - 1e-9); expect(p.x).toBeLessThanOrEqual(w - margin + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(margin - 1e-9); expect(p.y).toBeLessThanOrEqual(h - margin + 1e-9);
    }
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const worldDistance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      const screenDistance = Math.hypot(projected[i].x - projected[j].x, projected[i].y - projected[j].y);
      expect(screenDistance / worldDistance).toBeCloseTo(scaleX, 10);
    }
  });

  it("reproduces the installed JSXGraph true-flag crop at 178×600; expanded false-flag viewport contains every point", async () => {
    const actual = await vi.importActual<{ default: typeof import("jsxgraph") }>("jsxgraph");
    width = 178; height = 600;
    const board = {
      containerObj: host, document, unitX: 1, unitY: 1, keepaspectratio: true,
      maxboundingbox: [-Infinity, Infinity, Infinity, -Infinity], attr: { zoomx: 1, zoomy: 1 },
      zoomX: 1, zoomY: 1, origin: [0, 0],
      moveOrigin(x: number, y: number) { this.origin = [x, y]; return this; },
    };
    const apply = (box: [number, number, number, number], keep: boolean) =>
      actual.default.Board.prototype.setBoundingBox.call(board as never, box, keep);
    const projected = () => model.pointsList().map(p => ({ x: board.origin[0] + p.x * board.unitX, y: board.origin[1] - p.y * board.unitY }));
    apply(model.boundingBox(0), true);
    expect(projected().some(p => p.x < 0 || p.x > width || p.y < 0 || p.y > height)).toBe(true);
    apply(fitBBoxToViewport(model.boundingBox(0), width, height), false);
    expect(board.unitX).toBeCloseTo(board.unitY, 12);
    for (const p of projected()) {
      expect(p.x).toBeGreaterThanOrEqual(24 - 1e-9); expect(p.x).toBeLessThanOrEqual(width - 24 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(24 - 1e-9); expect(p.y).toBeLessThanOrEqual(height - 24 + 1e-9);
    }
  });

  it("handles point/collinear bounds and rejects invalid dimensions", () => {
    for (const box of [[2, 2, 2, 2], [-3, 0, 3, 0]] as [number, number, number, number][]) {
      const fitted = fitBBoxToViewport(box, 178, 600);
      expect(fitted.every(Number.isFinite)).toBe(true);
      expect(178 / (fitted[2] - fitted[0])).toBeCloseTo(600 / (fitted[1] - fitted[3]), 10);
    }
    expect(() => fitBBoxToViewport(model.boundingBox(0), 0, 600)).toThrow();
  });
});


describe("explicit teaching marks preserve mathematical meaning", () => {
  it("pairs unequal sides with the same color, without equality ticks or automatic pulses; renders only supplied shares", () => {
    const create = vi.fn((_type: string, _parents: unknown[], _attrs: Record<string, unknown>) => ({
      rendNode: document.createElementNS("http://www.w3.org/2000/svg", "path"),
    }));
    native.initBoard.mockReturnValue({ on: vi.fn(), resizeContainer: native.resizeContainer,
      setBoundingBox: native.setBoundingBox, fullUpdate: native.fullUpdate,
      suspendUpdate: vi.fn(), unsuspendUpdate: vi.fn(), create });
    const marked = new GeometryModel({
      points: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 2, y: 0 }, { id: "C", x: 0, y: 3 }],
      lines: [{ id: "AB", kind: "segment", from: "A", to: "B" }, { id: "AC", kind: "segment", from: "A", to: "C" }],
      teachingMarks: [
        { id: "pair", kind: "correspondence", segmentIds: ["AB", "AC"], tickCount: 2 },
        { id: "shareAB", kind: "segment-label", segmentId: "AB", valueLatex: "2", labelKind: "share" },
        { id: "shareAC", kind: "segment-label", segmentId: "AC", valueLatex: "3", labelKind: "share" },
      ],
    });
    let emphasis: { key: string; entityIds: string[]; markIds: string[] } | undefined;
    handles = mountGeometryBoard(host, marked, { getEntities: () => ({}), getEmphasis: () => emphasis,
      onHit: vi.fn(), onMiss: vi.fn(), onPointerMove: vi.fn() });
    handles.render();
    const lines = () => create.mock.calls.filter(call => call[0] === "line");
    expect(lines()).toHaveLength(2);
    expect(lines()[0][2].strokeColor).toBe(lines()[1][2].strokeColor);
    expect(lines().every(call => !call[2].cssClass)).toBe(true);
    expect(create.mock.calls.filter(call => call[0] === "segment")).toHaveLength(0);
    expect(create.mock.calls.filter(call => call[0] === "text").map(call => call[1][2])).toEqual(["2 份", "3 份"]);
    emphasis = { key: "explicit-action-1", entityIds: [], markIds: ["pair"] };
    create.mockClear(); handles.render();
    expect(lines().every(call => call[2].cssClass === "geometry-emphasis-pulse")).toBe(true);
    create.mockClear(); handles.render();
    expect(lines().every(call => !call[2].cssClass)).toBe(true);
  });

  it("correspondence pulse addresses both sides only for a new explicit key", () => {
    const teachingMarks = [{ id: "pair", kind: "correspondence", segmentIds: ["AB", "CD"] }];
    const emphasis = { key: "action-1", entityIds: [], markIds: ["pair"] };
    expect([...resolveCanvasEmphasis({ teachingMarks, emphasis }).pulseEntities]).toEqual(["AB", "CD"]);
    expect(resolveCanvasEmphasis({ teachingMarks, emphasis, lastKey: emphasis.key }).pulseEntities.size).toBe(0);
    expect(resolveCanvasEmphasis({ teachingMarks }).pulseEntities.size).toBe(0);
  });
});
