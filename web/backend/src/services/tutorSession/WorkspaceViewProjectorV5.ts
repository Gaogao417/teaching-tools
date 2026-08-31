/**
 * WorkspaceViewProjectorV5（F3 — Workspace 状态转换内核）。
 *
 * 纯投影：`(WorkspaceRuntimeState, catalog, participation 切片) → StudentWorkspaceView`
 * （view/v1 canonical Zod 推导类型——不消费 web/shared/studentWorkspace.ts 手写
 * 类型，G1 报告 §2 指定 F3 侧收敛位）。不读 Event Store、不构图、不 reveal、
 * 不裁决教学（ADR-008 §4/不变量 4）。
 *
 * truth 统一过滤：hidden Board 条目**整条不出现**（不是置空——view/v1 无 hidden
 * 值即此语义）；state 不含答案真值（schema 封死），catalog 的 hidden 条目内容
 * 只存在于服务端。
 *
 * View kind 推导：catalog authoredElementKinds 优先，缺省按元素 id 前缀纪律
 * （pt-/seg-/line-/label-/val-）——纯函数、无第二真源。
 *
 * 可选增强位（highlighted/annotated/attempt_summary）不自 state 可推导时一律
 * 不输出（不虚构；f3-scope-ledger「语义比较与 ephemeral 边界」）。
 */
import type { z } from "zod";
import { studentWorkspaceViewV1Schema } from "../../../../shared/canonical";
import { elementKindFromId } from "./WorkspaceCapabilityRegistryV5";
import type { WorkspacePresentationCatalogV5 } from "./WorkspacePresentationCatalogV5";
import type { WorkspaceRuntimeStateV5 } from "./WorkspaceRuntimeReducerV5";
import type { TutorRuntimeStateV5 } from "./TutorRuntimeStateReducerV5";

export type StudentWorkspaceViewV5 = z.infer<typeof studentWorkspaceViewV1Schema>;

/** view/v1 participation 内嵌切片（MainlineParticipation 受控形态）。 */
export type MainlineParticipationSlice = StudentWorkspaceViewV5["participation"];

/**
 * phase 级 participation 推导（F3 冻结；Beat 级映射需 protocol beats，归 F5/F6）：
 * completed→read_only_completed；inquiry→temporarily_paused_for_inquiry；
 * gate_satisfied→confirm_input；awaiting_evidence→workspace_input（answer/workspace
 * 之分属 F5/F6）；presenting→listen_only。
 */
export function deriveMainlineParticipation(tutorState: TutorRuntimeStateV5): MainlineParticipationSlice {
  if (tutorState.completed) return { kind: "read_only_completed" };
  if (tutorState.inquiry_cursor) {
    return { kind: "temporarily_paused_for_inquiry", return_checkpoint_id: tutorState.inquiry_cursor.return_beat_id };
  }
  const gateId = tutorState.teaching_cursor.gate_id;
  switch (tutorState.teaching_cursor.phase) {
    case "gate_satisfied":
      return { kind: "confirm_input", ...(gateId ? { gate_id: gateId } : {}) };
    case "awaiting_evidence":
      return { kind: "workspace_input", ...(gateId ? { gate_id: gateId } : {}) };
    case "completed":
      return { kind: "read_only_completed" };
    default:
      return { kind: "listen_only" };
  }
}

/** 纯 State → View（单一 projector：Geometry 与 Board 同一 revision 同一来源）。 */
export function projectStudentWorkspaceViewV5(
  workspace: WorkspaceRuntimeStateV5,
  catalog: WorkspacePresentationCatalogV5,
  participation: MainlineParticipationSlice,
): StudentWorkspaceViewV5 {
  // canvas：authored 基座 + committed（tutor/accepted）+ draft（student_authored）。
  const authoredIds = new Set<string>();
  if (catalog.baseGeometry) {
    catalog.baseGeometry.points.forEach((point) => authoredIds.add(point.id));
    catalog.baseGeometry.segments.forEach((segment) => authoredIds.add(segment.id));
  }
  const elements: StudentWorkspaceViewV5["canvas"]["elements"] = [];
  const pushElement = (elementId: string, studentAuthored: boolean): void => {
    elements.push({
      element_id: elementId,
      kind: elementKindFromId(elementId, catalog.authoredElementKinds),
      visible: true,
      ...(studentAuthored ? { student_authored: true } : {}),
    });
  };
  authoredIds.forEach((id) => pushElement(id, false));
  const authoredOrSeen = new Set(authoredIds);
  for (const id of workspace.geometry.committed_element_ids) {
    if (!authoredOrSeen.has(id)) {
      pushElement(id, false);
      authoredOrSeen.add(id);
    }
  }
  for (const id of workspace.geometry.draft_element_ids) {
    if (!authoredOrSeen.has(id)) {
      pushElement(id, true);
      authoredOrSeen.add(id);
    }
  }

  // board：hidden 整条不出现；分组按 catalog 首现顺序；attempt_summary 不虚构。
  const entrySpecs = new Map(catalog.boardEntries.map((entry) => [entry.entryId, entry]));
  const groupsOrdered: string[] = [];
  const groups = new Map<string, StudentWorkspaceViewV5["solution_board"]["groups"][number]>();
  for (const entry of workspace.solution_board.entries) {
    if (entry.visibility === "hidden") continue;
    const spec = entrySpecs.get(entry.entry_id);
    if (!spec) continue;
    if (!groups.has(spec.presentationGroup)) {
      groups.set(spec.presentationGroup, { group_id: spec.presentationGroup, entries: [] });
      groupsOrdered.push(spec.presentationGroup);
    }
    groups.get(spec.presentationGroup)!.entries.push({
      entry_id: entry.entry_id,
      kind: spec.kind,
      content: spec.content,
      state: entry.visibility,
    });
  }

  const view: StudentWorkspaceViewV5 = {
    schema: "ai_teaching_student_workspace_view/v1",
    session_id: workspace.session_id,
    revision: workspace.revision,
    canvas: {
      elements,
      interaction_enabled: workspace.geometry.interaction_mode !== "locked",
    },
    solution_board: {
      mode: workspace.geometry.interaction_mode === "locked" ? "review" : "building",
      groups: groupsOrdered.map((groupId) => groups.get(groupId)!),
    },
    participation,
  };
  const canonical = studentWorkspaceViewV1Schema.safeParse(view);
  if (!canonical.success) {
    throw new Error(
      `projected view fails canonical view/v1 validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return view;
}
