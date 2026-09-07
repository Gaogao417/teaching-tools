/**
 * F7 Step 7：StudentWorkspaceView（view/v1）→ Workspace 双 surface 产品面。
 *
 * - 组合外壳复用 canonical `StudentWorkspaceFrame`（vs01-rem2 裁定的唯一
 *   Workspace composition owner：region-geometry 槽 + board 槽同一 grid、
 *   同一 data-view-revision）；不建第二套 Workspace renderer/CSS。
 * - Geometry：production `GeometryCanvasSurface`——数据源 = 服务端
 *   `render.geometry`（student-safe 组合几何，经 parseRenderGeometryV1 零
 *   cast 解析）→ buildGeometryModel；highlight/annotated 自 canonical
 *   Workspace View 的 canvas.elements 映射为 display-only visualState；
 *   实体 enabled=false（讲解/完成只读，学生操作经 ActionRuntimeFrame 的
 *   同一 Canvas 切 affordance，不换 renderer）。PLAN Step 7：点/线段文字
 *   列表已删除，不得再以摘要冒充画布（2026-09-06 用户裁定彻底删除）。
 * - Board：共享 canonical `SolutionBoardViewSurface`（操作拍
 *   ActionRuntimeFrame boardSurface 槽同一渲染面，禁第二份 Board）。
 * - 完成信号绑定 pending workspace 执行身份与 workspace revision。
 *   Canvas 更新通知和 Board reveal 结算必须属于同一执行；无 pending
 *   的视图通知使用独立身份，不能放行恢复 delivery。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

import { buildGeometryModel } from "../../geometry/adapters/topicGeometryModel";
import type { EntityAffordance } from "../../geometry/interaction/interaction-view";
import type { InteractionView } from "../../geometry/interaction/interaction-view";
import { GeometryCanvasSurface } from "../../geometry/react/GeometryCanvas";
import { StudentWorkspaceFrame } from "../workspace/StudentWorkspaceFrame";
import { SolutionBoardViewSurface } from "./SolutionBoardViewSurface";
import type { WorkspaceCommitSignal } from "../presentationRuntime/workspaceCommitPort";
import type { StudentWorkspaceViewHttp } from "./canonicalViewTypes";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";

export interface StudentWorkspaceViewSurfaceProps {
  /** F7 P2：HTTP 投影 v1|v2（v2 携带 solution_board.fragments——临场解释板书）。 */
  view: StudentWorkspaceViewHttp;
  /** render.geometry 的运行时解析产物；undefined = 无图示任务（明确占位）。 */
  geometry?: TopicGeometryModel;
  /** 提供时接入真实完成信号源（讲解/完成面挂载期注册）。 */
  commitSignal?: WorkspaceCommitSignal;
  /** 当前 pending board delivery 的执行身份（三次复验 P1：失败封禁/重呈现
   *  绑定执行身份而非 workspace revision）。 */
  workspaceExecutionKey?: string;
  boardPresentation?: { key: string; targets: readonly string[] };
}

/** 高亮/批注 → display-only visualState（renderer 只消费 affordance 颜色）。 */
function visualStateFor(element: { highlighted?: boolean; annotated?: boolean } | undefined): EntityAffordance["visualState"] {
  if (element?.highlighted) return "selected";
  if (element?.annotated) return "correct";
  return "idle";
}

