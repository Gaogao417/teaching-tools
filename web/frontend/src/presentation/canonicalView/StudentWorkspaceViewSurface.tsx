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
 * - 真实完成信号（F7 Step 7 解除 Step 6 生产暂停；返工 P1-1/P1-2/P2-5）：
 *   mount 注册 registerRealCommitSource 后 notifyRealSourceActive（唤醒可能
 *   已 paused 的 awaiting-real-signal 执行）；canvas 通道 = **renderer 发出的
 *   渲染通道完成信号**（GeometryCanvasSurface.onRenderCommit——非父组件双
 *   rAF 猜时序；无图示任务的占位面以 post-paint 结算；session 切换经 key
 *   remount 保证新会话获得信号）；board 通道 = reveal 稳定回调。两通道在
 *   **同一 sessionId+workspace revision** 双结算后 notifyRealCommitted（每
 *   键至多一次）——Geometry/Board adapter 共用（见
 *   presentationRuntime/workspaceCommitPort）。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

import { buildGeometryModel } from "../../geometry/adapters/topicGeometryModel";
import type { EntityAffordance } from "../../geometry/interaction/interaction-view";
import type { InteractionView } from "../../geometry/interaction/interaction-view";
import { GeometryCanvasSurface } from "../../geometry/react/GeometryCanvas";
import { StudentWorkspaceFrame } from "../workspace/StudentWorkspaceFrame";
import { SolutionBoardViewSurface } from "./SolutionBoardViewSurface";
import type { WorkspaceCommitSignal } from "../presentationRuntime/workspaceCommitPort";
import type { StudentWorkspaceViewV1 } from "./canonicalViewTypes";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";

export interface StudentWorkspaceViewSurfaceProps {
  view: StudentWorkspaceViewV1;
  /** render.geometry 的运行时解析产物；undefined = 无图示任务（明确占位）。 */
  geometry?: TopicGeometryModel;
  /** 提供时接入真实完成信号源（讲解/完成面挂载期注册）。 */
  commitSignal?: WorkspaceCommitSignal;
}

/** 高亮/批注 → display-only visualState（renderer 只消费 affordance 颜色）。 */
function visualStateFor(element: { highlighted?: boolean; annotated?: boolean } | undefined): EntityAffordance["visualState"] {
  if (element?.highlighted) return "selected";
  if (element?.annotated) return "correct";
  return "idle";
}

export function StudentWorkspaceViewSurface({ view, geometry, commitSignal }: StudentWorkspaceViewSurfaceProps) {
  const { elements, interaction_enabled: interactionEnabled } = view.canvas;

  // ---- 真实 commit 信号：注册（+唤醒可能已暂停的执行）+ 同键双结算 ----
  useEffect(() => {
    if (!commitSignal) return;
    const unregister = commitSignal.registerRealCommitSource();
    // 先注册（计数 ≥1）再唤醒：重试的 adapter 立即可观察到真实信号源。
    commitSignal.notifyRealSourceActive();
    return unregister;
  }, [commitSignal]);

  const settleRecordRef = useRef<{ canvas?: string; board?: string; notified?: string }>({});
  const commitSignalRef = useRef(commitSignal);
  commitSignalRef.current = commitSignal;
  const viewMetaRef = useRef(view);
  viewMetaRef.current = view;

  /** 结算键绑 session+revision：跨会话同号 revision 不得互相抑制/误放行。 */
  const settleKey = (sessionId: string, revision: number): string => `${sessionId}:${revision}`;

  const tryNotify = (sessionId: string, revision: number): void => {
    const record = settleRecordRef.current;
    const key = settleKey(sessionId, revision);
    if (record.canvas !== key || record.board !== key || record.notified === key) return;
    record.notified = key;
    const signal = commitSignalRef.current;
    if (signal) signal.notifyRealCommitted({ sessionId, revision });
  };
  // 最新结算回调经 ref 透传（effect/子组件拿稳定入口、读到最新闭包）。
  const canvasSettledRef = useRef<(revision: number) => void>(() => undefined);
  canvasSettledRef.current = (revision) => {
    const sessionId = view.session_id;
    settleRecordRef.current.canvas = settleKey(sessionId, revision);
    tryNotify(sessionId, revision);
  };
  const boardSettledStable = useCallback((revision: number) => {
    // 稳定回调：session 读最新 render 的 view（board 结算总发生在其对应
    // render commit 之后）。
    const sessionId = viewMetaRef.current.session_id;
    settleRecordRef.current.board = settleKey(sessionId, revision);
    tryNotify(sessionId, revision);
  }, []);
  const boardOnSettled = commitSignal ? boardSettledStable : undefined;

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
      if (active) canvasSettledRef.current(view.revision);
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
  }, [commitSignal, hasCanvasModel, view.session_id, view.revision]);

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
              key={view.session_id}
              model={model}
              view={interactionView}
              onClickEntity={() => undefined}
              modelVersion={view.revision}
              onRenderCommit={() => canvasSettledRef.current(view.revision)}
            />
          ) : (
            <p className="student-workspace-empty-note">本题没有图示，跟随老师板书推理。</p>
          )}
          {!interactionEnabled ? (
            <p className="canonical-canvas-readonly-note" role="status">当前为只读画布，跟随老师讲解；操作环节会在同一画布上开放。</p>
          ) : null}
        </div>
      )}
      board={<SolutionBoardViewSurface board={view.solution_board} revision={view.revision} sessionId={view.session_id} onSettled={boardOnSettled} />}
    />
  );
}
