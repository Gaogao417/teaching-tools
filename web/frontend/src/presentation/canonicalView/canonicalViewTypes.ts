/**
 * fe-prep（2026-08-28）：view/v1 三合同的 canonical TS 类型派生点。
 *
 * 唯一来源 = `web/shared/canonical/schemas.ts` 的 Zod 镜像（PRDS
 * `contracts/schemas/view/v1/` 的合同真源镜像，G1 parity 锁定）。本文件
 * 只做 `z.infer` 派生，不复制任何手写字段形状；禁止从
 * `web/shared/studentWorkspace.ts`（G1 §2 登记的待收敛 legacy）或
 * `action-runtime/types.ts` 引入 View 类型。
 */
import type { z } from "zod";
import type {
  coachPanelViewV1Schema,
  mainlineParticipationV1Schema,
  studentWorkspaceViewV1Schema,
  studentWorkspaceViewV2Schema,
} from "../../../../shared/canonical/schemas";

/** view/v1 StudentWorkspaceView（学生唯一 student-safe Workspace View）。 */
export type StudentWorkspaceViewV1 = z.infer<typeof studentWorkspaceViewV1Schema>;

/** view/v2 StudentWorkspaceView（F7 P2 动态板书：solution_board 增可选 fragments）。 */
export type StudentWorkspaceViewV2 = z.infer<typeof studentWorkspaceViewV2Schema>;

/** F7 P2：HTTP 快照投影的 Workspace View（v1|v2 判别联合；消费面按 marker 收窄）。 */
export type StudentWorkspaceViewHttp = StudentWorkspaceViewV1 | StudentWorkspaceViewV2;

/** view/v2 解释片段（EF- 临场板书的 student-safe 投影；内容/绑定引用只读）。 */
export type SolutionBoardFragment = NonNullable<StudentWorkspaceViewV2["solution_board"]["fragments"]>[number];

/** Solution Board 面（v1 兼容——fragments 仅 v2 投影携带）。 */
export type SolutionBoardSurface = StudentWorkspaceViewV2["solution_board"];

/** view/v1 CoachPanelView（与 StudentWorkspaceView 同 revision 投影）。 */
export type CoachPanelViewV1 = z.infer<typeof coachPanelViewV1Schema>;

/** view/v1 MainlineParticipation（StudentWorkspaceView.participation 的目标形态）。 */
export type MainlineParticipationV1 = z.infer<typeof mainlineParticipationV1Schema>;

/** 受控主线参与 kind（7 值；负例 `chat`/未知 kind 被 schema 拒绝）。 */
export type MainlineParticipationKind = MainlineParticipationV1["kind"];

/** Coach mainline 受控状态（7 值 oneOf；`generic_chat` 被拒绝）。 */
export type CoachMainlineState = CoachPanelViewV1["mainline"];

/** Coach inquiry 状态（no_inquiry 或携带显式 return_checkpoint_id）。 */
export type CoachInquiryState = CoachPanelViewV1["inquiry"];

/** StudentWorkspaceView.participation 的内嵌形态（同 kind/gate/return 规则，无 schema 常量）。 */
export type EmbeddedMainlineParticipation = StudentWorkspaceViewV1["participation"];

/** Solution Board 条目（View 层无 hidden：未揭示条目整个不存在）。 */
export type SolutionBoardEntry = StudentWorkspaceViewV1["solution_board"]["groups"][number]["entries"][number];
