/**
 * fe-prep（2026-08-28）：fixtures 驱动 harness 页的组件级断言（browser
 * harness 的 jsdom 侧对应面；Playwright spec 覆盖真实浏览器路径）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanonicalViewHarnessPage } from "../../../pages/dev/CanonicalViewHarnessPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderAt(path: string): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <CanonicalViewHarnessPage />
      </MemoryRouter>,
    ),
  );
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

describe("canonical view harness page", () => {
  it("composes the six ADR-009 regions from positive fixtures at one revision", () => {
    const host = renderAt("/?workspace=student-workspace-view.positive&coach=coach-panel-view.positive");
    // 六区域稳定命名（ADR-009 布局不变量 1）
    for (const region of ["region-question", "region-tutor", "region-geometry", "region-solution-board", "region-participation", "region-status"]) {
      expect(host.querySelector(`[data-testid="${region}"]`), region).toBeTruthy();
    }
    // 同 revision 投影可见（ADR-010 不变量 4）
    const workspace = host.querySelector('[data-testid="canonical-student-workspace"]')!;
    const coach = host.querySelector('[data-testid="canonical-coach-panel"]')!;
    expect(workspace.getAttribute("data-view-revision")).toBe("6");
    expect(coach.getAttribute("data-view-revision")).toBe("6");
    // workspace 正例的内嵌 participation 自动进入参与区
    const participation = host.querySelector('[data-testid="region-participation"]')!;
    expect(participation.getAttribute("data-participation-kind")).toBe("workspace_input");
    expect(participation.getAttribute("data-gate-id")).toBe("GT-01");
    expect(host.querySelector('[data-testid="region-error"]')).toBeNull();
  });

  it("rejects the truth-leak fixture at the render layer with zero payload echo", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = renderAt("/?workspace=student-workspace-view.negative.truth-leak");
    const errorRegion = host.querySelector('[data-testid="region-error"]')!;
    expect(errorRegion.getAttribute("data-guard-scope")).toBe("student-workspace-view");
    expect(document.body.innerHTML).not.toContain("canonical_answer");
    expect(document.body.innerHTML).not.toContain("EF = 4");
    expect(host.querySelector('[data-testid="canonical-student-workspace"]')).toBeNull();
  });

  it("renders the standalone paused-for-inquiry participation fixture with its return point", () => {
    const host = renderAt("/?participation=mainline-participation.positive");
    const participation = host.querySelector('[data-testid="region-participation"]')!;
    expect(participation.getAttribute("data-participation-kind")).toBe("temporarily_paused_for_inquiry");
    expect(participation.getAttribute("data-return-checkpoint-id")).toBe("BT-03");
    expect(participation.textContent).toContain("返回主线检查点 BT-03");
  });

  it("rejects the unknown-kind participation fixture at the render layer", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = renderAt("/?participation=mainline-participation.negative.unknown-kind");
    expect(host.querySelector('[data-testid="region-error"]')!.getAttribute("data-guard-scope")).toBe("mainline-participation");
    expect(host.querySelector('[data-testid="region-participation"]')).toBeNull();
  });

  it("fails closed on an unknown fixture name instead of inventing a view", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = renderAt("/?workspace=does-not-exist");
    expect(host.querySelector('[data-testid="region-error"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="canonical-student-workspace"]')).toBeNull();
  });
});

/**
 * 2026-08-29 复验 P2 复现/补测：projection mismatch 必须 fail-closed。
 *
 * canonical fixtures 全部同 session（TS-4242）同 revision（6），真实输入
 * 无法触发 mismatch——这里以 vi.doMock 由 coach 正例派生 schema-valid 变体
 *（仅改 session_id 或 revision；`web/shared` fixtures 零改动），
 * resetModules 后重导 harness 页使 import.meta.glob 重新求值吃到变体。
 */
async function renderAtWithMutatedCoachFixture(
  path: string,
  mutate: (coach: Record<string, unknown>) => Record<string, unknown>,
): Promise<HTMLDivElement> {
  const coachFixturePath = "../../../../../shared/canonical/fixtures/coach-panel-view.positive.json";
  vi.resetModules();
  vi.doMock(coachFixturePath, async (importOriginal) => {
    const actual = await importOriginal<{ default: Record<string, unknown> }>();
    return { default: structuredClone(mutate(actual.default)) };
  });
  try {
    const [{ CanonicalViewHarnessPage: FreshPage }, { MemoryRouter: FreshMemoryRouter }] = await Promise.all([
      import("../../../pages/dev/CanonicalViewHarnessPage"),
      import("react-router-dom"),
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    const created = createRoot(container);
    root = created;
    act(() =>
      created.render(
        <FreshMemoryRouter initialEntries={[path]}>
          <FreshPage />
        </FreshMemoryRouter>,
      ),
    );
    return container;
  } finally {
    vi.doUnmock(coachFixturePath);
  }
}

describe("projection mismatch fails closed (2026-08-29 复验 P2)", () => {
  it("same-session revision mismatch renders the error region and NEITHER surface", async () => {
    const host = await renderAtWithMutatedCoachFixture(
      "/?workspace=student-workspace-view.positive&coach=coach-panel-view.positive",
      (coach) => ({ ...coach, revision: coach.revision as number + 1 }),
    );
    // fail closed：两个 surface 均不得渲染（修复前：仍渲染 Workspace + Coach）
    expect(host.querySelector('[data-testid="canonical-student-workspace"]')).toBeNull();
    expect(host.querySelector('[data-testid="canonical-coach-panel"]')).toBeNull();
    const errorRegion = host.querySelector('[data-testid="region-error"]')!;
    expect(errorRegion).toBeTruthy();
    expect(errorRegion.getAttribute("role")).toBe("alert");
    expect(errorRegion.getAttribute("data-guard-scope")).toBe("projection-consistency");
  });

  it("same revision but different session_id is judged a mismatch and fails closed too", async () => {
    const host = await renderAtWithMutatedCoachFixture(
      "/?workspace=student-workspace-view.positive&coach=coach-panel-view.positive",
      (coach) => ({ ...coach, session_id: "TS-9999" }),
    );
    // 修复前：一致性检查只比 revision → 判一致 → 无 error、照常渲染
    expect(host.querySelector('[data-testid="region-error"]')!.getAttribute("data-guard-scope")).toBe("projection-consistency");
    expect(host.querySelector('[data-testid="canonical-student-workspace"]')).toBeNull();
    expect(host.querySelector('[data-testid="canonical-coach-panel"]')).toBeNull();
  });

  it("healthy flow is unchanged: same session_id + same revision still composes both surfaces", async () => {
    const host = await renderAtWithMutatedCoachFixture(
      "/?workspace=student-workspace-view.positive&coach=coach-panel-view.positive",
      (coach) => coach,
    );
    expect(host.querySelector('[data-testid="region-error"]')).toBeNull();
    expect(host.querySelector('[data-testid="canonical-student-workspace"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="canonical-coach-panel"]')).toBeTruthy();
  });
});
