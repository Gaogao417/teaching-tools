/**
 * Tutor 驱动的学习工作台（Phase 5 UI 集成 / 计划 §3，/learn/:taskId 的
 * kind=tutor 分支）。
 *
 * - WorkspaceShell / Topic 导航 / 学生身份 / URL 全部沿用（本组件渲染在
 *   LearnPage 的 Outlet 内）；
 * - Question 题干/小问来自 /experience 学生安全面；
 * - Opening/TutorMove 走现有 narration/media 管线（自动播放、barge-in、
 *   autoplay-blocked 重播提示）；
 * - VS1 remediation-2（2026-08-26 第二轮 Rejected 后，ADR-010）：三态
 *   （teach/operate/completed）渲染同一 canonical `TopicCoachPanel` +
 *   `TopicTeachingControls`——删除页面级自建 rail/「回答/提问」模式切换/
 *   快捷 chips；信息结构回到「教学拍点 N/M + 当前标题 + 当前拍 Focus
 *   Cue」；主线回答属 Participation（action bar 回答入口，
 *   reasoning_utterance），Assistance 恒为提问通道（question_asked），
 *   kind 不由前端 phase 猜（ADR-010 §2/§3）；
 * - 「明白，继续」= presentation advance（放行当前回合话术恰一步）；
 *   「上一拍/回开头」= 纯回看不回退会话状态（remediation-2 裁定 1/2）；
 * - Workspace 用真实 ActionRuntimeFrame（transport → TutorSession typed
 *   evaluator），操作分支经 railContent 注入同一 canonical Panel；
 * - 同题换讲法（alternates_available）保留（extraHeaderControls 槽）；
 *   完成页板书回顾自 VS1 起来自统一 workspace_view（L-05）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ActionRuntimeFrame } from "../../presentation/runtime/ActionRuntimeFrame";
import { useTutorLearning } from "../../action-runtime/tutor/useTutorLearning";
import { LearnQuestionPrompt } from "../../presentation/workspace/LearnQuestionPrompt";
import { ReadOnlyGeometrySurface, StudentBoardSurface, StudentWorkspaceFrame } from "../../presentation/workspace/StudentWorkspaceFrame";
import { StudentWorkspaceViewSurface } from "../../presentation/canonicalView/StudentWorkspaceViewSurface";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { TopicCoachDockTrigger, TopicCoachPanel, type TopicCoachTurn } from "../../presentation/coach/TopicCoachPanel";
import { TopicTeachingConfirm, TopicTeachingPlayback } from "../../presentation/coach/TopicTeachingControls";
import { AcceptanceDiagnostics } from "../../presentation/acceptance/AcceptanceDiagnostics";
import { useCoachRecorder } from "../../presentation/coach/useCoachRecorder";
import { api } from "../../api/client";
import { topicNodeByTaskId } from "../../../../shared/similarityLearningMap";
import type { TaskId } from "../../../../shared/contracts";
import type { TutorExperienceResponse } from "../../../../shared/tutorExperience";

/** canonical「这步没懂」话术（与参考实现 ActionRuntimeFrame 同文案）。 */
const CONFUSED_MESSAGE = "我没听懂这一步，请换一种说法，并说明为什么这样做。";

export interface TutorLearnExperienceProps {
  taskId: TaskId;
  studentId: string;
  /** 刷新恢复：URL ?session= 中的会话 id。 */
  restoreSessionId?: string;
  /** 页面（LearnPage）已拉取的 /experience 结果——组件直接采用，不重复建会话。 */
  initial?: TutorExperienceResponse;
  /** VS0 REQ-04：?acceptance=1 时渲染只读验收诊断（route=tutor-vnext 固定，
   *  sessionId/revision 来自本组件的会话事实）。 */
  acceptanceMode?: boolean;
  /** VS0 REQ-06：tutor 尝试后回退 legacy 的标记（由 LearnPage 传入）。 */
  fallbackOccurred?: boolean;
  /** /experience 返回 legacy（无 Approved Binding）→ 回退原 LearnPage。 */
  onLegacy: () => void;
  /** F7 vNext 数据源（canonical Runtime 链；availability 由 LearnPage 裁定后传入）。 */
  vnext?: boolean;
}

