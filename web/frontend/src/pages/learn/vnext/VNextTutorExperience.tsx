/**
 * F7 — vNext 学生体验（golden task 真实 Runtime 链的浏览器面）。
 *
 * 组合纪律（ADR-008/009/010 + f7-scope-ledger）：
 * - 只消费统一三视图：CoachPanelViewSurface（Coach rail）/ StudentWorkspace
 *   ViewSurface（geometry+board，geometry 槽注入 production 渲染器）/
 *   MainlineParticipationSurface（当前 Gate 的唯一主线输入）；
 * - 无第二 renderer/Board/Coach 状态机：一切教学事实来自服务端响应经
 *   fail-closed parse；草稿/选择/rail 开合是前端瞬时状态；
 * - Assistance（问/提示/换说法）与 inquiry 分支作答走类型化 intent channel
 *   （ask_question/request_scaffold/request_rephrase/submit_answer/confirm/
 *   return_to_mainline），不出现通用聊天输入；
 * - refresh/reconnect：?session= → GET restore（服务端 rebuilt state），
 *   localStorage 不推导教学事实。
 */
import { useCallback, useEffect, useState } from "react";

import type { TopicGeometryModel } from "../../../../../shared/topicPractice";
import { useVNextTutorSession } from "../../../action-runtime/vnext/useVNextTutorSession";
import { FocusWorkspace } from "../../../components/layout/FocusWorkspace";
import { CoachPanelViewSurface } from "../../../presentation/canonicalView/CoachPanelViewSurface";
import { MainlineParticipationSurface } from "../../../presentation/canonicalView/MainlineParticipationSurface";
import { StudentWorkspaceViewSurface } from "../../../presentation/canonicalView/StudentWorkspaceViewSurface";
import { LearnQuestionPrompt } from "../../../presentation/workspace/LearnQuestionPrompt";
import { TopicCoachDockTrigger } from "../../../presentation/coach/TopicCoachPanel";
import { VNextGeometryWorkspace } from "./VNextGeometryWorkspace";

export interface VNextTutorExperienceProps {
  taskId: string;
  studentId: string;
  restoreSessionId?: string;
}

