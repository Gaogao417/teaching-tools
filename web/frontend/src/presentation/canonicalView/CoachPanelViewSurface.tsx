/**
 * fe-prep（2026-08-28）：CoachPanelView（view/v1）→ Coach Panel 纯渲染
 *（ADR-010 §2 canonical 结构：ContextHeader / TeachingFocusCue /
 * CurrentTutorTurn / Assistance / Transcript）。
 *
 * - mainline 是受控 7 值状态：Panel 必须明确说明当前在呈现/等待回答/
 *   等待操作/等待确认/可继续/恢复中/完成（拒绝"通用等你发言"式呈现）；
 * - inquiry 活跃时 return point 必须可见（不变量 3）；
 * - Assistance Entry 与主线 Participation 是两个 intent channel：本面板
 *   不承载主线输入（region-participation 在参与区）；
 * - replay/collapse/draft 是前端瞬时行为，不推进教学状态（不变量 5）——
 *   本轨 replay/assistance 仅回调，不写任何状态。
 */
import { MathText } from "../../components/math/MathText";
import type { CoachPanelViewV1 } from "./canonicalViewTypes";

const MAINLINE_STATUS_TEXT: Record<string, string> = {
  presenting: "老师讲解中",
  awaiting_answer: "等待你回答",
  awaiting_workspace: "等待你在画布上操作",
  awaiting_confirmation: "等待你确认",
  ready_to_continue: "可以继续",
  recovering: "正在恢复会话",
  completed: "本小节完成",
};

const INQUIRY_STATUS_TEXT = {
  clarifying: "澄清你的问题中",
  supporting: "提供支持中",
  ready_to_return: "答疑完成，可以返回主线",
} as const;

export interface CoachPanelViewSurfaceProps {
  view: CoachPanelViewV1;
  /** Assistance 三入口回调（F6/F7 接线；fe-prep 缺省无操作）。 */
  onAsk?: () => void;
  onRequestHint?: () => void;
  onRequestRephrase?: () => void;
  /** Voice replay 回调（瞬时行为，不推进教学状态）。 */
  onReplay?: () => void;
}

export function CoachPanelViewSurface({ view, onAsk, onRequestHint, onRequestRephrase, onReplay }: CoachPanelViewSurfaceProps) {
  const { teaching_context: teachingContext } = view;
  const mainlineStatus = `${MAINLINE_STATUS_TEXT[view.mainline.kind]}${mainlineRef(view.mainline)}`;
  const hasInquiry = view.inquiry.kind !== "no_inquiry";
  const inquiryStatus = (() => {
    if (view.inquiry.kind === "no_inquiry") return { kind: null as null, returnCheckpointId: null as null };
    return { kind: INQUIRY_STATUS_TEXT[view.inquiry.kind], returnCheckpointId: view.inquiry.return_checkpoint_id };
  })();
  return (
    <aside
      className="topic-coach-panel canonical-coach-panel"
      aria-label="陪练老师"
      data-testid="canonical-coach-panel"
      data-view-revision={view.revision}
      data-session-id={view.session_id}
      data-mainline-kind={view.mainline.kind}
    >
      <div className="topic-coach-header" data-testid="region-status" aria-label="学习状态">
        <span className="topic-coach-avatar material-symbols-outlined" aria-hidden="true">school</span>
        <div>
          {teachingContext.student_facing_progress ? <small data-testid="coach-progress">{teachingContext.student_facing_progress}</small> : null}
          <strong data-testid="coach-mainline-status">{mainlineStatus}</strong>
          {teachingContext.waiting_for ? <small data-testid="coach-waiting-for">正在等：{teachingContext.waiting_for}</small> : null}
        </div>
        <button
          type="button"
          className="topic-coach-sound"
          aria-label="重播老师语音"
          data-testid="coach-replay"
          disabled={!view.replay_available}
          onClick={() => onReplay?.()}
        >
          <span className="material-symbols-outlined" aria-hidden="true">volume_up</span>
        </button>
      </div>
      {teachingContext.focus_cue || teachingContext.waiting_for ? (
        <div className="topic-coach-bubble" data-testid="coach-focus-cue" aria-label="当前教学关注点">
          <MathText value={teachingContext.focus_cue ?? teachingContext.waiting_for ?? ""} block />
        </div>
      ) : null}
      {view.current_tutor_turn ? (
        <div className="topic-coach-message" role="status" aria-live="polite" data-testid="coach-current-turn" aria-label="当前老师话术">
          <MathText value={view.current_tutor_turn} block />
        </div>
      ) : null}
      {hasInquiry ? (
        <p
          className="topic-coach-inquiry"
          role="status"
          data-testid="coach-inquiry"
          data-inquiry-kind={view.inquiry.kind}
          data-return-checkpoint-id={inquiryStatus.returnCheckpointId ?? undefined}
        >
          {inquiryStatus.kind}——完成后返回主线检查点 <strong data-testid="coach-inquiry-return">{inquiryStatus.returnCheckpointId}</strong>
        </p>
      ) : null}
      {view.transcript.length ? (
        <div className="topic-coach-thread" aria-label="答疑对话" data-testid="coach-transcript">
          {view.transcript.map((turn) => (
            <div
              key={turn.turn_id}
              className={`topic-coach-turn is-${turn.role === "tutor" ? "coach" : "student"}`}
              data-turn-id={turn.turn_id}
              data-beat-id={turn.beat_id}
              data-inquiry-id={turn.inquiry_id}
            >
              <small>{turn.role === "tutor" ? "老师" : "学生"}</small>
              {turn.role === "tutor" ? <MathText value={turn.content} /> : <p>{turn.content}</p>}
            </div>
          ))}
        </div>
      ) : null}
      {view.assistance_available && view.mainline.kind !== "completed" ? (
        <div className="topic-coach-assistance" role="group" aria-label="求助入口（不影响主线）" data-testid="coach-assistance">
          <button type="button" className="btn btn-ghost" data-testid="coach-ask" onClick={() => onAsk?.()}>问老师</button>
          <button type="button" className="btn btn-ghost" data-testid="coach-hint" onClick={() => onRequestHint?.()}>给点提示</button>
          <button type="button" className="btn btn-ghost" data-testid="coach-rephrase" onClick={() => onRequestRephrase?.()}>换种说法</button>
        </div>
      ) : null}
    </aside>
  );
}

function mainlineRef(mainline: CoachPanelViewV1["mainline"]): string {
  if (mainline.kind === "completed") return "";
  if (mainline.kind === "presenting") return `（${mainline.beat_id}）`;
  if (mainline.kind === "recovering") return `（检查点 ${mainline.checkpoint_id}）`;
  if (mainline.kind === "awaiting_workspace") return `（${mainline.gate_id} · ${mainline.action_id}）`;
  return `（${mainline.gate_id}）`;
}
