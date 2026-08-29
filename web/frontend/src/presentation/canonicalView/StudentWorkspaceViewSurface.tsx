/**
 * fe-prep（2026-08-28）：StudentWorkspaceView（view/v1）→ Workspace 双
 * surface 纯渲染。
 *
 * - 组合外壳复用 canonical `StudentWorkspaceFrame`（vs01-rem2 裁定的唯一
 *   Workspace composition owner：region-geometry 槽 + board 槽同一 grid、
 *   同一 data-view-revision）；不建第二套 Workspace renderer/CSS。
 * - Geometry：fe-prep 渲染 student-safe 的画布元素语义摘要（真实
 *   GeometryCanvas/typed command 接线属 F7 生产化范围）；interaction_enabled
 *   =false（完成/只读 review）时明确只读、不可操作。
 * - Board：同一 View 的 building/review 两种阅读模式（review 不加载第二份
 *   Board 真相，ADR-009 不变量 7）；View 层无 hidden——未揭示条目整个不
 *   存在，不存在"置空占位"；空 groups 渲染明确 empty surface（不变量 6）。
 */
import { MathText } from "../../components/math/MathText";
import { StudentWorkspaceFrame } from "../workspace/StudentWorkspaceFrame";
import type { StudentWorkspaceViewV1 } from "./canonicalViewTypes";

const ELEMENT_KIND_TEXT = {
  point: "点",
  segment: "线段",
  line: "直线",
  circle: "圆",
  polygon: "多边形",
  label: "标签",
  measure: "度量",
} as const;

const BOARD_ENTRY_KIND_TEXT = {
  statement: "陈述",
  derivation: "推导",
  conclusion: "结论",
  question: "问题",
} as const;

export function StudentWorkspaceViewSurface({ view }: { view: StudentWorkspaceViewV1 }) {
  return (
    <StudentWorkspaceFrame
      frameTestId="canonical-student-workspace"
      viewRevision={view.revision}
      dataAttributes={{ "session-id": view.session_id, "workspace-mode": view.solution_board.mode }}
      geometry={<CanvasElementsSurface view={view} />}
      board={<SolutionBoardSurface view={view} />}
    />
  );
}

function CanvasElementsSurface({ view }: { view: StudentWorkspaceViewV1 }) {
  const { elements, interaction_enabled: interactionEnabled } = view.canvas;
  return (
    <div
      className={`canonical-canvas-surface${interactionEnabled ? "" : " is-readonly"}`}
      aria-readonly={interactionEnabled ? undefined : true}
      data-interaction-enabled={interactionEnabled}
      data-element-count={elements.length}
    >
      {elements.length ? (
        <ul className="canonical-canvas-elements" aria-label="画布元素">
          {elements.map((element) => (
            <li
              key={element.element_id}
              data-element-id={element.element_id}
              data-element-kind={element.kind}
              data-highlighted={element.highlighted ? true : undefined}
              data-annotated={element.annotated ? true : undefined}
              data-student-authored={element.student_authored ? true : undefined}
            >
              <span className="sr-only">
                {ELEMENT_KIND_TEXT[element.kind]}
                {element.element_id}
                {element.highlighted ? "，高亮" : ""}
                {element.annotated ? "，已批注" : ""}
                {element.student_authored ? "，学生所作" : ""}
                {"。"}
              </span>
              <span aria-hidden="true">
                {ELEMENT_KIND_TEXT[element.kind]} {element.element_id}
                {element.highlighted ? "（高亮）" : ""}
                {element.annotated ? "（批注）" : ""}
                {element.student_authored ? "（学生所作）" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="student-workspace-empty-note">画布还没有内容——跟随老师的讲解开始。</p>
      )}
      {!interactionEnabled ? <p className="canonical-canvas-readonly-note" role="status">当前为只读回顾，画布不可操作。</p> : null}
    </div>
  );
}

function SolutionBoardSurface({ view }: { view: StudentWorkspaceViewV1 }) {
  const { groups, mode } = view.solution_board;
  const review = mode === "review";
  const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);
  return (
    <section
      className={`topic-answer-panel solution-board-panel${entryCount === 0 ? " is-empty" : ""}${review ? " is-review" : ""}`}
      aria-label={review ? "解题板书（回顾）" : "解题板书"}
      data-testid="region-solution-board"
      data-board-mode={mode}
    >
      <div className="solution-board-document">
        {entryCount === 0 ? (
          <p className="solution-board-empty-note">板书还没有开始——跟随老师的讲解逐步出现。</p>
        ) : (
          groups.map((group) => (
            <div key={group.group_id} className="solution-board-group" data-group-id={group.group_id}>
              {group.title ? <h3 className="solution-board-group-title">{group.title}</h3> : null}
              {group.entries.map((entry) => (
                <div
                  key={entry.entry_id}
                  className={`solution-board-line${entry.state === "active" ? " is-current" : ""}`}
                  data-entry-id={entry.entry_id}
                  data-entry-kind={entry.kind}
                  data-entry-state={entry.state}
                >
                  <span className="sr-only">{BOARD_ENTRY_KIND_TEXT[entry.kind]}：</span>
                  <MathText value={entry.content} block />
                  {entry.attempt_summary ? (
                    <small className="solution-board-attempt" data-attempt-summary={entry.attempt_summary}>
                      你的尝试：{entry.attempt_summary}
                    </small>
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
        {review ? <p className="solution-board-review-note" role="status">已完成回顾：同一份板书的只读阅读模式。</p> : null}
      </div>
    </section>
  );
}
