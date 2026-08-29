/**
 * fe-prep（2026-08-28）：MainlineParticipation（view/v1）→ 主线参与区
 * （region-participation）纯渲染。
 *
 * ADR-010：当前 Gate 的**唯一**主线输入——7 个受控 kind 各自映射唯一的
 * 参与形态；不渲染通用聊天输入（Assistance Entry 在 Coach Panel，是另一
 * 个 intent channel）。answer 草稿是前端瞬时状态（ADR-010 §5），不事件化、
 * 不写教学事实；提交回调由 F6/F7 接线，本轨只保证 UI/keyboard/aria 语义。
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";

import type { EmbeddedMainlineParticipation, MainlineParticipationKind } from "./canonicalViewTypes";

const KIND_STATUS_TEXT: Record<MainlineParticipationKind, string> = {
  listen_only: "听老师讲解",
  answer_input: "等待你的回答",
  workspace_input: "等待你在画布上操作",
  confirm_input: "等待你确认",
  continue_input: "可以继续下一步",
  temporarily_paused_for_inquiry: "答疑中——主线已暂停",
  read_only_completed: "本题已完成（只读回顾）",
};

export interface MainlineParticipationSurfaceProps {
  participation: EmbeddedMainlineParticipation;
  /** answer 提交回调（F6/F7 接线；fe-prep 缺省仅清空草稿）。 */
  onSubmitAnswer?: (text: string) => void;
  /** confirm/continue 提交回调（F6/F7 接线）。 */
  onConfirm?: () => void;
  onContinue?: () => void;
}

export function MainlineParticipationSurface({
  participation,
  onSubmitAnswer,
  onConfirm,
  onContinue,
}: MainlineParticipationSurfaceProps) {
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const { kind, gate_id: gateId, action_id: actionId, return_checkpoint_id: returnCheckpointId } = participation;

  let control: ReactNode;
  if (kind === "answer_input") {
    control = (
      <span className="canonical-participation-answer">
        <label htmlFor={inputId} className="sr-only">回答输入</label>
        <input
          id={inputId}
          value={draft}
          placeholder="说说这一步你是怎么想的"
          aria-label="回答输入"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" data-testid="canonical-submit-answer" disabled={!draft.trim()}>回答</button>
      </span>
    );
  } else if (kind === "workspace_input") {
    control = (
      <p className="canonical-participation-note" role="status">
        按老师要求在画布上操作{actionId ? `（操作 ${actionId}）` : ""}
      </p>
    );
  } else if (kind === "confirm_input") {
    control = (
      <button type="button" className="btn btn-primary" data-testid="canonical-participation-confirm" onClick={() => onConfirm?.()}>
        确认
      </button>
    );
  } else if (kind === "continue_input") {
    control = (
      <button type="button" className="btn btn-primary" data-testid="canonical-participation-continue" onClick={() => onContinue?.()}>
        继续
      </button>
    );
  } else if (kind === "temporarily_paused_for_inquiry") {
    control = (
      <p className="canonical-participation-note" role="status">
        {returnCheckpointId ? `答疑完成后返回主线检查点 ${returnCheckpointId}` : "答疑完成后返回主线"}
      </p>
    );
  } else {
    control = <p className="canonical-participation-note" role="status">{KIND_STATUS_TEXT[kind]}</p>;
  }

  return (
    <form
      className="tutor-participation canonical-participation"
      data-testid="region-participation"
      aria-label="主线参与"
      data-participation-kind={kind}
      data-gate-id={gateId}
      data-action-id={actionId}
      data-return-checkpoint-id={returnCheckpointId}
      onSubmit={(event) => {
        event.preventDefault();
        if (kind === "answer_input" && draft.trim()) {
          onSubmitAnswer?.(draft.trim());
          setDraft("");
        }
      }}
    >
      <p className="canonical-participation-status">
        <strong>{KIND_STATUS_TEXT[kind]}</strong>
        {gateId ? <span className="sr-only">（检查门 {gateId}）</span> : null}
      </p>
      {control}
    </form>
  );
}
