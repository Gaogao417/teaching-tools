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
 * - 同题换讲法（alternates_available）与题目完成推进（学习下一题/开始训练）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ActionRuntimeFrame } from "../../action-runtime/react/ActionRuntimeFrame";
import { workspaceActionResponse, useTutorLearning } from "../../action-runtime/tutor/useTutorLearning";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { MathText } from "../../components/math/MathText";
import { useCoachRecorder } from "../../presentation/coach/useCoachRecorder";
import { api } from "../../api/client";
import { topicNodeByTaskId } from "../../../../shared/similarityLearningMap";
import type { TaskId } from "../../../../shared/contracts";
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

  const rail = (
    <aside className="tutor-learn-rail" aria-label="一对一老师" aria-live="polite">
      <div className="tutor-learn-status">
        <span data-testid="tutor-state">{PHASE_LABELS[tutor.phase] ?? tutor.phase}</span>
        {checkpoint ? (
          <span data-testid="tutor-checkpoint">
            当前进度 {checkpoint.part_id}/{checkpoint.checkpoint_id}（路线 {checkpoint.route_id}）
          </span>
        ) : null}
        {tutor.sessionId ? <span data-testid="tutor-session-id">{tutor.sessionId}</span> : null}
      </div>
      <div className="tutor-learn-controls">
        {tutor.phase === "speaking" ? (
          <button type="button" onClick={() => void tutor.bargeIn()} data-testid="tutor-barge-in">
            我要说话（打断）
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

      <section className="tutor-learn-transcript" aria-label="对话记录" data-testid="tutor-transcript">
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
            disabled={recorder.recording || asrBusy || !tutor.sessionId}
            onClick={() => void recorder.toggle()}
            data-testid="tutor-record"
          >
            {recorder.recording ? "停止录音" : "按此语音输入"}
          </button>
        </section>
      ) : (
        <p data-testid="tutor-completed">这次学习完成了。</p>
      )}
    </aside>
  );

  if (tutor.phase === "completed" || tutor.questionCompleted) {
    return (
      <div className="ks-focus-page tutor-learn-page">
        <FocusWorkspace
          ariaLabel="一对一学习完成"
          prompt={<><span>题目</span><div><h1><MathText value={question?.stem ?? ""} /></h1></div></>}
          rail={rail}
        >
          <section className="tutor-learn-done" aria-label="学习完成">
            <h2>这道题学完了</h2>
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
      </FocusWorkspace>
    </div>
  );
}

function studentNameSafe(studentId: string): string {
  return studentId.trim() || "browser-student";
}
