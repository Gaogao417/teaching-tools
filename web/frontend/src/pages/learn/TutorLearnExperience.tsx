/**
 * Tutor 驱动的学习工作台（Phase 5 UI 集成 / 计划 §3，/learn/:taskId 的
 * kind=tutor 分支）。
 *
 * - WorkspaceShell / Topic 导航 / 学生身份 / URL 全部沿用（本组件渲染在
 *   LearnPage 的 Outlet 内）；
 * - Question 题干/小问来自数据源学生安全面；
 * - Opening/TutorMove 走现有 narration/media 管线（自动播放、barge-in、
 *   autoplay-blocked 重播提示）；
 * - VS1 remediation-2（2026-08-26 第二轮 Rejected 后，ADR-010）：三态
 *   （teach/operate/completed）渲染同一 canonical `TopicCoachPanel` +
 *   `TopicTeachingControls`——删除页面级自建 rail/「回答/提问」模式切换/
 *   快捷 chips；信息结构回到「教学拍点 N/M + 当前标题 + 当前拍 Focus
 *   Cue」；主线回答属 Participation（action bar 回答入口），
 *   Assistance 恒为提问通道，kind 不由前端 phase 猜（ADR-010 §2/§3）；
 * - F7 Step 5（复核裁定）：数据源分派只发生在 controller 边界——本组件消费
 *   useTutorLearning 的统一 view-model（participationControls/playbackControls/
 *   workspaceSurface/coachControls/activeActionFrame），不按 Boolean(runtimeClient)
 *   分两套 UI；canonical Runtime 链（单一 ValidatedSessionSnapshot）与 legacy
 *   V5 链（F8 退场）在 hook 内完成合并；
 * - Workspace 用真实 ActionRuntimeFrame（transport → 服务端 typed evaluator），
 *   操作分支经 railContent 注入同一 canonical Panel；
 * - 完成页板书回顾自 VS1 起来自统一 workspace_view（L-05）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ActionRuntimeFrame } from "../../presentation/runtime/ActionRuntimeFrame";
import { useTutorLearning, type RecordingChannelCapture } from "../../action-runtime/tutor/useTutorLearning";
import type { MediaSessionController } from "../../presentation/audio/MediaSessionController";
import { LearnQuestionPrompt } from "../../presentation/workspace/LearnQuestionPrompt";
import { ReadOnlyGeometrySurface, StudentBoardSurface, StudentWorkspaceFrame } from "../../presentation/workspace/StudentWorkspaceFrame";
import { StudentWorkspaceViewSurface } from "../../presentation/canonicalView/StudentWorkspaceViewSurface";
import { SolutionBoardViewSurface } from "../../presentation/canonicalView/SolutionBoardViewSurface";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { TopicCoachDockTrigger, TopicCoachPanel, type TopicCoachTurn } from "../../presentation/coach/TopicCoachPanel";
import { TopicTeachingConfirm, TopicTeachingPlayback } from "../../presentation/coach/TopicTeachingControls";
import { AcceptanceDiagnostics } from "../../presentation/acceptance/AcceptanceDiagnostics";
import { useCoachRecorder } from "../../presentation/coach/useCoachRecorder";
import { api } from "../../api/client";
import type { TutorRuntimeClient } from "../../api/tutorRuntimeClient";
import { topicNodeByTaskId } from "../../../../shared/similarityLearningMap";
import type { TaskId } from "../../../../shared/contracts";
import type { TutorExperienceResponse } from "../../../../shared/tutorExperience";

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
  /** canonical Runtime 数据源（F7 Step 5，spec §4.1）：LearnPage 按 availability
   *  选择 client 后注入。提供时组件消费 v7 SessionSnapshot 链（单一快照
   *  派生）；缺省走 legacy V5 链——不据此切换页面或第二套 UI 模式。 */
  runtimeClient?: TutorRuntimeClient;
}

