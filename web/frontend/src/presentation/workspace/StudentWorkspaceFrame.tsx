/**
 * StudentWorkspaceFrame —— 学生工作台 Workspace composition 的唯一
 * canonical owner（VS1 remediation，2026-08-26 验收 Rejected 后裁定）。
 *
 * 职责：Geometry surface 与 Solution Board surface 的固定双栏组合
 * （同一横向带、同 revision、teach/operate/completed 三阶段同一
 * bounds）。任何阶段（讲解只读、操作交互、完成回顾）都经由本 Frame
 * 渲染双 surface，不得在页面里自行组装第二套布局。
 *
 * 布局复用既有 `.action-runtime-workspace` 同族 grid（practice.css）——
 * 不复制 Workspace CSS；`student-workspace-frame` 语义类承担窄屏断点
 * 与验收锚定。Geometry 槽与 Board 槽由调用方提供：
 * - 操作交互：ActionRuntimeFrame 内部传交互画布 +（tutor 链路）统一
 *   View 的 boardView；
 * - 讲解/完成：ReadOnlyGeometrySurface + StudentBoardSurface（本文件
 *   导出，页面不得另行组装）。
 */
import type { ReactNode } from "react";
import { useMemo } from "react";

import { SolutionBoardPanel } from "../runtime/ActionRuntimeFrame";
import { buildGeometryModel } from "../../geometry/adapters/topicGeometryModel";
import { GeometryCanvasSurface } from "../../geometry/react/GeometryCanvas";
import type { InteractionView } from "../../geometry/interaction/interaction-view";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import type { StudentBoardView } from "../../../../shared/studentWorkspace";

export interface StudentWorkspaceFrameProps {
  /** Geometry surface 内容（画布本体；不含 stage 外壳——由本 Frame 提供）。 */
  geometry: ReactNode;
  /** Solution Board surface 内容（板书面本体；不含布局外壳）。 */
  board: ReactNode;
  /** 统一 View revision（Frame 容器与两 surface 同源断言锚点）。 */
  viewRevision?: number;
  /** 覆盖层（absolute，不占 grid——如 wrong 反馈横幅）。 */
  overlay?: ReactNode;
  /** 既有断言兼容：tutor 操作态传 "action-runtime-workspace"；缺省
   *  "student-workspace-frame"（讲解/完成/验收断言锚点）。 */
  frameTestId?: string;
  className?: string;
  /** 透传到 Frame 容器的 data-* 属性（操作态既有断言：action-id 等）。 */
  dataAttributes?: Record<string, string | undefined>;
}

export function StudentWorkspaceFrame({
  geometry,
  board,
  viewRevision,
  overlay,
  frameTestId = "student-workspace-frame",
  className,
  dataAttributes,
}: StudentWorkspaceFrameProps) {
  return (
    <div
      className={["practice-canvas-zone", "topic-practice-canvas", "student-workspace-frame", className]
        .filter(Boolean)
        .join(" ")}
      data-testid={frameTestId}
      data-view-revision={viewRevision}
      {...(dataAttributes ? (Object.fromEntries(
        Object.entries(dataAttributes).map(([key, value]) => [`data-${key}`, value]),
      ) as Record<string, string | undefined>) : {})}
    >
      <div className="artifact-math-object has-diagram">
        <section className="artifact-diagram-stage" aria-label="几何画布" data-testid="region-geometry">
          {geometry}
        </section>
      </div>
      {board}
      {overlay}
    </div>
  );
}

/**
 * 讲解/完成阶段的只读几何 surface：渲染统一 View 的组合画布
 *（authored 题图 + 服务端已披露演示效果——可能含 derivedLines）。
 * 实体全部 disabled、无确认按钮、不产生 evidence——讲解回合不冒充
 * 操作回合的 workspace 合同。无几何时渲染明确占位（surface 不塌缩）。
 */
export function ReadOnlyGeometrySurface({ geometry, label = "题目图形" }: { geometry?: TopicGeometryModel; label?: string }) {
  const model = useMemo(() => (geometry ? buildGeometryModel(geometry) : undefined), [geometry]);
  const view = useMemo<InteractionView>(() => ({
    prompt: label,
    entities: {
      ...Object.fromEntries((geometry?.points ?? []).map((point) => [point.id, {
        id: point.id, kind: "point" as const, enabled: false, expected: false, visualState: "idle" as const,
      }])),
      ...Object.fromEntries((geometry?.segments ?? []).map((segment) => [segment.id, {
        id: segment.id, kind: "line" as const, enabled: false, expected: false, visualState: "idle" as const,
      }])),
      ...Object.fromEntries((geometry?.derivedLines ?? []).map((line) => [line.id, {
        id: line.id, kind: "line" as const, enabled: false, expected: false, visualState: "idle" as const,
      }])),
    },
    selected: [],
    cursor: "default",
    canCancel: false,
    canGoBack: false,
  }), [geometry, label]);
  if (!model) {
    return <p className="student-workspace-empty-note">本题没有图示，跟随老师板书推理。</p>;
  }
  return <GeometryCanvasSurface model={model} view={view} onClickEntity={() => undefined} modelVersion={1} />;
}

/**
 * 讲解/完成阶段的板书 surface：有可见行 → canonical SolutionBoardPanel；
 * 无可见行 → 明确 empty surface（VS0 的 ADR-009 不变量 6 语义）。
 * 两态都在 region-solution-board 语义内——页面不得另行组装。
 */
export function StudentBoardSurface({ board, ariaLabel = "解题板书" }: { board?: StudentBoardView; ariaLabel?: string }) {
  if (board && board.visibleExpressions.length) {
    return <SolutionBoardPanel board={board} />;
  }
  return (
    <section className="topic-answer-panel solution-board-panel is-empty" aria-label={`${ariaLabel}（暂空）`} data-testid="region-solution-board">
      <div className="solution-board-document">
        <p className="solution-board-empty-note">板书还没有开始——跟随老师的讲解逐步出现。</p>
      </div>
    </section>
  );
}
