/**
 * F7 Step 7：canonical Solution Board 唯一渲染面（自 fe-prep
 * StudentWorkspaceViewSurface 抽出——讲解/完成只读面与操作拍
 * ActionRuntimeFrame boardSurface 槽共用，禁第二份 Board renderer）。
 *
 * - 同一 View 的 building/review 两种阅读模式（review 不加载第二份 Board
 *   真相，ADR-009 不变量 7）；View 层无 hidden——未揭示条目整个不存在；
 *   空 groups 渲染明确 empty surface（不变量 6）。
 * - reveal 稳定回调（PresentationRuntime board adapter 的真实完成信号源）：
 *   本份投影**新增**条目的 reveal 动画（WAAPI；reduced-motion/jsdom 无
 *   animate 时跳过）全部完成后、或无新增条目时 post-paint 后，携带当前
 *   workspace revision 回调一次。既有条目重渲染不重复 reveal、不重复回调。
 */
import { useEffect, useRef } from "react";

import { MathText } from "../../components/math/MathText";
import type { StudentWorkspaceViewV1 } from "./canonicalViewTypes";

const BOARD_ENTRY_KIND_TEXT = {
  statement: "陈述",
  derivation: "推导",
  conclusion: "结论",
  question: "问题",
} as const;

/** Reveal：淡入 + 轻微上移（仅新增条目一次性播放；reduced-motion 跳过）。 */
const REVEAL_KEYFRAMES: Keyframe[] = [
  { opacity: "0", transform: "translateY(8px)" },
  { opacity: "1", transform: "translateY(0)" },
];

export interface SolutionBoardViewSurfaceProps {
  board: StudentWorkspaceViewV1["solution_board"];
  /** 当前 workspace revision（reveal 稳定回调携带；呈现链外可不传）。 */
  revision?: number;
  /** 本份 board 投影稳定（新增条目 reveal 完成 / 无新增即 paint 后）回调一次。 */
  onSettled?: (revision: number) => void;
}

export function SolutionBoardViewSurface({ board, revision, onSettled }: SolutionBoardViewSurfaceProps) {
  const { groups, mode } = board;
  const review = mode === "review";
  const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const knownEntryIdsRef = useRef<ReadonlySet<string> | undefined>(undefined);

  useEffect(() => {
    if (!onSettled || revision === undefined) return;
    const currentIds = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.entry_id)));
    const previous = knownEntryIdsRef.current;
    knownEntryIdsRef.current = currentIds;
    let active = true;
    const settle = (): void => {
      if (active) onSettled(revision);
    };
    const newIds = previous === undefined
      ? []
      : [...currentIds].filter((id) => !previous.has(id));
    const animatable = newIds.length > 0 && containerRef.current !== null;
    if (animatable) {
      const reduce = typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
      const animations: Promise<unknown>[] = [];
      if (!reduce) {
        for (const id of newIds) {
          const node = containerRef.current!.querySelector<HTMLElement>(`[data-entry-id="${id}"]`);
          if (!node || typeof node.animate !== "function") continue;
          animations.push(node.animate(REVEAL_KEYFRAMES, { duration: 600, easing: "ease-out" }).finished.catch(() => undefined));
        }
      }
      if (animations.length > 0) {
        void Promise.all(animations).then(() => {
          if (active && knownEntryIdsRef.current === currentIds) settle();
        });
        return () => { active = false; };
      }
    }
    // 无新增条目 / 无可动画节点 / reduced-motion：post-paint 后结算。
    let innerHandle = 0;
    if (typeof requestAnimationFrame === "function") {
      const outer = requestAnimationFrame(() => {
        innerHandle = requestAnimationFrame(settle);
      });
      return () => {
        active = false;
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(outer);
        if (innerHandle && typeof cancelAnimationFrame === "function") cancelAnimationFrame(innerHandle);
      };
    }
    const timer = window.setTimeout(settle, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [groups, revision, onSettled]);

  return (
    <section
      className={`topic-answer-panel solution-board-panel${entryCount === 0 ? " is-empty" : ""}${review ? " is-review" : ""}`}
      aria-label={review ? "解题板书（回顾）" : "解题板书"}
      data-testid="region-solution-board"
      data-board-mode={mode}
    >
      <div className="solution-board-document" ref={containerRef}>
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
