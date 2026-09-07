import { useLayoutEffect, useRef, type ReactNode } from "react";

import { MathText } from "../../components/math/MathText";

/**
 * canonical Topic Coach Panel（ADR-010 §2 CoachPanel 结构）——从
 * ActionRuntimeFrame 内联 JSX 抽出的纯展示组件，reference 页与 Tutor
 * 学习页共用（VS1 remediation-2：Coach interaction parity）。
 *
 * - 类名/aria/DOM 与抽取前 1:1（reference 页零行为变化门禁）；
 * - additive data-testid（coach-progress/coach-title/coach-prompt）供三页
 *   共用 e2e 锚点；
 * - 可选槽（extraHeaderControls/statusNotes/realtime/footerControls）仅在
 *   调用方提供时渲染——canonical（ActionRuntimeFrame）不传，DOM 不变。
 */
export interface TopicCoachTurn {
  id: string;
  role: "student" | "coach";
  text: string;
  pending?: boolean;
  error?: boolean;
}

export interface TopicCoachPanelProps {
  tone: string;
  avatarId: string;
  /** 缺省不渲染拍点行（canonical/有拍点数据的调用方必传）。 */
  progress?: { label: string; current: number; total: number };
  title: string;
  promptLatex: string;
  feedback?: {
    active: boolean;
    tone: string;
    focusTargetId?: string;
    messageLatex: string;
  };
  autoplayBlocked?: boolean;
  thread: TopicCoachTurn[];
  /** Assistance composer（ADR-010：恒为提问通道，kind 由调用方决定）。 */
  canHelp: boolean;
  message: string;
  onMessageChange: (value: string) => void;
  onAsk: () => void;
  inputDisabled?: boolean;
  micDisabled?: boolean;
  recording?: boolean;
  onToggleRecorder?: () => void;
  /** busy 时呈现「老师正在…」状态行（canonical 文案缺省）。 */
  busy?: boolean;
  busyNote?: ReactNode;
  onReplay: () => void;
  replayDisabled?: boolean;
  onClose: () => void;
  /** canonical 实时对话块（仅 ActionRuntimeFrame 传入；tutor 恒不传）。 */
  realtime?: ReactNode;
  /** canonical agentCommand 确认按钮（仅 guided-practice 链路传入）。 */
  footerControls?: ReactNode;
  /** tutor 会话级控件（换讲法/继续学习/重试）——canonical 不传。 */
  extraHeaderControls?: ReactNode;
  /** tutor 附加状态行（错误/等待回应等）——canonical 不传。 */
  statusNotes?: ReactNode;
}