export function TutorLearnExperience({ taskId, studentId, restoreSessionId, initial, acceptanceMode, fallbackOccurred, onLegacy, runtimeClient }: TutorLearnExperienceProps) {
  const navigate = useNavigate();
  const tutor = useTutorLearning({ taskId, studentId, restoreSessionId, ...(runtimeClient ? { runtimeClient } : {}) });
  const [questionDraft, setQuestionDraft] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [asrBusy, setAsrBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  /** canonical restore 会话丢失：先告知用户，由用户明确重开（spec §2.1）。 */
  const [restartOffered, setRestartOffered] = useState(false);
  const startedRef = useRef(false);
  const progressRecordedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !studentId) return;
    startedRef.current = true;
    if (restoreSessionId) {
      void tutor.restore(restoreSessionId).then(async (outcome) => {
        // legacy：会话不可恢复（如 backend 重启后的内存会话丢失）→ 清掉 ?session
        // 并按默认 Binding 重新开始（VS0 REQ-06 既有行为）。
        // canonical：restartOnMissing=false——先告知、用户明确重开（不静默 start）。
        // VS1 REQ-08：schema 非法 → recoverable error（错误已由 hook 设置），不重开。
        if (outcome === "missing") {
          if (tutor.restartOnMissing) {
            const result = await tutor.start();
            if (result?.kind === "legacy") onLegacy();
          } else {
            setRestartOffered(true);
          }
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
    if (!tutor.completed || progressRecordedRef.current) return;
    progressRecordedRef.current = true;
    if (taskId && topicNodeByTaskId(taskId)) {
      void api
        .recordSimilarityLearnProgress(taskId, studentNameSafe(studentId), "completed")
        .catch(() => undefined);
    }
    void tutor.finishQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor.completed]);

  /** Assistance（ADR-010：Panel composer 恒为提问通道）。canonical 链提交原始
   *  utterance(channel=assistance)——语义解释在后端（spec §2.5）；legacy 链
   *  question_asked。分派在 controller（coachControls.ask）。 */
  const submitQuestion = useCallback(
    (text: string) => {
      void tutor.coachControls.ask(text).then((confirmed) => {
        if (confirmed) setQuestionDraft(current => current.trim() === text.trim() ? "" : current);
      });
    },
    [tutor],
  );

  /** F7 Step 8：双 mic 各自锁定通道——Coach mic=assistance（Panel composer 恒为
   *  提问通道，spec §2.9）；mainline answer mic=mainline（answer_input 的独立
   *  affordance，不共用一个 mic 后猜意图，spec §4.8）。两路 recorder 共享外层
   *  PresentationRuntime 的同一 MediaSessionController（录音互斥 + 录音打断
   *  播放）；录音真正开始时捕获 {sessionId, revision, channel}，ASR 后按捕获做
   *  stale 防护（捕获值不随后续 revision 变化更新）。 */
  const coachCaptureRef = useRef<RecordingChannelCapture | undefined>(undefined);
  const recorder = useCoachRecorder({
    owner: "coach",
    disabled: asrBusy || tutor.speechAsrBusy || !tutor.sessionId || !tutor.coachControls.canHelp,
    media: tutor.mediaSession,
    // R5 裁定时序（F7 P2）：先 barge-in 再录音——等待失败不开录；无活跃可中断
    // 交付时直接按当前合法入口录音（legacy 链无此握手）。
    beforeStart: runtimeClient ? () => tutor.prepareRecordingStart() : undefined,
    interruptPlaybackOnStart: runtimeClient ? true : undefined,
    captureBusyMessage: runtimeClient ? "已有录音进行中，请先停止当前录音。" : undefined,
    onRecordingStart: () => { coachCaptureRef.current = tutor.lockRecordingChannel("assistance"); },
    onAudio: (audio) => {
      const capture = coachCaptureRef.current;
      coachCaptureRef.current = undefined; // consume-once：下一次录音必须重新捕获
      if (runtimeClient) {
        // canonical：ASR 经当前 client 的 /asr（observe-only）→ stale 核对 →
        // 自动提交 utterance(assistance) 或落草稿（禁调 legacy session API）。
        if (!capture || !tutor.sessionId) {
          setNotice("当前不能使用语音提问，请改用文字输入。");
          return;
        }
        void tutor.transcribeRecording(capture, audio);
        return;
      }
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

  /** mainline answer mic（canonical answer_input 独立入口）：提取为
   *  MainlineAnswerComposer 子组件——仅 canonical answer 拍挂载（legacy 无此
   *  形态）；录音开始即锁定 mainline 通道（spec §4.8，与 Coach mic 分离，
   *  不共用一个 mic 后猜意图）。 */

  /** stale transcript（S1 交叉规则）：只填入录音开始时锁定的对应通道草稿并
   *  提示用户确认——不自动提交、不移花接木到其他通道。 */
  useEffect(() => {
    const pending = tutor.speechPendingTranscript;
    if (!pending) return;
    if (pending.source.sessionId !== tutor.sessionId) {
      setNotice(`上一会话（${pending.source.sessionId}）的语音：${pending.text}。未填入当前会话。`);
      tutor.clearSpeechPendingTranscript();
      return;
    }
    if (pending.channel === "mainline") setAnswerDraft(pending.text);
    else setQuestionDraft(pending.text);
    setNotice("会话已更新，语音内容已按录音时的通道填入草稿，请确认后再发送。");
    tutor.clearSpeechPendingTranscript();
  }, [tutor.speechPendingTranscript, tutor.clearSpeechPendingTranscript, tutor.sessionId]);

  const checkpoint = tutor.currentCheckpoint;
  const pres = tutor.presentation;
  const busy = tutor.phase === "thinking";
  const completed = tutor.completed;
  const activeOperation = tutor.activeOperation;
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
    : tutor.runtimePresentationFailure ? "讲解呈现失败，已暂停"
    : checkpoint?.title ?? (checkpoint ? `第${checkpoint.part_id}小问` : "老师讲解中");

  const statusNotes = (
    <>
      {tutor.runtimeOwnerRequired ? (
        <div className="tutor-learn-notice" role="status" data-testid="tutor-presentation-owner">
          <p>此页面尚未接管讲解。接管并完成画面同步后才能继续。</p>
          <button type="button" className="btn btn-primary" disabled={tutor.claimBusy} onClick={() => void tutor.claimPresentation()}>在此页面继续</button>
        </div>
      ) : tutor.runtimeVisualBarrier ? (
        <div className="tutor-learn-notice" role="status" data-testid="tutor-visual-cleanup">
          <p>{tutor.runtimeVisualBarrier.status === "failed" ? "画面清理失败，讲解和录音已暂停。" : "正在同步画面，请稍候。"}</p>
          {tutor.runtimeVisualBarrier.status === "failed" ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void tutor.submitControl("retry_recovery")}>重试画面恢复</button> : null}
        </div>
      ) : null}
      {tutor.runtimePresentationFailure && !tutor.runtimeOwnerRequired && !tutor.runtimeVisualBarrier ? (
        <div className="tutor-learn-error" role="alert" data-testid="tutor-presentation-failure">
          <p>{tutor.runtimePresentationFailure.failureClass === "provider_failure"
            ? "语音或呈现服务暂时失败，讲解已暂停。请重试恢复讲解。"
            : "讲解呈现失败，已暂停。请重试恢复讲解。"}</p>
          <button type="button" className="btn btn-primary" data-testid="tutor-presentation-retry" disabled={busy} onClick={tutor.retryPresentation}>重试讲解</button>
        </div>
      ) : null}
      {tutor.error ? <p className="tutor-learn-error" role="alert" data-testid="tutor-error">{tutor.error}</p> : null}
      {tutor.protocolError ? (
        <p className="tutor-learn-error" role="alert" data-testid="tutor-protocol-error">
          {tutor.protocolError}
          <button type="button" className="btn btn-ghost" data-testid="tutor-protocol-retry" onClick={() => void tutor.retrySync()}>重新同步</button>
        </p>
      ) : null}
      {tutor.runtimeTurnFailure || tutor.runtimeFailureNotice ? (
        <p className="tutor-learn-notice" role="status" data-testid="tutor-turn-failure">
          {tutor.runtimeFailureNotice ?? `上一轮未生效（${tutor.runtimeTurnFailure}），请重试。`}
        </p>
      ) : null}
      {/* F7 P2（S1/生成生命周期规格）：generation pending/failed 状态——pending 只读
          轮询驱动（GET snapshot 零模型调用）；waiting_retry 显示重试进度；failed 提供
          重新尝试（既有 control.retry_recovery，服务端新预算）。新任务取代后本视图
          随快照自动切换，不显示旧任务提示。 */}
      {tutor.runtimeGeneration.kind === "pending" ? (
        <p className="tutor-learn-notice" role="status" data-testid="tutor-generation-status" data-generation-phase={tutor.runtimeGeneration.phase}>
          {tutor.runtimeGeneration.phase === "waiting_retry"
            ? `讲解生成超时/暂不可用，正在重试（第 ${tutor.runtimeGeneration.attempt}/${Math.max(tutor.runtimeGeneration.maxAttempts - 1, 1)} 次）`
            : "正在生成讲解…"}
        </p>
      ) : null}
      {tutor.runtimeGeneration.kind === "failed" ? (
        <p className="tutor-learn-notice" role="status" data-testid="tutor-generation-status" data-generation-phase="failed">
          讲解生成失败（{tutor.runtimeGeneration.errorClass}），可重新尝试。
          <button type="button" className="btn btn-ghost" data-testid="tutor-generation-retry" disabled={busy} onClick={tutor.retryGeneration}>重新尝试</button>
        </p>
      ) : null}
      {restartOffered ? (
        <p className="tutor-learn-notice" role="status" data-testid="tutor-restart-offered">
          学习会话已失效（可能是服务重启）。
          <button type="button" className="btn btn-ghost" data-testid="tutor-restart" onClick={() => { setRestartOffered(false); void tutor.start(); }}>重新开始</button>
        </p>
      ) : null}
      {notice ? <p className="tutor-learn-notice" role="status">{notice}</p> : null}
      {tutor.speechNotice ? <p className="tutor-learn-notice" role="status" data-testid="tutor-speech-notice">{tutor.speechNotice}</p> : null}
      {/* F7 P2（S1 裁定① delivered≠presented）：录音占用麦克风期间到达的讲解
          挂起（延迟起播），capture 释放后自动播放——如实告知，不伪称正在讲解。 */}
      {tutor.narrationHeldForCapture ? (
        <p className="topic-coach-recording" role="status" data-testid="tutor-narration-held"><span />录音进行中，讲解将在录音结束后自动播放。</p>
      ) : null}
      {pres.reviewing ? <p className="topic-coach-recording" role="status"><span />正在回看上一段讲解…</p> : null}
      {asrBusy || tutor.speechAsrBusy ? <p className="topic-coach-recording" role="status"><span />正在识别你的话…</p> : null}
    </>
  );
  const extraHeaderControls = (
    <>
      {tutor.bargeInAvailable ? (
        <button type="button" className="tutor-session-control" data-testid="tutor-barge-in" onClick={() => void tutor.bargeIn()}>打断</button>
      ) : null}
      {tutor.phase === "interrupted" ? (
        <button type="button" className="tutor-session-control" onClick={tutor.resumeFromInterrupt}>继续学习</button>
      ) : null}
      {tutor.phase === "recovering" ? (
        <button type="button" className="tutor-session-control" data-testid="tutor-retry" onClick={() => void tutor.start()}>重试</button>
      ) : null}
      {tutor.switchApproachAvailable ? (
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
      canHelp={tutor.coachControls.canHelp}
      message={questionDraft}
      onMessageChange={setQuestionDraft}
      onAsk={() => submitQuestion(questionDraft)}
      inputDisabled={busy || asrBusy || tutor.speechAsrBusy}
      micDisabled={busy || asrBusy || tutor.speechAsrBusy || !tutor.coachControls.canHelp}
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
      speaking={(tutor.playbackControls?.source === "canonical" && tutor.playbackControls.phase.phase === "presenting") || pres.playing || pres.reviewing}
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

  // canonical 链验收模式：暴露已验证 SessionSnapshot（Step 8 Playwright 证据
  // 采集锚点——snapshot 是渲染输入本身，无 hidden truth，不新增泄露面）。
  useEffect(() => {
    if (!acceptanceMode) return;
    (window as unknown as { __runtimeSessionSnapshot?: unknown }).__runtimeSessionSnapshot = tutor.runtimeSnapshot;
  }, [acceptanceMode, tutor.runtimeSnapshot]);

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

  /** 参与区（统一 view-model 驱动；spec §4.4 七 kind + legacy 相位投影）。 */
  const participationArea = (() => {
    if (tutor.runtimePresentationFailure || tutor.runtimeOwnerRequired || tutor.runtimeVisualBarrier) return null;
    const controls = tutor.participationControls;
    switch (controls.kind) {
      case "completed":
        return (
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
        );
      case "cta":
        return controls.confused ? (
          // legacy 讲解门复合布局：主线回答表单（answerVisible 时）+ 讲解确认组
          //（「明白，继续」放行恰一步；「这步没懂」= assistance 同通道预设话术）。
          <div className="action-row tutor-participation-row">
            {controls.answer ? (
              <form
                className="tutor-participation"
                data-testid="region-participation"
                aria-label="回答老师"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = answerDraft.trim();
                  if (!trimmed) return;
                  setAnswerDraft("");
                  controls.answer?.onSubmit(trimmed);
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
            ) : null}
            <TopicTeachingConfirm
              confusedDisabled={controls.confusedDisabled ?? busy}
              onConfused={controls.confused}
              understoodDisabled={controls.understoodDisabled ?? busy}
              understoodLabel={controls.label}
              onUnderstood={controls.onSubmit}
            />
          </div>
        ) : controls.feedback ? (
          <div className="action-row tutor-participation-row">
            <MainlineAnswerComposer
              purpose="feedback"
              draft={answerDraft}
              onDraftChange={setAnswerDraft}
              onSubmit={controls.feedback.onSubmit}
              busy={busy}
              media={tutor.mediaSession}
              beforeStart={() => tutor.prepareRecordingStart()}
              lockChannel={() => tutor.lockRecordingChannel("mainline")}
              transcribe={(capture, audio) => tutor.transcribeRecording(capture, audio)}
              onNotice={setNotice}
            />
            <button type="button" className="btn btn-primary" data-testid={controls.testId ?? "tutor-confirm-input"} disabled={controls.understoodDisabled ?? busy} onClick={controls.onSubmit}>{controls.label}</button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" data-testid={controls.testId ?? "tutor-confirm-input"} disabled={controls.understoodDisabled ?? busy} onClick={controls.onSubmit}>{controls.label}</button>
        );
      case "answer":
        return (
          <MainlineAnswerComposer
            draft={answerDraft}
            onDraftChange={setAnswerDraft}
            onSubmit={controls.onSubmit}
            busy={busy}
            media={tutor.mediaSession}
            beforeStart={runtimeClient ? () => tutor.prepareRecordingStart() : undefined}
            lockChannel={() => tutor.lockRecordingChannel("mainline")}
            transcribe={(capture, audio) => tutor.transcribeRecording(capture, audio)}
            onNotice={setNotice}
          />
        );
      case "inquiry":
        return (
          <div className="action-row" data-testid="tutor-inquiry-row">
            <span className="text-muted">有问题随时在左侧问老师；想清楚了就回主线。</span>
            {controls.canReturn ? (
              <button type="button" className="btn btn-primary" data-testid="tutor-inquiry-return" disabled={busy} onClick={controls.onReturn}>返回主线</button>
            ) : null}
          </div>
        );
      case "workspace_wait":
        return <p className="canonical-participation-note" role="status" data-testid="tutor-participation">按老师要求在画布上完成标注操作。</p>;
      case "listen":
        return <p className="canonical-participation-note" role="status" data-testid="tutor-participation">听老师讲解。</p>;
      default:
        return null;
    }
  })();

  /** 讲解播放组（统一 view-model：legacy=本地呈现管线；canonical=
   *  PresentationRuntime 执行状态——F7 Step 6，呈现由服务端 pending 驱动）。 */
  const teachingPlayback = (() => {
    if (tutor.runtimePresentationFailure) return null;
    const controls = tutor.playbackControls;
    if (!controls) return null;
    if (controls.source === "canonical") {
      switch (controls.phase.phase) {
        case "presenting":
          return (
            <div className="tutor-presentation-status" data-testid="tutor-presentation" data-presentation-phase="presenting" data-presentation-kind={controls.phase.kind} role="status">
              {controls.phase.kind === "voice" ? "老师讲解中…" : controls.phase.kind === "geometry" ? "正在呈现画布…" : "正在呈现板书…"}
            </div>
          );
        case "awaiting-gesture":
          return (
            <div className="action-row tutor-presentation-status" data-testid="tutor-presentation" data-presentation-phase="awaiting-gesture">
              <span className="text-muted">浏览器暂停了自动播放。</span>
              <button type="button" className="btn btn-primary" data-testid="tutor-presentation-resume" onClick={controls.resume}>开始播放</button>
            </div>
          );
        case "outcome-pending":
          return (
            <div className="tutor-presentation-status" data-testid="tutor-presentation" data-presentation-phase="outcome-pending" role="status">
              正在确认呈现结果…
            </div>
          );
        case "paused":
          return controls.phase.reason === "real-signal-unavailable" ? (
            <div className="tutor-presentation-status" data-testid="tutor-presentation" data-presentation-phase="paused" role="status">
              画布/板书呈现执行链将在下一步接入（F7 进行中）——当前已暂停，不影响语音讲解。
            </div>
          ) : (
            <div className="tutor-presentation-status" data-testid="tutor-presentation" data-presentation-phase="paused" role="status">
              呈现已暂停{controls.phase.message ? `：${controls.phase.message}` : ""}。
            </div>
          );
        default:
          return null;
      }
    }
    return (
      <TopicTeachingPlayback
        positionCurrent={Math.max(controls.presentation.playedCount, 1)}
        positionTotal={Math.max(controls.presentation.totalCount, 1)}
        firstDisabled={controls.presentation.playedCount <= 1 || controls.presentation.reviewing || busy}
        onFirst={() => tutor.playbackControls?.source === "legacy" && tutor.playbackControls.reviewFirst()}
        previousDisabled={controls.presentation.playedCount <= 1 || controls.presentation.reviewing || busy}
        onPrevious={() => tutor.playbackControls?.source === "legacy" && tutor.playbackControls.reviewPrevious()}
        replayDisabled={controls.presentation.reviewing || (!controls.presentation.currentText && !lastTutorEntry)}
        onReplay={() => tutor.playbackControls?.source === "legacy" && tutor.playbackControls.replay()}
        nextDisabled={!controls.presentation.awaitingContinue || controls.presentation.reviewing || busy}
        onNext={() => tutor.playbackControls?.source === "legacy" && tutor.playbackControls.advance()}
        pauseNote={controls.presentation.playing ? "老师讲解中…" : "已暂停，等待学生回应后继续演示"}
      />
    );
  })();

  const frame = tutor.activeActionFrame;
  if (activeOperation && tutor.sessionId && !completed) {
    return (
      <>
        {diagnostics}
        <div className="ks-focus-page tutor-learn-page" data-testid="page-lifecycle" data-lifecycle="ready" {...pageAttributes}>
          {/* actor-first（spec §4.6）：Frame 内部先 applyEvaluation 再回调
              onEvaluation——canonical 链在此原子采用 evidence 响应快照；
              legacyMediaDisabled：canonical 媒体归属外部 Tutor runtime（Step 6
              PresentationRuntime），Frame 禁创建 legacy coach/媒体。 */}
          <ActionRuntimeFrame
            response={{ sessionId: tutor.sessionId, plan: activeOperation.plan }}
            transport={frame.transport}
            onEvaluation={frame.onEvaluation}
            boardView={frame.boardView}
            boardSurface={frame.board ? <SolutionBoardViewSurface board={frame.board} sessionId={tutor.sessionId} /> : undefined}
            viewRevision={frame.viewRevision}
            legacyMediaDisabled={frame.legacyMediaDisabled}
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

  // 讲解 / 完成：同一 FocusWorkspace 外壳 + 同一 Workspace 呈现面
  //（canonical=快照 student_workspace_view + render.geometry 驱动的 production
  //  Canvas + 共享 canonical Board（真实 commit 信号接入 PresentationRuntime）；
  //  legacy=统一 View 的只读画布 + 板书面；完成态板书即同一 View 的最终披露，
  //  无第二份真源）。
  const workspaceArea = tutor.workspaceSurface.source === "canonical"
    ? (tutor.workspaceSurface.view
      ? (
        <StudentWorkspaceViewSurface
          view={tutor.workspaceSurface.view}
          geometry={tutor.workspaceSurface.geometry}
          commitSignal={tutor.workspaceSurface.commitSignal}
          workspaceExecutionKey={tutor.workspaceSurface.workspaceExecutionKey}
          boardPresentation={tutor.workspaceSurface.boardPresentation}
        />
      )
      : <section className="topic-answer-panel solution-board-panel is-empty" aria-label="学习工作区（加载中）" data-testid="region-workspace" />)
    : (
      <StudentWorkspaceFrame
        viewRevision={tutor.workspaceSurface.workspaceView?.revision}
        geometry={<ReadOnlyGeometrySurface geometry={tutor.workspaceSurface.workspaceView?.canvas.geometry} />}
        board={completed && tutor.workspaceSurface.workspaceView?.solutionBoard?.visibleExpressions.length ? (
          <div className="tutor-learn-board" data-testid="tutor-solution-board">
            <StudentBoardSurface board={tutor.workspaceSurface.workspaceView?.solutionBoard} ariaLabel="本题规范解答回顾" />
          </div>
        ) : (
          <StudentBoardSurface board={tutor.workspaceSurface.workspaceView?.solutionBoard} />
        )}
      />
    );

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
          actionEnd={participationArea}
        >
          {workspaceArea}
        </FocusWorkspace>
      </div>
    </>
  );
}

function studentNameSafe(studentId: string): string {
  return studentId.trim() || "browser-student";
}

/**
 * 主线输入：answer_input 作答或 confirm_input 理解反馈，共用原话/录音链。
 *
 * - 文字与语音共用同一 mainline 通道（utterance(channel=mainline)）；
 * - answer mic 是独立 affordance（spec §4.8：不与 Coach mic 共用一个 mic 后
 *   猜意图）——录音真正开始时锁定 mainline 并捕获 {sessionId, revision}；
 * - 与 Voice 播放共享外层 PresentationRuntime 的同一 MediaSessionController
 *   （录音互斥 + 录音打断播放）；
 * - 仅 canonical participation=answer/confirm 时挂载（legacy 链无此形态）。
 */
function MainlineAnswerComposer({ purpose = "answer", draft, onDraftChange, onSubmit, busy, media, beforeStart, lockChannel, transcribe, onNotice }: {
  purpose?: "answer" | "feedback";
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (text: string) => void;
  busy: boolean;
  media: MediaSessionController;
  /** R5 裁定时序（F7 P2）：先 barge-in 再录音（等待失败不开录）。 */
  beforeStart?: () => Promise<boolean>;
  lockChannel: () => RecordingChannelCapture | undefined;
  transcribe: (capture: RecordingChannelCapture, audio: { dataUrl: string; mimeType?: string; durationMs?: number }) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const feedback = purpose === "feedback";
  const captureRef = useRef<RecordingChannelCapture | undefined>(undefined);
  const recorder = useCoachRecorder({
    owner: "answer", // 同一主线录音 owner；purpose 不改变通道或媒体状态机。
    disabled: busy,
    media,
    beforeStart,
    interruptPlaybackOnStart: true,
    captureBusyMessage: "已有录音进行中，请先停止当前录音。",
    onRecordingStart: () => { captureRef.current = lockChannel(); },
    onAudio: (audio) => {
      const capture = captureRef.current;
      captureRef.current = undefined; // consume-once：下一次录音必须重新捕获
      if (!capture) {
        onNotice("当前不能提交这段语音，请用文字输入。");
        return;
      }
      void transcribe(capture, audio);
    },
    onError: onNotice,
  });
  return (
    <form
      className="tutor-participation"
      data-testid="tutor-participation"
      aria-label={feedback ? "反馈这一步的理解" : "回答老师"}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = draft.trim();
        if (!trimmed || busy) return;
        onDraftChange("");
        onSubmit(trimmed);
      }}
    >
      <input
        value={draft}
        placeholder={feedback ? "说说你是否跟上，或哪里还没懂" : "说说这一步你是怎么想的"}
        aria-label={feedback ? "理解反馈输入" : "回答输入"}
        disabled={busy}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <button
        type="button"
        className={`topic-coach-mic${recorder.recording ? " is-recording" : ""}`}
        data-testid={feedback ? "tutor-feedback-mic" : "tutor-answer-mic"}
        aria-label={recorder.recording ? "结束录音回答" : feedback ? "语音反馈理解" : "语音回答"}
        disabled={busy}
        onClick={() => { void recorder.toggle(); }}
      >
        <span className="material-symbols-outlined">{recorder.recording ? "stop_circle" : "mic"}</span>
      </button>
      <button type="submit" data-testid={feedback ? "tutor-submit-feedback" : "tutor-submit-answer"} disabled={!draft.trim() || busy}>{feedback ? "发送反馈" : "回答"}</button>
      {recorder.recording ? (
        <p className="topic-coach-recording" role="status" data-testid="tutor-answer-recording"><span />正在录音回答，点停止后发送（最长 45 秒）</p>
      ) : null}
    </form>
  );
}