export function TutorLearnExperience({ taskId, studentId, restoreSessionId, initial, acceptanceMode, fallbackOccurred, onLegacy, vnext }: TutorLearnExperienceProps) {
  const navigate = useNavigate();
  const tutor = useTutorLearning({ taskId, studentId, restoreSessionId, ...(vnext ? { vnext: true } : {}) });
  const [questionDraft, setQuestionDraft] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [inquiryDraft, setInquiryDraft] = useState("");
  const [asrBusy, setAsrBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const startedRef = useRef(false);
  const progressRecordedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !studentId) return;
    startedRef.current = true;
    if (restoreSessionId) {
      void tutor.restore(restoreSessionId).then(async (outcome) => {
        // 会话不可恢复（如 backend 重启后的内存会话丢失）：清掉 ?session 并按
        // 默认 Binding 重新开始（同一 Question/讲法，不是静默换题换讲法）。
        // VS1 REQ-08：schema 非法 → recoverable error（错误已由 hook 设置、
        // phase=recovering 显示重试），不静默重开、不回旧渲染链。
        if (outcome === "missing") {
          const result = await tutor.start();
          if (result?.kind === "legacy") onLegacy();
        }
      });
      return;
    }
    if (initial) {
      tutor.adopt(initial);
      return;
    }
    void tutor.start().then((result) => {
      if (result?.kind === "legacy") onLegacy();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // 会话 id 落到 URL（replace 不产生历史栈），F5 后走 GET restore。
  useEffect(() => {
    if (!tutor.sessionId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("session") === tutor.sessionId) return;
    url.searchParams.set("session", tutor.sessionId);
    window.history.replaceState(null, "", url.toString());
  }, [tutor.sessionId]);

  useEffect(() => {
    if (!taskId || !studentId || !topicNodeByTaskId(taskId)) return;
    void api.recordSimilarityLearnProgress(taskId, studentNameSafe(studentId), "in_progress").catch(() => undefined);
  }, [studentId, taskId]);

  // 整题完成：记录 Topic 学习进度（现有进度 API）并关闭会话。
  useEffect(() => {
    if (!tutor.questionCompleted || progressRecordedRef.current) return;
    progressRecordedRef.current = true;
    if (taskId && topicNodeByTaskId(taskId)) {
      void api
        .recordSimilarityLearnProgress(taskId, studentNameSafe(studentId), "completed")
        .catch(() => undefined);
    }
    void tutor.finishQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor.questionCompleted]);

  /** Assistance（ADR-010：Panel composer 恒为提问通道——kind 不由前端
   *  phase 猜，语音提问同链路；语音回答入口让渡 VS5，偏差登记）。 */
  const submitQuestion = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setQuestionDraft("");
      void tutor.submitStudentInput({ input_kind: "question_asked", text: trimmed });
    },
    [tutor],
  );

  /** 主线回答（Mainline Participation）：服务端 participation 投影为
   *  teach（等待学生推理）时在 action bar 提交 reasoning_utterance。 */
  const submitAnswer = useCallback(
    () => {
      const trimmed = answerDraft.trim();
      if (!trimmed) return;
      setAnswerDraft("");
      void tutor.submitStudentInput({ input_kind: "reasoning_utterance", text: trimmed });
    },
    [answerDraft, tutor],
  );

  const recorder = useCoachRecorder({
    disabled: asrBusy || !tutor.sessionId,
    media: undefined,
    onAudio: (audio) => {
      if (!tutor.sessionId) return;
      setAsrBusy(true);
      setNotice("正在识别你的话…");
      api
        .tutorAsr(tutor.sessionId, { dataUrl: audio.dataUrl, durationMs: audio.durationMs })
        .then((result) => {
          setNotice(undefined);
          if (result.transcript.trim()) submitQuestion(result.transcript);
        })
        .catch(() => {
          setNotice("语音识别暂不可用，请用文字提问。");
        })
        .finally(() => setAsrBusy(false));
    },
    onError: (message) => setNotice(message),
  });

  const checkpoint = tutor.currentCheckpoint;
  const pres = tutor.presentation;
  const busy = tutor.phase === "thinking";
  const completed = tutor.phase === "completed" || tutor.questionCompleted;
  // VS1：操作步来自统一 View 的 participation 槽（服务端按会话权威 pending
  // 投影）；operate 态主线输入在工作区（Frame assessment 动作条）。
  const activeOperation = tutor.activeOperation;
  const operateActive = tutor.phase === "workspaceActive";
  const lastTutorEntry = [...tutor.transcript].reverse().find((entry) => entry.role === "tutor");

  // dock 开合（波次 E/F 语义保留）：三分支共享 railOpen；收起时新老师消息
  // 更新 dock 预览（~6s 消失）、未读点持续、展开清除——均为瞬时 UI。
  const [railOpen, setRailOpen] = useState(true);
  const [railUnread, setRailUnread] = useState(false);
  const [dockPreview, setDockPreview] = useState<{ id: string; text: string } | null>(null);
  const lastTranscript = tutor.transcript[tutor.transcript.length - 1];
  const lastPreviewId = useRef("");
  useEffect(() => {
    if (railOpen) return;
    if (lastTranscript?.role === "tutor" && lastTranscript.id !== lastPreviewId.current) {
      lastPreviewId.current = lastTranscript.id;
      setDockPreview({ id: lastTranscript.id, text: lastTranscript.text });
      setRailUnread(true);
    }
  }, [lastTranscript, railOpen]);
  useEffect(() => {
    if (!dockPreview) return;
    const timer = window.setTimeout(() => setDockPreview(null), 6000);
    return () => window.clearTimeout(timer);
  }, [dockPreview]);
  const openRail = (): void => {
    setRailOpen(true);
    setRailUnread(false);
    setDockPreview(null);
  };

  // VS1：完成页板书回顾来自统一 View（同一会话同一 projection；服务端在
  // question_completed 时披露整板——不是完成后再拉第二份 Board 真源）。
  const completedBoard = tutor.workspaceView?.solutionBoard;

  /** canonical Panel view-model（三态同一组件；ADR-010 §2 结构）。 */
  const coachThread: TopicCoachTurn[] = useMemo(
    () => tutor.transcript.map((entry) => ({
      id: entry.id,
      role: entry.role === "tutor" ? "coach" : "student",
      text: entry.text,
    })),
    [tutor.transcript],
  );
  const progress = checkpoint ? { label: "教学拍点", current: checkpoint.index, total: checkpoint.total } : undefined;
  const panelTitle = completed
    ? "本题讲解完成"
    : checkpoint?.title ?? (checkpoint ? `第${checkpoint.part_id}小问` : "老师讲解中");

  const statusNotes = (
    <>
      {tutor.error ? <p className="tutor-learn-error" role="alert" data-testid="tutor-error">{tutor.error}</p> : null}
      {vnext && tutor.vnextTurnFailure ? <p className="tutor-learn-notice" role="status" data-testid="vnext-turn-failure">上一轮未生效（{tutor.vnextTurnFailure}），请重试。</p> : null}
      {notice ? <p className="tutor-learn-notice" role="status">{notice}</p> : null}
      {pres.reviewing ? <p className="topic-coach-recording" role="status"><span />正在回看上一段讲解…</p> : null}
      {asrBusy ? <p className="topic-coach-recording" role="status"><span />正在识别你的话…</p> : null}
    </>
  );
  const extraHeaderControls = (
    <>
      {tutor.phase === "speaking" && !vnext && !pres.awaitingContinue && !pres.reviewing ? (
        <button type="button" className="tutor-session-control" data-testid="tutor-barge-in" onClick={() => void tutor.bargeIn()}>打断</button>
      ) : null}
      {tutor.phase === "interrupted" ? (
        <button type="button" className="tutor-session-control" onClick={tutor.resumeFromInterrupt}>继续学习</button>
      ) : null}
      {tutor.phase === "recovering" ? (
        <button type="button" className="tutor-session-control" data-testid="tutor-retry" onClick={() => void tutor.start()}>重试</button>
      ) : null}
      {tutor.alternatesAvailable && tutor.sessionId && !completed && !vnext ? (
        <button
          type="button"
          className="tutor-session-control"
          data-testid="tutor-switch-approach"
          disabled={busy}
          onClick={() => void tutor.start({ switchFromSessionId: tutor.sessionId })}
        >
          换讲法
        </button>
      ) : null}
    </>
  );

  const coachPanel = (
    <TopicCoachPanel
      tone={completed ? "correct" : "prompt"}
      avatarId="school"
      progress={progress}
      title={panelTitle}
      promptLatex={pres.currentText ?? lastTutorEntry?.text ?? ""}
      thread={coachThread}
      canHelp={!completed && Boolean(tutor.sessionId)}
      message={questionDraft}
      onMessageChange={setQuestionDraft}
      onAsk={() => submitQuestion(questionDraft)}
      inputDisabled={busy || asrBusy}
      micDisabled={busy || asrBusy}
      recording={recorder.recording}
      onToggleRecorder={() => void recorder.toggle()}
      busy={busy}
      busyNote="老师正在思考…"
      onReplay={() => tutor.replayNarration()}
      onClose={() => setRailOpen(false)}
      extraHeaderControls={extraHeaderControls}
      statusNotes={statusNotes}
    />
  );

  const dockTrigger = (
    <TopicCoachDockTrigger
      avatarId="school"
      speaking={pres.playing || pres.reviewing}
      open={railOpen}
      unread={railUnread}
      previewLatex={dockPreview?.text}
      onOpen={openRail}
    />
  );

  const diagnostics = acceptanceMode ? (
    <AcceptanceDiagnostics
      taskId={taskId}
      route="tutor-vnext"
      sessionId={tutor.sessionId}
      viewRevision={tutor.revision}
      workspaceRevision={tutor.workspaceView?.revision}
      fallbackOccurred={fallbackOccurred}
    />
  ) : null;

  // VS1 验收模式：只读暴露统一 StudentWorkspaceView（?acceptance=1 证据采集，
  // 与 VS0 的 __acceptanceWorkspaceView（Frame 内部投影）并存——本 hook 是
  // 服务端统一 View 的快照，供 refresh parity 深比较）。无参数不暴露。
  useEffect(() => {
    if (!acceptanceMode) return;
    (window as unknown as { __tutorWorkspaceView?: unknown }).__tutorWorkspaceView = tutor.workspaceView;
  }, [acceptanceMode, tutor.workspaceView]);

  // VS1 remediation：Learn Question 一体化进 FocusPrompt（stem + 带编号
  // subquestions），teach/operate/completed 三阶段同构。
  const learnPrompt = (
    <LearnQuestionPrompt stem={tutor.question?.stem} subquestions={tutor.question?.subquestions} />
  );

  // 页面根诊断属性（e2e/验收锚点）：session/checkpoint/phase 均为本页
  // 渲染所用的同一事实（非第二真源）。
  const pageAttributes = {
    "data-session-id": tutor.sessionId ?? "",
    "data-checkpoint-id": checkpoint?.checkpoint_id ?? "",
    "data-tutor-phase": tutor.phase,
  };

  /** 教学播放组（teach 态；operate=Frame assessment 动作条、completed 只读）。
   *  下一拍=放行恰一步（仅门态可点）；上一拍/回开头=纯回看；重播=当前拍。 */
  const teachingPlayback = !vnext && !completed && !operateActive ? (
    <TopicTeachingPlayback
      positionCurrent={Math.max(pres.playedCount, 1)}
      positionTotal={Math.max(pres.totalCount, 1)}
      firstDisabled={pres.playedCount <= 1 || pres.reviewing || busy}
      onFirst={() => void tutor.reviewFirstNarration()}
      previousDisabled={pres.playedCount <= 1 || pres.reviewing || busy}
      onPrevious={() => void tutor.reviewPreviousNarration()}
      replayDisabled={pres.reviewing || (!pres.currentText && !lastTutorEntry)}
      onReplay={() => tutor.replayNarration()}
      nextDisabled={!pres.awaitingContinue || pres.reviewing || busy}
      onNext={() => tutor.advancePresentation()}
      pauseNote={pres.playing ? "老师讲解中…" : "已暂停，等待学生回应后继续演示"}
    />
  ) : null;

  /** 主线回答入口：呈现队列走完（非讲解中/门态）且非操作/完成态时出现；
   *  提交 reasoning_utterance（服务端 participation 投影 teach 态）。 */
  const answerVisible = !vnext && !completed && !operateActive && !pres.playing && !pres.awaitingContinue
    && !busy && !tutor.error && Boolean(tutor.sessionId);
  const participationForm = answerVisible ? (
    <form
      className="tutor-participation"
      data-testid="region-participation"
      aria-label="回答老师"
      onSubmit={(event) => {
        event.preventDefault();
        submitAnswer();
      }}
    >
      <input
        value={answerDraft}
        placeholder="说说这一步你是怎么想的"
        aria-label="回答输入"
        onChange={(event) => setAnswerDraft(event.target.value)}
      />
      <button type="submit" data-testid="tutor-submit-answer" disabled={!answerDraft.trim()}>回答</button>
    </form>
  ) : null;

  const teachingConfirm = !vnext && !completed && !operateActive ? (
    <TopicTeachingConfirm
      confusedDisabled={busy || !tutor.sessionId}
      onConfused={() => submitQuestion(CONFUSED_MESSAGE)}
      understoodDisabled={!pres.awaitingContinue || pres.reviewing || busy}
      understoodLabel={pres.awaitingContinue ? "明白，继续" : "等待你的回应"}
      onUnderstood={() => tutor.advancePresentation()}
    />
  ) : null;

  if (activeOperation && tutor.sessionId && !completed) {
    return (
      <>
        {diagnostics}
        <div className="ks-focus-page tutor-learn-page" data-testid="page-lifecycle" data-lifecycle="ready" {...pageAttributes}>
          <ActionRuntimeFrame
            response={{ sessionId: tutor.sessionId, plan: activeOperation.plan }}
            transport={tutor.transport}
            boardView={tutor.workspaceView?.solutionBoard}
            viewRevision={tutor.workspaceView?.revision}
            questionPrompt={learnPrompt}
            railContent={coachPanel}
            railTrigger={dockTrigger}
            railOpen={railOpen}
            onRailOpenChange={(open) => {
              setRailOpen(open);
              if (open) {
                setRailUnread(false);
                setDockPreview(null);
              }
            }}
          />
        </div>
      </>
    );
  }

  // F7 vNext 参与区：canonical participation kind 驱动（类型化 intent；无通用聊天）。
  const vnextParticipationBar = vnext ? (() => {
    const kind = tutor.vnextParticipationKind;
    if (tutor.vnextCompleted || kind === "read_only_completed") {
      return <p className="canonical-participation-note" role="status" data-testid="vnext-participation">本题已完成（只读回顾）。</p>;
    }
    if (kind === "workspace_input") {
      return <p className="canonical-participation-note" role="status" data-testid="vnext-participation">按老师要求在画布上完成标注操作。</p>;
    }
    if (kind === "temporarily_paused_for_inquiry") {
      return (
        <div className="vnext-inquiry-dialog" data-testid="vnext-inquiry-dialog">
          <form
            className="tutor-participation"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = inquiryDraft.trim();
              if (!trimmed) return;
              setInquiryDraft("");
              void tutor.vnextSubmitIntent("submit_answer", trimmed);
            }}
          >
            <input value={inquiryDraft} aria-label="回答老师的问题" placeholder="说说你卡在哪里" onChange={(event) => setInquiryDraft(event.target.value)} />
            <button type="submit" data-testid="vnext-inquiry-answer" disabled={!inquiryDraft.trim() || busy}>回答</button>
          </form>
          <div className="action-row">
            <button type="button" className="btn btn-ghost" data-testid="vnext-inquiry-confirm" disabled={busy} onClick={() => void tutor.vnextSubmitIntent("confirm")}>确认</button>
            {tutor.vnextCoach?.inquiry.kind === "ready_to_return" ? (
              <button type="button" className="btn btn-primary" data-testid="vnext-inquiry-return" disabled={busy} onClick={() => void tutor.vnextSubmitIntent("return_to_mainline")}>返回主线</button>
            ) : null}
          </div>
        </div>
      );
    }
    if (kind === "confirm_input") {
      return (
        <button type="button" className="btn btn-primary" data-testid="vnext-participation-confirm" disabled={busy} onClick={() => void tutor.vnextSubmitIntent("confirm")}>确认</button>
      );
    }
    if (kind === "answer_input") {
      return (
        <form
          className="tutor-participation"
          data-testid="vnext-participation"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = answerDraft.trim();
            if (!trimmed) return;
            setAnswerDraft("");
            void tutor.vnextSubmitIntent("submit_answer", trimmed);
          }}
        >
          <input value={answerDraft} aria-label="回答输入" placeholder="说说这一步你是怎么想的" onChange={(event) => setAnswerDraft(event.target.value)} />
          <button type="submit" data-testid="vnext-submit-answer" disabled={!answerDraft.trim() || busy}>回答</button>
        </form>
      );
    }
    return <p className="canonical-participation-note" role="status" data-testid="vnext-participation">听老师讲解。</p>;
  })() : null;

  // 讲解 / 完成：同一 FocusWorkspace 外壳 + 同一 StudentWorkspaceFrame
  //（只读画布 + 板书面；完成态板书即同一 View 的最终披露，无第二份真源）。
  return (
    <>
      {diagnostics}
      <div className="ks-focus-page tutor-learn-page" data-testid="page-lifecycle" data-lifecycle="ready" {...pageAttributes}>
        <FocusWorkspace
          ariaLabel={completed ? "一对一学习完成" : "一对一学习工作台"}
          prompt={learnPrompt}
          rail={coachPanel}
          railOpen={railOpen}
          railTrigger={dockTrigger}
          actionBarLeft={teachingPlayback}
          actionEnd={vnext ? vnextParticipationBar : completed ? (
            <div className="action-row" data-testid="tutor-completed">
              <span className="text-muted">这道题学完了，进入训练巩固？</span>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="tutor-start-practice"
                onClick={() => navigate(`/practice/${taskId}`)}
              >
                开始训练
              </button>
            </div>
          ) : (
            <div className="action-row tutor-participation-row">
              {participationForm}
              {teachingConfirm}
            </div>
          )}
        >
          {vnext && tutor.vnextWorkspace ? (
            <StudentWorkspaceViewSurface view={tutor.vnextWorkspace} />
          ) : (
          <StudentWorkspaceFrame
            viewRevision={tutor.workspaceView?.revision}
            geometry={<ReadOnlyGeometrySurface geometry={tutor.workspaceView?.canvas.geometry} />}
            board={completed && completedBoard?.visibleExpressions.length ? (
              <div className="tutor-learn-board" data-testid="tutor-solution-board">
                <StudentBoardSurface board={completedBoard} ariaLabel="本题规范解答回顾" />
              </div>
            ) : (
              <StudentBoardSurface board={tutor.workspaceView?.solutionBoard} />
            )}
          />
          )}
        </FocusWorkspace>
      </div>
    </>
  );
}

function studentNameSafe(studentId: string): string {
  return studentId.trim() || "browser-student";
}