export function TopicCoachPanel({
  tone,
  avatarId,
  progress,
  title,
  promptLatex,
  feedback,
  autoplayBlocked,
  thread,
  canHelp,
  message,
  onMessageChange,
  onAsk,
  inputDisabled,
  micDisabled,
  recording,
  onToggleRecorder,
  busy,
  busyNote = "老师正在结合当前解题状态回答…",
  onReplay,
  replayDisabled,
  onClose,
  realtime,
  footerControls,
  extraHeaderControls,
  statusNotes,
}: TopicCoachPanelProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const firstTurnId = thread[0]?.id;
  const lastTurn = thread[thread.length - 1];
  useLayoutEffect(() => { followLatest.current = true; }, [firstTurnId]);
  useLayoutEffect(() => {
    const node = threadRef.current;
    if (node && followLatest.current) node.scrollTop = node.scrollHeight;
  }, [firstTurnId, lastTurn?.id, lastTurn?.text, thread.length]);
  return (
    <aside className={`topic-coach-panel tone-${tone}`} aria-label="陪练老师" aria-live="polite">
      <div className="topic-coach-header" data-testid="region-status" aria-label="学习状态">
        <span className="topic-coach-avatar material-symbols-outlined">{avatarId}</span>
        <div>{progress ? <small data-testid="coach-progress">{progress.label} {progress.current}/{progress.total}</small> : null}<strong data-testid="coach-title">{title}</strong></div>
        {extraHeaderControls}
        <button type="button" className="topic-coach-sound" aria-label="重播老师语音" disabled={replayDisabled} onClick={onReplay}><span className="material-symbols-outlined">volume_up</span></button>
        <button type="button" className="topic-coach-close" aria-label="收起指导栏" onClick={onClose}><span className="material-symbols-outlined">right_panel_close</span></button>
      </div>
      <div className="topic-coach-bubble" data-testid="coach-prompt" aria-label="当前 Action 讲解"><MathText value={promptLatex} block /></div>
      {feedback?.active ? (
        <div
          className="topic-coach-message"
          role="status"
          aria-live="polite"
          data-testid="training-feedback"
          data-feedback-tone={feedback.tone}
          data-feedback-focus={feedback.focusTargetId}
        >
          <MathText value={feedback.messageLatex} block />
        </div>
      ) : null}
      {autoplayBlocked ? <p className="topic-coach-recording" role="status">浏览器已阻止自动播放，请点右上角扬声器开始朗读。</p> : null}
      {statusNotes}
      {thread.length ? <div className="topic-coach-thread" aria-label="答疑对话" ref={threadRef} onScroll={(event) => {
        const node = event.currentTarget;
        followLatest.current = node.scrollHeight - node.clientHeight - node.scrollTop < 40;
      }}>{thread.map((turn) => (
        <div key={turn.id} className={`topic-coach-turn is-${turn.role}${turn.pending ? " is-pending" : ""}${turn.error ? " is-error" : ""}`}>
          <small>{turn.role === "student" ? "学生" : "老师"}</small>
          {turn.role === "coach" ? <MathText value={turn.text} /> : <p>{turn.text}</p>}
        </div>
      ))}</div> : null}
      {realtime}
      {canHelp ? <div className="topic-coach-composer">
        <label className="topic-coach-question"><span className="sr-only">向老师提问</span><input value={message} placeholder="文字或语音问老师" disabled={inputDisabled} onKeyDown={(event) => { if (event.key === "Enter") onAsk(); }} onChange={(event) => onMessageChange(event.target.value)} /></label>
        <button type="button" className={`topic-coach-mic${recording ? " is-recording" : ""}`} aria-label={recording ? "结束录音" : "语音提问"} disabled={micDisabled} onClick={() => onToggleRecorder?.()}><span className="material-symbols-outlined">{recording ? "stop_circle" : "mic"}</span></button>
        <button type="button" className="topic-coach-send" aria-label="发送问题" disabled={inputDisabled || !message.trim()} onClick={onAsk}><span className="material-symbols-outlined">send</span></button>
      </div> : null}
      {recording ? <p className="topic-coach-recording" role="status"><span />正在听，点停止后发送（最长 45 秒）</p> : null}
      {busy ? <p className="topic-coach-thinking" role="status">{busyNote}</p> : null}
      {footerControls}
    </aside>
  );
}

/** canonical dock 头像触发器（收起态入口：未读点 + ~6s 预览气泡由调用方
 *  维护——瞬时 UI，不改教学事实，ADR-010 §5）。 */
export function TopicCoachDockTrigger({ avatarId, speaking, open, unread, previewLatex, onOpen }: {
  avatarId: string;
  speaking?: boolean;
  open: boolean;
  unread?: boolean;
  previewLatex?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`topic-coach-dock-avatar${speaking ? " is-speaking" : ""}`}
      aria-label={open ? "陪练老师" : "展开陪练老师"}
      aria-expanded={open}
      onClick={onOpen}
    >
      <span className="material-symbols-outlined">{avatarId}</span>
      {unread ? <span className="topic-coach-dock-unread" aria-hidden /> : null}
      {previewLatex ? (
        <span className="topic-coach-dock-preview" role="status" aria-live="polite">
          <MathText value={previewLatex} />
        </span>
      ) : null}
    </button>
  );
}
