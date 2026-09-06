/**
 * F7 Step 7：canonical Solution Board 唯一渲染面（自 fe-prep
 * StudentWorkspaceViewSurface 抽出——讲解/完成只读面与操作拍
 * ActionRuntimeFrame boardSurface 槽共用，禁第二份 Board renderer）。
 *
 * - 同一 View 的 building/review 两种阅读模式（review 不加载第二份 Board
 *   真相，ADR-009 不变量 7）；View 层无 hidden——未揭示条目整个不存在；
 *   空 groups 渲染明确 empty surface（不变量 6）。
 * - reveal 结算引擎（返工 P1-3/P2-5 重写）：同一挂载实例持有**稳定动画
 *   句柄表**（entryId → Animation）+ 已完成集合；规则：
 *   · 只有 reveal 动画**成功完成**才把条目记为已呈现；完成前 effect 重跑
 *     （同 revision 换对象/普通重渲染）不重复触发也不提前结算；
 *   · 动画取消/异常（finished reject）= 本挂载实例结算失败——不结算该
 *     revision（不误报 presented；由 adapter 超时走 failed fail-closed），
 *     已完成条目不受影响；
 *   · 卸载取消全部句柄并忽略一切迟到结果；
 *   · 句柄表清空（本轮新增条目全部成功完成，或本份投影无新增条目）→
 *     post-paint（双 rAF/setTimeout 回退）以**最新 revision** 结算一次
 *     （结算键 sessionId+revision 由父组件管理）；
 *   · reduce-motion / 无 WAAPI 环境：跳过动画，条目即时视为已呈现。
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

/** 仅依赖 WAAPI 的最小动画句柄面（jsdom 缺失时走无动画路径）。 */
interface RevealAnimation {
  finished: Promise<unknown>;
  cancel(): void;
}

export interface SolutionBoardViewSurfaceProps {
  board: StudentWorkspaceViewV1["solution_board"];
  /** 当前 workspace revision（reveal 结算携带；呈现链外可不传）。 */
  revision?: number;
  /** 本挂载实例的板书视觉稳定（在跑 reveal 全部成功完成 / 无动画 post-paint）
   *  回调——携带结算时刻的最新 revision；失败/卸载/迟到结果不回调。 */
  onSettled?: (revision: number) => void;
}

export function SolutionBoardViewSurface({ board, revision, onSettled }: SolutionBoardViewSurfaceProps) {
  const { groups, mode } = board;
  const review = mode === "review";
  const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 结算时刻的最新 revision/回调经 ref 读（动画完成晚于触发它的渲染）。 */
  const latestRef = useRef({ revision, onSettled });
  latestRef.current = { revision, onSettled };
  /** 挂载存活标记：动画完成处理器只认卸载失效——普通重渲染（effect 重跑）
   *  不作废仍在跑的 reveal（否则句柄泄漏且永不结算）。 */
  const mountedRef = useRef(true);
  /** 进行中的 reveal（动画句柄）；成功完成 → 移入 revealedIds。 */
  const revealHandlesRef = useRef(new Map<string, RevealAnimation>());
  /** reveal 已成功完成的条目（普通重渲染不重复动画、不重复等待）。 */
  const revealedIdsRef = useRef(new Set<string>());
  /** 本挂载实例是否发生过动画失败/取消（fail closed：此后不再结算）。 */
  const revealFailedRef = useRef(false);
  /** 初始挂载（restore/首份投影）：既有条目视为已呈现，不播 reveal。 */
  const firstRunRef = useRef(true);

  useEffect(() => {
    const latest = latestRef.current;
    if (!latest.onSettled || latest.revision === undefined) return;
    const currentIds = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.entry_id)));
    const handles = revealHandlesRef.current;
    const revealed = revealedIdsRef.current;
    let active = true;

    // 1. 防御：条目从板书消失（append-only 合同外）→ 取消并摘除句柄。
    for (const id of [...handles.keys()]) {
      if (!currentIds.has(id)) {
        handles.get(id)?.cancel();
        handles.delete(id);
      }
    }

    // 2. 新增条目：开 reveal 动画（初始挂载的既有条目 = 已呈现，restore 语义）。
    if (firstRunRef.current) {
      firstRunRef.current = false;
      for (const id of currentIds) revealed.add(id);
    }
    const reduce = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    for (const id of currentIds) {
      if (handles.has(id) || revealed.has(id)) continue;
      const node = containerRef.current?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`);
      const animate = node && typeof node.animate === "function" && !reduce
        ? node.animate(REVEAL_KEYFRAMES, { duration: 600, easing: "ease-out" })
        : undefined;
      if (animate === undefined || node === undefined) {
        revealed.add(id);
        continue;
      }
      const handle: RevealAnimation = {
        finished: animate.finished,
        cancel: () => animate.cancel(),
      };
      handles.set(id, handle);
      void handle.finished.then(
        () => {
          if (!mountedRef.current || handles.get(id) !== handle) return; // 卸载后被替换：忽略
          handles.delete(id);
          revealed.add(id);
          // 最后一个在跑 reveal 成功完成 → 以最新 revision 结算。
          if (handles.size === 0 && !revealFailedRef.current) {
            const settle = latestRef.current;
            if (settle.onSettled && settle.revision !== undefined) settle.onSettled(settle.revision);
          }
        },
        () => {
          // 取消/异常：绝不结算（不误报 presented）；条目不记已呈现。
          if (!mountedRef.current || handles.get(id) !== handle) return;
          handles.delete(id);
          revealFailedRef.current = true;
        },
      );
    }

    // 3. 无在跑动画：post-paint 结算（本轮回调随下一次 effect 重跑取消重排；
    //    同 revision 去抖由父组件结算键承担）。
    if (handles.size === 0 && !revealFailedRef.current) {
      let inner = 0;
      const settle = (): void => {
        const now = latestRef.current;
        if (active && now.onSettled && now.revision !== undefined) now.onSettled(now.revision);
      };
      if (typeof requestAnimationFrame === "function") {
        const outer = requestAnimationFrame(() => {
          inner = requestAnimationFrame(settle);
        });
        return () => {
          active = false;
          cancelAnimationFrame(outer);
          if (inner) cancelAnimationFrame(inner);
        };
      }
      const timer = window.setTimeout(settle, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    // 4. 有动画在跑：本 effect 的清理只让 paint 结算路径失效；在跑句柄的
    //    完成处理器绑挂载存活（普通重渲染继续等待），整体取消在卸载。
    return () => {
      active = false;
    };
  }, [groups, revision, onSettled]);

  // 卸载：作废完成处理器、取消全部在跑动画并丢弃句柄（StrictMode 的
  // setup→cleanup→setup 由 setup 重新武装 mountedRef）。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const handle of revealHandlesRef.current.values()) handle.cancel();
      revealHandlesRef.current.clear();
    };
  }, []);

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
