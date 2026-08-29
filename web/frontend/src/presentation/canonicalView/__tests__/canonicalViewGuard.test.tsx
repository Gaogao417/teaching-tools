/**
 * fe-prep（2026-08-28）：负例夹具驱动的渲染层防御断言（ledger C2）+
 * canonical 消费面源码扫描（ledger C1）。
 *
 * 四条 view/v1 负例（truth-leak / slice-revision / untyped-mainline /
 * unknown-kind）必须在渲染层被拒绝：fail-closed parse → region-error，
 * 且**泄漏键与泄漏文本在 DOM 中零出现**（错误面不回显 payload 派生内容）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanonicalViewGuard } from "../CanonicalViewGuard";
import { parseCoachPanelView, parseMainlineParticipation, parseStudentWorkspaceView } from "../parseCanonicalView";
import { checkProjectionRevisionConsistency } from "../projectionRevisionConsistency";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixtureModules = {
  ...import.meta.glob("../../../../../shared/canonical/fixtures/student-workspace-view.*.json", { eager: true, import: "default" }),
  ...import.meta.glob("../../../../../shared/canonical/fixtures/coach-panel-view.*.json", { eager: true, import: "default" }),
  ...import.meta.glob("../../../../../shared/canonical/fixtures/mainline-participation.*.json", { eager: true, import: "default" }),
} as Record<string, unknown>;

function fixture(name: string): unknown {
  const entry = Object.entries(fixtureModules).find(([key]) => key.endsWith(`/${name}.json`));
  if (!entry) throw new Error(`fixture not loaded: ${name}`);
  return structuredClone(entry[1]);
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: React.ReactNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  act(() => created.render(node));
  return container;
}

afterEach(() => {
  const currentRoot = root;
  if (currentRoot) act(() => currentRoot.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

describe("negative fixtures are rejected at the render layer (fail-closed)", () => {
  it("student-workspace-view.negative.truth-leak: rejected, leaked answer key/text never rendered", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = parseStudentWorkspaceView(fixture("student-workspace-view.negative.truth-leak"));
    expect(result.ok).toBe(false);
    const host = render(
      <CanonicalViewGuard scope="student-workspace-view" result={result}>
        {(view) => <p>不应渲染：{String((view as unknown as { revision: number }).revision)}</p>}
      </CanonicalViewGuard>,
    );
    const errorRegion = host.querySelector('[data-testid="region-error"]')!;
    expect(errorRegion.getAttribute("role")).toBe("alert");
    expect(errorRegion.getAttribute("data-guard-scope")).toBe("student-workspace-view");
    expect(host.innerHTML).not.toContain("canonical_answer");
    expect(host.innerHTML).not.toContain("EF = 4");
    expect(host.textContent).not.toContain("不应渲染");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("student-workspace-view.negative.slice-revision: per-slice revision rejected (single workspace revision only)", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = parseStudentWorkspaceView(fixture("student-workspace-view.negative.slice-revision"));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.some((issue) => issue.startsWith("canvas") && issue.includes("revision"))).toBe(true);
    const host = render(
      <CanonicalViewGuard scope="student-workspace-view" result={result}>
        {() => <p>不应渲染</p>}
      </CanonicalViewGuard>,
    );
    expect(host.querySelector('[data-testid="region-error"]')).toBeTruthy();
    expect(host.textContent).not.toContain("不应渲染");
  });

  it("coach-panel-view.negative.untyped-mainline: generic_chat mainline rejected (typed coach states only)", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = parseCoachPanelView(fixture("coach-panel-view.negative.untyped-mainline"));
    expect(result.ok).toBe(false);
    const host = render(
      <CanonicalViewGuard scope="coach-panel-view" result={result}>
        {() => <p>不应渲染</p>}
      </CanonicalViewGuard>,
    );
    expect(host.querySelector('[data-testid="region-error"]')!.getAttribute("data-guard-scope")).toBe("coach-panel-view");
    expect(host.innerHTML).not.toContain("generic_chat");
    expect(host.textContent).not.toContain("不应渲染");
  });

  it("mainline-participation.negative.unknown-kind: unknown participation kind rejected", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = parseMainlineParticipation(fixture("mainline-participation.negative.unknown-kind"));
    expect(result.ok).toBe(false);
    const host = render(
      <CanonicalViewGuard scope="mainline-participation" result={result}>
        {() => <p>不应渲染</p>}
      </CanonicalViewGuard>,
    );
    expect(host.querySelector('[data-testid="region-error"]')!.getAttribute("data-guard-scope")).toBe("mainline-participation");
    expect(host.innerHTML).not.toContain('"chat"');
  });

  it("positive fixtures pass through the guard and render children", () => {
    const result = parseStudentWorkspaceView(fixture("student-workspace-view.positive"));
    expect(result.ok).toBe(true);
    const host = render(
      <CanonicalViewGuard scope="student-workspace-view" result={result}>
        {(view) => <p data-testid="guarded-child">revision {view.revision}</p>}
      </CanonicalViewGuard>,
    );
    expect(host.querySelector('[data-testid="guarded-child"]')!.textContent).toBe("revision 6");
    expect(host.querySelector('[data-testid="region-error"]')).toBeNull();
  });
});

describe("projection consistency (ADR-010 invariant 4: session_id + revision 双键)", () => {
  it("returns true only when both session_id and revision match; null when a side is absent", () => {
    expect(checkProjectionRevisionConsistency({ session_id: "TS-4242", revision: 6 }, { session_id: "TS-4242", revision: 6 })).toBe(true);
    // 同 session、revision 不同 → mismatch
    expect(checkProjectionRevisionConsistency({ session_id: "TS-4242", revision: 6 }, { session_id: "TS-4242", revision: 7 })).toBe(false);
    // 2026-08-29 复验 P2：相同 revision、不同 session_id 也必须判 mismatch（不得只比 revision）
    expect(checkProjectionRevisionConsistency({ session_id: "TS-4242", revision: 6 }, { session_id: "TS-9999", revision: 6 })).toBe(false);
    expect(checkProjectionRevisionConsistency(null, { session_id: "TS-4242", revision: 6 })).toBeNull();
    expect(checkProjectionRevisionConsistency({ session_id: "TS-4242", revision: 6 }, null)).toBeNull();
    expect(checkProjectionRevisionConsistency(null, null)).toBeNull();
  });
});

describe("canonical consumption surface source scan (ledger C1)", () => {
  const sourceModules = {
    ...import.meta.glob("../*.ts", { eager: true, query: "?raw", import: "default" }),
    ...import.meta.glob("../*.tsx", { eager: true, query: "?raw", import: "default" }),
    ...import.meta.glob("../../../pages/dev/*.tsx", { eager: true, query: "?raw", import: "default" }),
  } as Record<string, string>;

  it("canonicalView + harness page consume only canonical schemas (no legacy handwritten View types/keys)", () => {
    const forbiddenModules = [
      "shared/studentWorkspace",
      "shared/tutorExperience",
      "action-runtime/types",
      "projectWorkspaceView",
    ];
    const forbiddenMarkers = ["pending_workspace", "demonstration", "boardReview"];
    const files = Object.entries(sourceModules);
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const [file, source] of files) {
      const importSpecifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]);
      for (const marker of forbiddenModules) {
        expect(
          importSpecifiers.some((specifier) => specifier.includes(marker)),
          `${file} 不得 import legacy View 消费面 ${marker}`,
        ).toBe(false);
      }
      for (const marker of forbiddenMarkers) {
        expect(source.includes(marker), `${file} 不得出现 legacy 键 ${marker}`).toBe(false);
      }
    }
  });

  it("canonicalView types derive from the canonical zod mirror only", () => {
    const typesSource = sourceModules[Object.keys(sourceModules).find((key) => key.endsWith("canonicalViewTypes.ts"))!];
    expect(typesSource).toContain("shared/canonical/schemas");
    expect(typesSource).toContain("z.infer");
  });
});
