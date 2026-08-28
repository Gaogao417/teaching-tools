import type { ReactNode } from "react";

/**
 * canonical 教学播放控件（VS1 remediation-2 从 ActionRuntimeFrame 抽出）：
 * 播放组（回到第一个/上一段/重播/下一段 + 位置）与「这步没懂/明白，继续」
 * 对。DOM/aria 与抽取前 1:1（reference 页零行为变化门禁）；additive
 * data-testid（coach-understood/coach-confused）供 e2e 锚点。
 *
 * 组件纯展示：启用/禁用与回调语义由调用方决定——ActionRuntimeFrame 走
 * runtime.seekTeaching/advanceTeaching；Tutor 学习页走呈现层指针（放行恰
 * 一步话术，绝不写会话状态，ADR-010 不变量 5）。
 */
export interface TopicTeachingPlaybackProps {
  positionLabel?: string;
  positionCurrent: number;
  positionTotal: number;
  firstDisabled?: boolean;
  previousDisabled?: boolean;
  replayDisabled?: boolean;
  nextDisabled?: boolean;
  onFirst: () => void;
  onPrevious: () => void;
  onReplay: () => void;
  onNext: () => void;
  pauseNote: ReactNode;
}

export function TopicTeachingPlayback({
  positionLabel = "Action",
  positionCurrent,
  positionTotal,
  firstDisabled,
  previousDisabled,
  replayDisabled,
  nextDisabled,
  onFirst,
  onPrevious,
  onReplay,
  onNext,
  pauseNote,
}: TopicTeachingPlaybackProps) {
  return (
    <div className="topic-action-playback" role="group" aria-label="Action 播放面板">
      <button type="button" className="topic-action-playback-button" aria-label="回到第一个 Action" title="回到第一个 Action" disabled={firstDisabled} onClick={onFirst}><span className="material-symbols-outlined">first_page</span></button>
      <button type="button" className="topic-action-playback-button" aria-label="上一个 Action" title="上一个 Action" disabled={previousDisabled} onClick={onPrevious}><span className="material-symbols-outlined">skip_previous</span></button>
      <span className="topic-action-playback-position"><strong>{positionLabel} {positionCurrent}</strong><small>/ {positionTotal}</small></span>
      <button type="button" className="topic-action-playback-button" aria-label="重播当前 Action 讲解" title="重播当前 Action 讲解" disabled={replayDisabled} onClick={onReplay}><span className="material-symbols-outlined">replay</span></button>
      <button type="button" className="topic-action-playback-button is-primary" aria-label="下一个 Action" title="播放到下一个 Action" disabled={nextDisabled} onClick={onNext}><span className="material-symbols-outlined">skip_next</span></button>
      <span className="topic-teaching-pause"><span className="material-symbols-outlined">pause_circle</span>{pauseNote}</span>
    </div>
  );
}

export interface TopicTeachingConfirmProps {
  confusedDisabled?: boolean;
  understoodDisabled?: boolean;
  understoodLabel?: ReactNode;
  onConfused: () => void;
  onUnderstood: () => void;
}

export function TopicTeachingConfirm({
  confusedDisabled,
  understoodDisabled,
  understoodLabel = "明白，继续",
  onConfused,
  onUnderstood,
}: TopicTeachingConfirmProps) {
  return (
    <div className="action-row topic-teaching-controls">
      <button type="button" className="btn btn-ghost" data-testid="coach-confused" disabled={confusedDisabled} onClick={onConfused}>这步没懂</button>
      <button type="button" className="btn btn-primary" data-testid="coach-understood" disabled={understoodDisabled} onClick={onUnderstood}>{understoodLabel}</button>
    </div>
  );
}
