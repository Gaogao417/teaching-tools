/**
 * Tutor 驱动的学习工作台（Phase 5 UI 集成 / 计划 §3，/learn/:taskId 的
 * kind=tutor 分支）。
 *
 * - WorkspaceShell / Topic 导航 / 学生身份 / URL 全部沿用（本组件渲染在
 *   LearnPage 的 Outlet 内）；
 * - Question 题干/小问来自 /experience 学生安全面；
 * - Opening/TutorMove 走现有 narration/media 管线（自动播放、barge-in、
 *   autoplay-blocked 重播提示）；
 * - 老师侧栏 composer：「回答 / 提问」切换（reasoning_utterance /
 *   question_asked），录音先走现有 ASR 再进同一输入合同；
 * - Workspace 用真实 ActionRuntimeFrame（transport → TutorSession typed
 *   evaluator），不出现第二个 legacy Coach；
 * - 同题换讲法（alternates_available）与题目完成推进（学习下一题/开始训练）；
 * - 波次 F：完成页板书回顾（既有内容面 solution-board 端点，仅完成后拉取）、
 *   composer 快捷提问 chips（一键 question_asked）、dock 头像预览气泡
 *   （收起后新老师消息 ~6s 预览，展开清除）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ActionRuntimeFrame, SolutionBoardPanel } from "../../action-runtime/react/ActionRuntimeFrame";
import { workspaceActionResponse, useTutorLearning } from "../../action-runtime/tutor/useTutorLearning";
import { solutionBoardReviewView } from "../../action-runtime/solutionBoardReview";
import type { SolutionBoardView } from "../../action-runtime/types";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { MathText } from "../../components/math/MathText";
import { useCoachRecorder } from "../../presentation/coach/useCoachRecorder";
import { buildGeometryModel } from "../../geometry/adapters/topicGeometryModel";
import { GeometryCanvasSurface } from "../../geometry/react/GeometryCanvas";
import type { InteractionView } from "../../geometry/interaction/interaction-view";
import { api } from "../../api/client";
import { topicNodeByTaskId } from "../../../../shared/similarityLearningMap";
import type { TaskId } from "../../../../shared/contracts";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import type { TutorExperienceResponse } from "../../../../shared/tutorExperience";

const PHASE_LABELS: Record<string, string> = {
  starting: "正在开始…",
  speaking: "老师讲解中（可打断）",
  awaitingInput: "等你发言",
  thinking: "老师思考中…",
  workspaceActive: "轮到你操作",
  interrupted: "已打断",
  recovering: "连接恢复中",
  completed: "本次学习完成",
};

/** 波次 F 任务 2：快捷提问——一键发送 question_asked（复用既有提问通道）。 */
const QUICK_ASKS: Array<{ key: string; label: string; text: string }> = [
  { key: "lost", label: "这步没懂", text: "这一步我没听懂，能再讲一遍吗？" },
  { key: "rephrase", label: "换种说法", text: "能换一种说法再解释一下这一步吗？" },
  { key: "hint", label: "给点提示", text: "能给我一点下一步的提示吗？" },
];

export interface TutorLearnExperienceProps {
  taskId: TaskId;
  studentId: string;
  /** 刷新恢复：URL ?session= 中的会话 id。 */
  restoreSessionId?: string;
  /** 页面（LearnPage）已拉取的 /experience 结果——组件直接采用，不重复建会话。 */
  initial?: TutorExperienceResponse;
  /** /experience 返回 legacy（无 Approved Binding）→ 回退原 LearnPage。 */
  onLegacy: () => void;
}

