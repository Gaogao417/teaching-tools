/** Canonical Board renderer. Animation handles and completion belong to one
 *  presentation execution. Revision only identifies the rendered projection. */
import { useEffect, useRef } from "react";
import { MathText } from "../../components/math/MathText";
import type { SolutionBoardFragment, SolutionBoardSurface } from "./canonicalViewTypes";
const BOARD_ENTRY_KIND_TEXT = { statement: "陈述", derivation: "推导", conclusion: "结论", question: "问题" } as const;
/** F7 P2（view/v2）：临场解释片段的 kind 标签（EF- student-safe 投影）。 */
const FRAGMENT_KIND_TEXT = { approved_math_note: "批注", relation_note: "关系", explanation_text: "解释" } as const;
const REVEAL_KEYFRAMES: Keyframe[] = [
  { opacity: "0", transform: "translateY(8px)" },
  { opacity: "1", transform: "translateY(0)" },
];
export interface SolutionBoardViewSurfaceProps {
  /** v1 兼容（无 fragments）；v2 投影携带临场解释片段（EF-）。 */
  board: SolutionBoardSurface;
  revision?: number;
  sessionId?: string;
  execution?: { key: string; targets: readonly string[] };
  onSettled?: (revision: number, executionKey?: string) => void;
}
interface RevealHandle { cancel(): void }
interface RevealRun {
  sessionId?: string;
  key?: string;
  handles: Map<string, RevealHandle>;
  revealed: Set<string>;
  failed: Set<string>;
  revision?: number;
  onSettled?: SolutionBoardViewSurfaceProps["onSettled"];
}
const failureKey = (run: RevealRun) => run.key ?? `view:${run.sessionId}@${run.revision}`;
export function SolutionBoardViewSurface({ board, revision, sessionId, execution, onSettled }: SolutionBoardViewSurfaceProps) {
  const { groups, mode } = board;
  const review = mode === "review";
  const entryCount = groups.reduce((total, group) => total + group.entries.length, 0);
  /** F7 P2（view/v2）：临场解释片段（EF-）。attach_to_entry 命中的渲染在对应
   *  条目下方；其余渲染在板书文档尾部（独立解释行）。片段节点复用
   *  data-entry-id/reveal 动画链——board.explain 的呈现目标即 fragment_id。 */
  const fragments = board.fragments ?? [];
  const attachedFragments = (entryId: string): readonly SolutionBoardFragment[] =>
    fragments.filter((fragment) => fragment.attach_to_entry === entryId);
  const standaloneFragments = fragments.filter((fragment) => fragment.attach_to_entry === undefined
    || !groups.some((group) => group.entries.some((entry) => entry.entry_id === fragment.attach_to_entry)));
  const fragmentCount = fragments.length;
  /** 片段身份 key（effect deps——数组身份逐渲染变化不触发重扫）。 */
  const fragmentsKey = fragments.map((fragment) => fragment.fragment_id).join(",");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runRef = useRef<RevealRun | undefined>(undefined);
  // Successful/failed rendering history persists across StrictMode effect replay.
  const historyRef = useRef<{ sessionId?: string; key?: string; revealed: Set<string>; failed: Set<string> } | undefined>(undefined);
  const finishRef = useRef<{ run: RevealRun; schedule(): void } | undefined>(undefined);
  const executionKey = execution?.key;
  const targetsKey = JSON.stringify(execution?.targets ?? []);

  useEffect(() => {
    let run = runRef.current;
    if (!run || run.sessionId !== sessionId || run.key !== executionKey) {
      const previous = run;
      const freshSession = !historyRef.current || historyRef.current.sessionId !== sessionId;
      if (freshSession) {
        // First projection is restore; all existing entries are already visible.
        historyRef.current = { sessionId, key: executionKey,
          revealed: new Set(groups.flatMap(group => group.entries.map(entry => entry.entry_id))), failed: new Set() };
      }
      const history = historyRef.current!;
      run = { sessionId, key: executionKey, handles: new Map(), revealed: history.revealed,
        failed: history.failed, revision, onSettled };
      // Invalidate callbacks BEFORE cancel(): rejection/late resolution belongs to previous run.
      runRef.current = run;
      if (previous) {
        for (const handle of previous.handles.values()) handle.cancel();
        previous.handles.clear();
      }
      if (previous?.key !== undefined && executionKey === undefined) {
        for (const group of groups) for (const entry of group.entries) run.revealed.add(entry.entry_id);
      }
      if (!freshSession && executionKey !== undefined && history.key !== executionKey) {
        for (const target of execution?.targets ?? []) run.revealed.delete(target);
      }
      history.key = executionKey;
    }
    const current = run;
    current.revision = revision;
    current.onSettled = onSettled;
    let active = true;
    let cancelPaint = () => {};
    const scheduleSettled = () => {
      cancelPaint();
      if (!active || runRef.current !== current || current.handles.size || current.failed.has(failureKey(current))) return;
      const settledRevision = current.revision;
      const settledKey = current.key;
      const fire = () => {
        if (!active || runRef.current !== current || current.handles.size
          || current.revision !== settledRevision || current.failed.has(failureKey(current)) || settledRevision === undefined) return;
        // Capture the execution that produced the result, never label it as a newer execution.
        if (settledKey === undefined) current.onSettled?.(settledRevision);
        else current.onSettled?.(settledRevision, settledKey);
      };
      if (typeof requestAnimationFrame === "function") {
        let inner = 0;
        const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(fire); });
        cancelPaint = () => { cancelAnimationFrame(outer); if (inner) cancelAnimationFrame(inner); };
      } else {
        const timer = window.setTimeout(fire, 0);
        cancelPaint = () => window.clearTimeout(timer);
      }
    };
    // Ordinary rerenders keep handles, but their finish handlers must schedule via this effect.
    finishRef.current = { run: current, schedule: scheduleSettled };
    if (!onSettled || revision === undefined) return () => { active = false; cancelPaint(); };
    const ids = new Set<string>(groups.flatMap(group => group.entries.map(entry => entry.entry_id)));
    for (const fragment of fragments) ids.add(fragment.fragment_id);
    for (const [id, handle] of current.handles) {
      if (!ids.has(id)) { current.handles.delete(id); handle.cancel(); }
    }
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const id of ids) {
      if (current.handles.has(id) || current.revealed.has(id)) continue;
      // Avoid interpolating entry IDs into CSS selectors.
      const node = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [])
        .find(candidate => candidate.dataset.entryId === id);
      if (!node) { current.failed.add(failureKey(current)); continue; }
      if (reduce || typeof node.animate !== "function") { current.revealed.add(id); continue; }
      const startedFailureKey = failureKey(current);
      try {
        const animation = node.animate(REVEAL_KEYFRAMES, { duration: 600, easing: "ease-out" });
        const handle = { cancel: () => animation.cancel() };
        current.handles.set(id, handle);
        const finish = (failed: boolean) => {
          if (runRef.current !== current || current.handles.get(id) !== handle) return;
          current.handles.delete(id);
          current.revealed.add(id);
          if (failed) current.failed.add(startedFailureKey);
          if (finishRef.current?.run === current) finishRef.current.schedule();
        };
        void animation.finished.then(() => finish(false), () => finish(true));
      } catch {
        current.failed.add(startedFailureKey);
      }
    }
    scheduleSettled();
    return () => { active = false; cancelPaint(); };
  }, [groups, revision, sessionId, executionKey, targetsKey, fragmentsKey, onSettled]);

  useEffect(() => () => {
    const previous = runRef.current;
    runRef.current = undefined;
    finishRef.current = undefined;
    if (previous) {
      for (const handle of previous.handles.values()) handle.cancel();
      previous.handles.clear();
    }
  }, []);

  return (
    <section
      className={`topic-answer-panel solution-board-panel${entryCount === 0 ? " is-empty" : ""}${review ? " is-review" : ""}`}
      aria-label={review ? "解题板书（回顾）" : "解题板书"}
      data-testid="region-solution-board"
      data-board-mode={mode}
    >
      <div className="solution-board-document" ref={containerRef}>
        {entryCount === 0 && fragmentCount === 0 ? (
          <p className="solution-board-empty-note">板书还没有开始——跟随老师的讲解逐步出现。</p>
        ) : (
          groups.map((group) => (
            <div key={group.group_id} className="solution-board-group" data-group-id={group.group_id}>
              {group.title ? <h3 className="solution-board-group-title">{group.title}</h3> : null}
              {group.entries.map((entry) => (
                <div key={entry.entry_id}>
                  <div
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
                  {attachedFragments(entry.entry_id).map((fragment) => (
                    <div
                      key={fragment.fragment_id}
                      className="solution-board-line solution-board-fragment"
                      data-entry-id={fragment.fragment_id}
                      data-entry-kind="explanation"
                      data-fragment-kind={fragment.kind}
                      data-attach-to-entry={fragment.attach_to_entry}
                    >
                      <span className="sr-only">{FRAGMENT_KIND_TEXT[fragment.kind]}：</span>
                      <MathText value={fragment.content} block />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
        {standaloneFragments.length > 0 ? (
          <div className="solution-board-group solution-board-fragments" data-group-id="explanation-fragments">
            {standaloneFragments.map((fragment) => (
              <div
                key={fragment.fragment_id}
                className="solution-board-line solution-board-fragment"
                data-entry-id={fragment.fragment_id}
                data-entry-kind="explanation"
                data-fragment-kind={fragment.kind}
              >
                <span className="sr-only">{FRAGMENT_KIND_TEXT[fragment.kind]}：</span>
                <MathText value={fragment.content} block />
              </div>
            ))}
          </div>
        ) : null}
        {review ? <p className="solution-board-review-note" role="status">已完成回顾：同一份板书的只读阅读模式。</p> : null}
      </div>
    </section>
  );
}
