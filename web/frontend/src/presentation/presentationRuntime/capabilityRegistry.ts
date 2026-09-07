/**
 * F7 Step 6：前端执行支持注册表（ledger 增补 20 偏差 2）。
 *
 * `kind + surface + capability` 三元组命中才可执行；未命中 →
 * capability_unsupported fail closed（不进 canonical schema，golden 键按
 * TutorPresenterV6 实测冻结；capability 语义合法性的 session-pinned 校验在
 * 服务端，本表只裁「前端是否支持执行」）。新增键：先在合同/服务端成立，
 * 再于此登记对应 adapter。
 */
import type { PendingPresentationDelivery, PresentationToolAdapter } from "./types";

/** 当前受支持的三元组（测试与文档对齐用；真实判定在 adapter.supports）。
 *  F7 P2：board.explain 按B 的 generation/v1 presentation-tool-spec 目录登记
 *  （tool_id=board.explain；plan/v4 线上形状 capability="board.explain"）。
 *  F7 P3：geometry.emphasize 按目录冻结条目登记（A' 轨 adapter；服务端
 *  capability 注册/投影归 B 轨——此前完成，见 workspaceSurfaceAdapters）。 */
export const SUPPORTED_PRESENTATION_CAPABILITIES: readonly string[] = [
  "voice",
  "geometry:geometry.construct",
  "geometry:geometry.emphasize",
  "solution_board:board.reveal-entry",
  "solution_board:board.explain",
];

export interface CapabilityRegistry {
  resolve(action: PendingPresentationDelivery["action"]): PresentationToolAdapter | undefined;
  /** 诊断：某动作命中的注册键（未命中返回 undefined）。 */
  describe(action: PendingPresentationDelivery["action"]): string | undefined;
}

/** 有序 adapter 表——resolve 即注册表查询（supports 内含三元组判定）。 */
export function createCapabilityRegistry(adapters: readonly PresentationToolAdapter[]): CapabilityRegistry {
  return {
    resolve(action) {
      return adapters.find((adapter) => adapter.supports(action));
    },
    describe(action) {
      if (action.kind === "voice") return action.voice_action !== undefined ? "voice" : undefined;
      const workspace = action.workspace_action;
      return workspace !== undefined ? `${workspace.surface}:${workspace.capability}` : undefined;
    },
  };
}