export function TutorLearnExperience({ taskId, studentId, restoreSessionId, initial, onLegacy }: TutorLearnExperienceProps) {
  const navigate = useNavigate();
  const tutor = useTutorLearning({ taskId, studentId, restoreSessionId });
  const [composerMode, setComposerMode] = useState<"answer" | "question">("answer");
  const [draft, setDraft] = useState("");
  const [asrBusy, setAsrBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const startedRef = useRef(false);
  const progressRecordedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !studentId) return;
    startedRef.current = true;
    if (restoreSessionId) {
      void tutor.restore(restoreSessionId).then(async (restored) => {
        // 会话不可恢复（如 backend 重启后的内存会话丢失）：清掉 ?session 并按
        // 默认 Binding 重新开始（同一 Question/讲法，不是静默换题换讲法）。
        if (!restored) {
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

  const submitComposer = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setDraft("");
      void tutor.submitStudentInput(
        composerMode === "question"
          ? { input_kind: "question_asked", text: trimmed }
          : { input_kind: "reasoning_utterance", text: trimmed },
      );
    },
    [composerMode, tutor],
  );

  /** 波次 F 任务 2：快捷提问一键发送——固定 question_asked，不经过
   * composerMode 切换（复用现有提问通道，无新输入合同）。 */
  const submitQuickAsk = useCallback(
    (text: string) => {
      void tutor.submitStudentInput({ input_kind: "question_asked", text });
    },
    [tutor],
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
          if (result.transcript.trim()) submitComposer(result.transcript);
        })
        .catch(() => {
          setNotice("语音识别暂不可用，请用文字输入。");
        })
        .finally(() => setAsrBusy(false));
    },
    onError: (message) => setNotice(message),
  });

  const checkpoint = tutor.currentCheckpoint;
  const question = tutor.question;
  const activeWorkspace = tutor.workspace[0];

  // 波次 E（教师反馈「topic coach dock 被抛弃了」）：Tutor 侧栏沿用原
  // coach dock 的壳与开合（FocusWorkspace dock 模式 + topic-coach-panel
  // 结构样式）；收起/展开在三个渲染分支间共享同一份状态（工作台分支经
  // ActionRuntimeFrame 受控 railOpen）。
  // 波次 F 任务 3：dock 头像预览气泡——沿用 legacy coach dock 行为
  // （ActionRuntimeFrame 同款）：收起时新老师消息更新气泡（约 6s 消失）、
  // 未读点持续、展开清除。
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
  const speaking = tutor.phase === "speaking";

  // 波次 F 任务 1：完成页板书回顾——只在 question_completed 后从既有内容面
  // （GET /api/learn/:taskId/solution-board）拉取整板投影；答案已提交，回顾
  // 非 truth 泄漏。scenario 用 /experience 响应里服务端给的 scenario_id
  // （非前端硬编码；restore 后无 experience 时服务端回落该 task 首条
  // Approved 记录）。拉取失败或无板书：完成页保持可用，不渲染板书。
  const [boardReview, setBoardReview] = useState<SolutionBoardView | null>(null);
  const boardFetchedRef = useRef(false);
  const scenarioId = tutor.experience?.scenario_id;
  useEffect(() => {
    if (!(tutor.phase === "completed" || tutor.questionCompleted)) return;
    if (boardFetchedRef.current) return;
    boardFetchedRef.current = true;
    let cancelled = false;
    api
      .getLearnSolutionBoard(taskId, scenarioId)
      .then((result) => {
        if (!cancelled && result.board) setBoardReview(solutionBoardReviewView(result.board));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tutor.phase, tutor.questionCompleted, taskId, scenarioId]);

  const rail = (
    <aside className="topic-coach-panel tutor-learn-rail" aria-label="一对一老师" aria-live="polite">
      <div className="topic-coach-header">
        <span className={`topic-coach-avatar material-symbols-outlined${speaking ? " is-speaking" : ""}`}>record_voice_over</span>
        <div>
          <small data-testid="tutor-state">{PHASE_LABELS[tutor.phase] ?? tutor.phase}</small>
          <strong>一对一老师</strong>
          {checkpoint ? (
            <small data-testid="tutor-checkpoint">
              进度 {checkpoint.part_id}/{checkpoint.checkpoint_id}（路线 {checkpoint.route_id}）
            </small>
          ) : null}
          {tutor.sessionId ? <small data-testid="tutor-session-id">{tutor.sessionId}</small> : null}
        </div>
        <button type="button" className="topic-coach-sound" aria-label="重播老师语音" onClick={() => tutor.replayNarration()}><span className="material-symbols-outlined">volume_up</span></button>
        <button type="button" className="topic-coach-close" aria-label="收起指导栏" onClick={() => setRailOpen(false)}><span className="material-symbols-outlined">right_panel_close</span></button>
      </div>
      <div className="tutor-learn-controls">
        {tutor.phase === "speaking" ? (
          <button type="button" onClick={() => void tutor.bargeIn()} data-testid="tutor-barge-in">
            打断
          </button>
        ) : null}
        {tutor.phase === "interrupted" ? (
          <button type="button" onClick={tutor.resumeFromInterrupt}>
            继续学习
          </button>
        ) : null}
        {tutor.phase === "recovering" ? (
          <button type="button" data-testid="tutor-retry" onClick={() => void tutor.start()}>
            重试
          </button>
        ) : null}
        {tutor.autoplayBlocked ? (
          <button type="button" onClick={tutor.replayNarration}>
            重播老师语音
          </button>
        ) : null}
        {tutor.alternatesAvailable && tutor.sessionId && tutor.phase !== "completed" ? (
          <button
            type="button"
            data-testid="tutor-switch-approach"
            disabled={tutor.phase === "starting" || tutor.phase === "thinking"}
            onClick={() => void tutor.start({ switchFromSessionId: tutor.sessionId })}
          >
            换一种讲法
          </button>
        ) : null}
      </div>

      {notice ? <p className="tutor-learn-notice" role="status">{notice}</p> : null}
      {tutor.error ? <p className="tutor-learn-error" role="alert">{tutor.error}</p> : null}

      <section className="topic-coach-thread tutor-learn-transcript" aria-label="对话记录" data-testid="tutor-transcript">
        {tutor.transcript.map((entry) => (
          <p key={entry.id} className={entry.role === "tutor" ? "tutor-says" : "student-says"}>
            <b>{entry.role === "tutor" ? "老师" : "我"}：</b>
            <MathText value={entry.text} />
          </p>
        ))}
      </section>

      {tutor.phase !== "completed" ? (
        <section className="tutor-learn-composer" aria-label="发言区">
          <div className="tutor-learn-composer-mode" role="group" aria-label="发言类型">
            <button
              type="button"
              className={composerMode === "answer" ? "is-active" : ""}
              aria-pressed={composerMode === "answer"}
              onClick={() => setComposerMode("answer")}
            >
              回答
            </button>
            <button
              type="button"
              className={composerMode === "question" ? "is-active" : ""}
              aria-pressed={composerMode === "question"}
              onClick={() => setComposerMode("question")}
            >
              提问
            </button>
          </div>
          <div className="tutor-learn-quick-asks" role="group" aria-label="快捷提问">
            {QUICK_ASKS.map((ask) => (
              <button
                key={ask.key}
                type="button"
                data-testid={`tutor-quick-ask-${ask.key}`}
                disabled={tutor.phase === "starting"}
                onClick={() => submitQuickAsk(ask.text)}
              >
                {ask.label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitComposer(draft);
            }}
          >
            <input
              value={draft}
              placeholder={composerMode === "answer" ? "说说这一步你是怎么想的（回答）" : "向老师提问（提问）"}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={composerMode === "answer" ? "回答输入" : "提问输入"}
              disabled={tutor.phase === "starting"}
            />
            <button
              type="submit"
              data-testid={composerMode === "answer" ? "tutor-submit-answer" : "tutor-submit-question"}
              disabled={!draft.trim()}
            >
              {composerMode === "answer" ? "回答" : "提问"}
            </button>
          </form>
          <button
            type="button"
            className={`topic-coach-mic${recorder.recording ? " is-recording" : ""}`}
            aria-label={recorder.recording ? "结束录音" : "语音回答"}
            disabled={asrBusy || !tutor.sessionId}
            onClick={() => void recorder.toggle()}
            data-testid="tutor-record"
          >
            <span className="material-symbols-outlined">{recorder.recording ? "stop_circle" : "mic"}</span>
          </button>
          {recorder.recording ? (
            <p className="topic-coach-recording" role="status"><span />正在听，点停止后发送（最长 45 秒）</p>
          ) : null}
          {asrBusy ? <p className="topic-coach-recording" role="status"><span />正在识别你的话…</p> : null}
          {tutor.phase === "thinking" ? <p className="topic-coach-thinking" role="status">老师正在思考…</p> : null}
        </section>
      ) : (
        <p data-testid="tutor-completed">这次学习完成了。</p>
      )}
    </aside>
  );

  const railTrigger = (
    <button
      type="button"
      className={`topic-coach-dock-avatar${speaking ? " is-speaking" : ""}`}
      aria-label="展开一对一老师"
      aria-expanded={railOpen}
      onClick={openRail}
    >
      <span className="material-symbols-outlined">record_voice_over</span>
      {railUnread ? <span className="topic-coach-dock-unread" aria-hidden /> : null}
      {dockPreview ? (
        <span className="topic-coach-dock-preview" role="status" aria-live="polite">
          <MathText value={dockPreview.text} />
        </span>
      ) : null}
    </button>
  );

  if (tutor.phase === "completed" || tutor.questionCompleted) {
    return (
      <div className="ks-focus-page tutor-learn-page">
        <FocusWorkspace
          ariaLabel="一对一学习完成"
          prompt={<><span>题目</span><div><h1><MathText value={question?.stem ?? ""} /></h1></div></>}
          rail={rail}
          railOpen={railOpen}
          railTrigger={railTrigger}
        >
          <section className="tutor-learn-done" aria-label="学习完成">
            <h2>这道题学完了</h2>
            {boardReview ? (
              <div className="tutor-learn-board" data-testid="tutor-solution-board">
                <SolutionBoardPanel board={boardReview} />
              </div>
            ) : null}
            <p>换一道题继续练，还是进入训练巩固这一题？</p>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="tutor-start-practice"
              onClick={() => navigate(`/practice/${taskId}`)}
            >
              开始训练
            </button>
          </section>
        </FocusWorkspace>
      </div>
    );
  }

  if (activeWorkspace && tutor.sessionId) {
    return (
      <div className="ks-focus-page tutor-learn-page">
        <ActionRuntimeFrame
          response={workspaceActionResponse(tutor.sessionId, activeWorkspace)}
          transport={tutor.transport}
          railContent={rail}
          railTrigger={railTrigger}
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
    );
  }

  return (
    <div className="ks-focus-page tutor-learn-page">
      <FocusWorkspace
        ariaLabel="一对一学习工作台"
        prompt={<><span>题目</span><div><h1><MathText value={question?.stem ?? ""} /></h1></div></>}
        rail={rail}
        railOpen={railOpen}
        railTrigger={railTrigger}
        actionBarLeft={<span className="ks-focus-rail-action">智能一对一 · {taskId}</span>}
      >
        <section className="tutor-learn-question" aria-label="题目">
          {question?.subquestions?.length ? (
            question.subquestions.map((subquestion) => (
              <p key={subquestion.part_id} className="tutor-learn-subquestion">
                <MathText value={subquestion.prompt} />
              </p>
            ))
          ) : (
            <p className="tutor-learn-subquestion">{PHASE_LABELS[tutor.phase] ?? tutor.phase}</p>
          )}
        </section>
        {question?.geometry ? <TutorQuestionFigure geometry={question.geometry} /> : null}
      </FocusWorkspace>
    </div>
  );
}

/**
 * 波次 C-2 裁定 1：开场讲解（无 workspace 回合）的只读题目画布。
 * 复用 GeometryCanvasSurface 渲染服务端下发的 authored 学生安全
 * TopicGeometryModel；实体全部 disabled（board 命中测试只认 enabled）、
 * 无确认按钮、不产生 evidence——讲解回合不冒充操作回合的 workspace 合同。
 */
function TutorQuestionFigure({ geometry }: { geometry: TopicGeometryModel }) {
  const model = useMemo(() => buildGeometryModel(geometry), [geometry]);
  const view = useMemo<InteractionView>(() => ({
    prompt: "题目图形",
    entities: {
      ...Object.fromEntries(geometry.points.map((point) => [point.id, {
        id: point.id, kind: "point" as const, enabled: false, expected: false, visualState: "idle" as const,
      }])),
      ...Object.fromEntries(geometry.segments.map((segment) => [segment.id, {
        id: segment.id, kind: "line" as const, enabled: false, expected: false, visualState: "idle" as const,
      }])),
    },
    selected: [],
    cursor: "default",
    canCancel: false,
    canGoBack: false,
  }), [geometry]);
  return (
    <div className="tutor-learn-figure">
      <div className="artifact-math-object has-diagram">
        <section className="artifact-diagram-stage" aria-label="题目图形">
          <GeometryCanvasSurface model={model} view={view} onClickEntity={() => undefined} modelVersion={1} />
        </section>
      </div>
    </div>
  );
}

function studentNameSafe(studentId: string): string {
  return studentId.trim() || "browser-student";
}