export function VNextTutorExperience({ taskId, studentId, restoreSessionId }: VNextTutorExperienceProps) {
  const { state, submitIntent, submitWorkspaceCommand, start } = useVNextTutorSession({ taskId, studentId, restoreSessionId });
  const [railOpen, setRailOpen] = useState(true);
  const [assistanceMode, setAssistanceMode] = useState<"none" | "ask">("none");
  const [askDraft, setAskDraft] = useState("");
  const [inquiryDraft, setInquiryDraft] = useState("");

  // 会话 id 落 URL（refresh 走 GET restore）。
  useEffect(() => {
    if (!state.sessionId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("session") === state.sessionId) return;
    url.searchParams.set("session", state.sessionId);
    window.history.replaceState(null, "", url.toString());
  }, [state.sessionId]);

  const session = state.session;
  const busy = state.busy;
  const participation = session?.workspaceView.participation;
  const inquiryActive = participation?.kind === "temporarily_paused_for_inquiry";
  const completed = session?.completed ?? false;

  const submitAnswer = useCallback((text: string) => void submitIntent("submit_answer", text), [submitIntent]);

  const rail = session ? (
    <div className="vnext-coach-rail">
      <CoachPanelViewSurface
        view={session.coachView}
        onAsk={() => setAssistanceMode("ask")}
        onRequestHint={() => void submitIntent("request_scaffold")}
        onRequestRephrase={() => void submitIntent("request_rephrase")}
        onReplay={() => undefined}
      />
      {assistanceMode === "ask" && !completed && !busy ? (
        <form
          className="vnext-assistance-composer"
          data-testid="vnext-assistance-composer"
          aria-label="向老师提问"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = askDraft.trim();
            if (!trimmed) return;
            setAskDraft("");
            setAssistanceMode("none");
            void submitIntent("ask_question", trimmed);
          }}
        >
          <input
            value={askDraft}
            aria-label="你的问题"
            placeholder="想问老师什么？"
            onChange={(event) => setAskDraft(event.target.value)}
          />
          <button type="submit" className="btn btn-primary" data-testid="vnext-submit-question" disabled={!askDraft.trim()}>提问</button>
          <button type="button" className="btn btn-ghost" onClick={() => setAssistanceMode("none")}>取消</button>
        </form>
      ) : null}
      {inquiryActive ? (
        <section className="vnext-inquiry-dialog" data-testid="vnext-inquiry-dialog" aria-label="答疑对话">
          <p className="canonical-participation-status">
            <strong>老师正在回答你的问题</strong>
            {participation.return_checkpoint_id ? <span className="sr-only">（完成后返回主线检查点 {participation.return_checkpoint_id}）</span> : null}
          </p>
          <form
            className="tutor-participation"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = inquiryDraft.trim();
              if (!trimmed) return;
              setInquiryDraft("");
              submitAnswer(trimmed);
            }}
          >
            <input
              value={inquiryDraft}
              aria-label="回答老师的问题"
              placeholder="说说你卡在哪里"
              onChange={(event) => setInquiryDraft(event.target.value)}
            />
            <button type="submit" data-testid="vnext-inquiry-answer" disabled={!inquiryDraft.trim() || busy}>回答</button>
          </form>
          <div className="action-row">
            <button type="button" className="btn btn-ghost" data-testid="vnext-inquiry-confirm" disabled={busy} onClick={() => void submitIntent("confirm")}>
              确认
            </button>
            {session.coachView.inquiry.kind === "ready_to_return" ? (
              <button type="button" className="btn btn-primary" data-testid="vnext-inquiry-return" disabled={busy} onClick={() => void submitIntent("return_to_mainline")}>
                返回主线
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  ) : (
    <aside className="topic-coach-panel" aria-label="陪练老师">正在连接老师…</aside>
  );

  const geometry = (
    <VNextGeometryWorkspace
      geometry={state.geometry as TopicGeometryModel | undefined}
      interactionEnabled={session?.workspaceView.canvas.interaction_enabled ?? false}
      busy={busy}
      onSubmitMarkKnown={(input) =>
        void submitWorkspaceCommand({
          surface: "geometry",
          capability: "similarity.mark-known-segments",
          targetIds: input.targetIds,
          params: { values: input.values },
        })
      }
    />
  );

  const statusNotes = (
    <>
      {state.error ? (
        <p className="tutor-learn-error" role="alert" data-testid="vnext-error">
          {state.error.code === "SESSION_NOT_FOUND" ? "会话已失效，正在重新开始…" : `服务暂不可用（${state.error.code}），请重试。`}
        </p>
      ) : null}
      {state.parseIssues ? (
        <div className="region-error" role="alert" data-testid="vnext-region-error">
          <strong>视图数据异常，已停止渲染。</strong>
          <ul>{state.parseIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      ) : null}
      {state.lastTurnFailure && !busy ? (
        <p className="tutor-learn-notice" role="status" data-testid="vnext-turn-failure">
          {state.lastTurnFailure.failure_class === "revision_conflict" ? "页面状态已过期，请重试一次。" : `上一轮未生效（${state.lastTurnFailure.failure_class}）。`}
        </p>
      ) : null}
      {state.phase === "recovering" ? (
        <button type="button" className="tutor-session-control" data-testid="vnext-retry" onClick={() => (restoreSessionId && state.sessionId ? void start() : void start())}>重试</button>
      ) : null}
    </>
  );

  return (
    <div
      className="ks-focus-page tutor-learn-page vnext-learn-page"
      data-testid="page-lifecycle"
      data-lifecycle={state.phase === "ready" ? "ready" : state.phase}
      data-session-id={state.sessionId ?? ""}
      data-tutor-phase={state.phase}
      data-participation-kind={participation?.kind ?? ""}
      data-route="tutor-vnext"
    >
      <FocusWorkspace
        ariaLabel={completed ? "一对一学习完成" : "一对一学习工作台"}
        prompt={<LearnQuestionPrompt stem={state.question?.stem} />}
        rail={
          <div className="vnext-rail-stack">
            {rail}
            {statusNotes}
          </div>
        }
        railOpen={railOpen}
        railTrigger={<TopicCoachDockTrigger avatarId="school" speaking={false} open={railOpen} unread={false} onOpen={() => setRailOpen(true)} />}
        actionEnd={
          session && participation ? (
            <MainlineParticipationSurface
              participation={participation}
              onSubmitAnswer={submitAnswer}
              onConfirm={() => void submitIntent("confirm")}
              onContinue={() => void submitIntent("continue")}
            />
          ) : (
            <p className="canonical-participation-note" role="status">正在准备学习会话…</p>
          )
        }
      >
        {session ? (
          <StudentWorkspaceViewSurface view={session.workspaceView} geometry={geometry} />
        ) : (
          <p className="student-workspace-empty-note" role="status">正在准备画布与板书…</p>
        )}
      </FocusWorkspace>
    </div>
  );
}