export function StudentWorkspaceViewSurface({ view, geometry, commitSignal, boardPresentation, workspaceExecutionKey }: StudentWorkspaceViewSurfaceProps) {
  const { elements, interaction_enabled: interactionEnabled } = view.canvas;

  // ---- 真实 commit 信号：注册（+唤醒可能已暂停的执行）+ 同键双结算 ----
  useEffect(() => {
    if (!commitSignal) return;
    const unregister = commitSignal.registerRealCommitSource();
    // 先注册（计数 ≥1）再唤醒：重试的 adapter 立即可观察到真实信号源。
    commitSignal.notifyRealSourceActive();
    return unregister;
  }, [commitSignal]);

  const executionKey = workspaceExecutionKey ?? boardPresentation?.key;
  const join = useMemo(() => ({
    sessionId: view.session_id, revision: view.revision, executionKey,
    canvas: false, board: false, notified: false,
  }), [view.session_id, view.revision, executionKey]);
  const currentJoinRef = useRef(join);
  currentJoinRef.current = join;
  const settle = useCallback((surface: "canvas" | "board", revision: number, key: string | undefined) => {
    if (currentJoinRef.current !== join || revision !== join.revision || key !== join.executionKey) return;
    join[surface] = true;
    if (!join.canvas || !join.board || join.notified || !commitSignal) return;
    join.notified = true;
    // 无 pending 的视图结算只作独立身份记录，永不满足某个 delivery 的等待。
    commitSignal.notifyRealCommitted({ sessionId: join.sessionId, revision,
      executionKey: key ?? `view:${join.sessionId}@${revision}` });
  }, [join, commitSignal]);
  const canvasSettled = useCallback(() => settle("canvas", join.revision, join.executionKey), [settle, join]);
  const boardSettled = useCallback((revision: number, key?: string) => settle("board", revision, key), [settle]);
  const boardOnSettled = commitSignal ? boardSettled : undefined;
  const boardExecution = useMemo(() => executionKey === undefined ? undefined : ({
    key: executionKey, targets: boardPresentation?.targets ?? [],
  }), [executionKey, boardPresentation?.targets]);

  // ---- production Canvas 投影（零本地教学状态；visualState 全部来自 View）----
  const model = useMemo(() => (geometry ? buildGeometryModel(geometry) : undefined), [geometry]);
  const interactionView = useMemo<InteractionView>(() => {
    const byId = new Map(elements.map((element) => [element.element_id, element]));
    const entities: Record<string, EntityAffordance> = {};
    if (geometry) {
      for (const point of geometry.points) {
        entities[point.id] = {
          id: point.id, kind: "point", enabled: false, expected: false,
          visualState: visualStateFor(byId.get(point.id)),
        };
      }
      const lines: readonly { id: string }[] = [
        ...geometry.segments,
        ...(geometry.derivedLines ?? []),
      ];
      for (const line of lines) {
        entities[line.id] = {
          id: line.id, kind: "line", enabled: false, expected: false,
          visualState: visualStateFor(byId.get(line.id)),
        };
      }
    }
    return {
      prompt: "题目图形",
      entities,
      selected: [],
      cursor: "default",
      canCancel: false,
      canGoBack: false,
    };
  }, [geometry, elements]);

  // canvas 结算（无图示任务的占位面）：占位即本 revision 的既定视觉——
  // post-paint 结算。有图示时 canvas 通道由 renderer 的 onRenderCommit 驱动
  //（见下 JSX），不经本 effect。
  const hasCanvasModel = model !== undefined;
  useEffect(() => {
    if (!commitSignal || hasCanvasModel) return;
    let active = true;
    let inner = 0;
    const settleNow = (): void => {
      if (active) canvasSettled();
    };
    if (typeof requestAnimationFrame === "function") {
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(settleNow);
      });
      return () => {
        active = false;
        cancelAnimationFrame(outer);
        if (inner) cancelAnimationFrame(inner);
      };
    }
    const timer = window.setTimeout(settleNow, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [commitSignal, hasCanvasModel, canvasSettled]);

    return (
    <StudentWorkspaceFrame
      frameTestId="canonical-student-workspace"
      viewRevision={view.revision}
      dataAttributes={{ "session-id": view.session_id, "workspace-mode": view.solution_board.mode }}
      geometry={(
        <div
          className="canonical-workspace-canvas"
          aria-readonly={interactionEnabled ? undefined : true}
          data-interaction-enabled={interactionEnabled}
        >
          {model ? (
            <GeometryCanvasSurface
              visualRenderer={view.schema === "ai_teaching_student_workspace_view/v3" ? commitSignal?.visualRenderer : undefined}
              onVisualSourceActive={commitSignal?.notifyRealSourceActive}
              key={view.session_id}
              model={model}
              view={interactionView}
              onClickEntity={() => undefined}
              modelVersion={view.revision}
              renderExecutionKey={executionKey}
              onRenderCommit={canvasSettled}
            />
          ) : (
            <p className="student-workspace-empty-note">本题没有图示，跟随老师板书推理。</p>
          )}
          {!interactionEnabled ? (
            <p className="canonical-canvas-readonly-note" role="status">当前为只读画布，跟随老师讲解；操作环节会在同一画布上开放。</p>
          ) : null}
        </div>
      )}
      board={<SolutionBoardViewSurface board={view.solution_board} revision={view.revision} sessionId={view.session_id} execution={boardExecution} onSettled={boardOnSettled} />}
    />
  );
}
