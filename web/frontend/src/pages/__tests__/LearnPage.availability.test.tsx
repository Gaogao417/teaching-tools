/**
 * F7 Step 5 返工 — LearnPage availability 四态（复核裁定）：
 * 探测失败（非 404）显式错误 + 重试，不静默回落 legacy；404（/api/vnext 未挂载）
 * = 部署级迁移关闭 → legacy 路由策略；未裁定前不启动旧 /experience。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LearnPage } from "../LearnPage";
import { TutorRuntimeHttpError } from "../../api/tutorRuntimeClient";
import type { WorkspaceOutletContext } from "../../components/layout/workspaceContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../api/tutorRuntimeClient", () => ({
  tutorRuntimeHttp: { availability: vi.fn() },
  TutorRuntimeHttpError: class extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message?: string) {
      super(message ?? code);
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock("../../api/client", () => ({
  api: {
    startLearnExperience: vi.fn().mockResolvedValue({ kind: "legacy" }),
    getLearningProjection: vi.fn().mockResolvedValue(null),
    getLearningActionPlan: vi.fn().mockResolvedValue(null),
    recordSimilarityLearnProgress: vi.fn().mockResolvedValue(undefined),
    submitLearningAction: vi.fn(),
  },
  ResponseSchemaError: class extends Error {},
}));

import { tutorRuntimeHttp } from "../../api/tutorRuntimeClient";
import { api } from "../../api/client";

const availabilityMock = tutorRuntimeHttp.availability as unknown as ReturnType<typeof vi.fn>;
const startLearnExperienceMock = api.startLearnExperience as unknown as ReturnType<typeof vi.fn>;

function outletContext(): WorkspaceOutletContext {
  return {
    tree: null,
    focusedTaskId: null,
    focusedTask: null,
    activeTaskId: null,
    studentName: "learn-page-student",
    isStudentReady: true,
    requestAuth: () => undefined,
    setFocusedTaskId: () => undefined,
    setTopNavContent: () => undefined,
    setNavigationGuard: () => undefined,
  } as unknown as WorkspaceOutletContext;
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function mount(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={["/learn/goldenMinhangFold2020"]}>
        <Routes>
          <Route path="/" element={<OutletWrapper />}>
            <Route path="learn/:taskId" element={<LearnPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  });
}

function OutletWrapper() {
  return <Outlet context={outletContext()} />;
}

async function settle(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  startLearnExperienceMock.mockResolvedValue({ kind: "legacy" });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("LearnPage runtime availability（复核裁定四态）", () => {
  it("探测失败（5xx 网络/协议）→ 显式错误面 + 重试；不启动旧 /experience、不静默回落", async () => {
    availabilityMock.mockRejectedValueOnce(new TutorRuntimeHttpError(503, "MODEL_UNAVAILABLE", "down"));
    availabilityMock.mockResolvedValueOnce({ taskId: "goldenMinhangFold2020", enabled: false, profile: "f7-tutor-runtime-http/v1" });
    mount();
    await settle();
    expect(container!.querySelector('[data-testid="runtime-availability-error"]')).not.toBeNull();
    expect(startLearnExperienceMock).not.toHaveBeenCalled();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="runtime-availability-retry"]')!.click();
      await Promise.resolve();
    });
    await settle();
    // 重试后 availability 明确 enabled=false → 依 route policy 进 legacy。
    expect(container!.querySelector('[data-testid="runtime-availability-error"]')).toBeNull();
    expect(startLearnExperienceMock).toHaveBeenCalledWith("goldenMinhangFold2020", expect.anything());
  });

  it("404（/api/vnext 未挂载）= 部署级迁移关闭 → 直接 legacy 路由策略（非错误）", async () => {
    availabilityMock.mockRejectedValue(new TutorRuntimeHttpError(404, "HTTP_ERROR", "not mounted"));
    mount();
    await settle();
    expect(container!.querySelector('[data-testid="runtime-availability-error"]')).toBeNull();
    expect(startLearnExperienceMock).toHaveBeenCalledWith("goldenMinhangFold2020", expect.anything());
  });

  it("未裁定（pending）前不启动旧 /experience——避免双会话竞态", async () => {
    let releaseAvailability: ((value: { taskId: string; enabled: boolean; profile: string }) => void) | undefined;
    availabilityMock.mockReturnValue(new Promise((resolve) => { releaseAvailability = resolve; }));
    mount();
    await settle();
    expect(startLearnExperienceMock).not.toHaveBeenCalled();
    await act(async () => {
      releaseAvailability?.({ taskId: "goldenMinhangFold2020", enabled: false, profile: "f7-tutor-runtime-http/v1" });
      await Promise.resolve();
    });
    await settle();
    expect(startLearnExperienceMock).toHaveBeenCalled();
  });
});
