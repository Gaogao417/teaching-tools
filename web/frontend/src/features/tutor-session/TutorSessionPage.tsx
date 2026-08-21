/**
 * /tutor/:tpId 页面（Phase 5 remediation 波次 E）。
 *
 * UI 明确区分「回答」与「提问」两个入口（计划 §3.2）；文字与录音共用
 * POST /turns（录音先走 Qwen ASR 端点转写）。Workspace 只渲染后端返回的
 * 已验证 presentation（student_view = assessment 形态 ActionContract），
 * 前端不解析 action_template JSON、不持有 truth。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { MathText } from "../../components/math/MathText";
import { useCoachRecorder } from "../../presentation/coach/useCoachRecorder";
import { MediaSessionController } from "../../presentation/audio/MediaSessionController";
import { tutorApi } from "./tutorApi";
import { useTutorSession } from "./useTutorSession";

const STATE_LABELS: Record<string, string> = {
  starting: "正在开始…",
  speaking: "老师讲解中（可打断）",
  awaitingInput: "等你发言",
  thinking: "老师思考中…",
  workspaceActive: "轮到你操作",
  interrupted: "已打断",
  recovering: "连接恢复中",
  completed: "本次学习完成",
};

interface WorkspacePanelProps {
  workspace: ReturnType<typeof useTutorSession>["workspace"];
  state: string;
  onSubmit: (evidence: Record<string, unknown>) => void;
}

/** 学生面 Workspace：只消费 student_view（assessment 形态 contract）。 */
function WorkspacePanel({ workspace, state, onSubmit }: WorkspacePanelProps) {
  const [value, setValue] = useState("");
  const action = workspace[0];
  useEffect(() => setValue(""), [action?.action_id]);
  if (!action) return null;
  const contract = action.student_view;
  // 待操作步挂起时，awaitingInput/interrupted 也允许提交（workspace 与
  // 机器态可能不同相：pending 来自 backend 权威，面板只看可交互性）。
  const disabled = !["workspaceActive", "awaitingInput", "interrupted"].includes(state);
  return (
    <section className="tutor-workspace" aria-label="操作区">
      <h3>{contract.title || "这一步交给你"}</h3>
      {contract.instruction ? (
        <p>
          <MathText value={contract.instruction} />
        </p>
      ) : null}
      {contract.kind === "select-option" ? (
        <div className="tutor-workspace-options">
          {contract.input.options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() =>
                onSubmit({
                  actionId: contract.actionId,
                  sourceStepId: contract.sourceStepId,
                  kind: contract.kind,
                  version: contract.version,
                  value: option.value,
                })
              }
            >
              <MathText value={option.labelLatex} />
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!value.trim()) return;
            onSubmit({
              actionId: contract.actionId,
              sourceStepId: contract.sourceStepId,
              kind: contract.kind,
              version: contract.version,
              value: value.trim(),
            });
          }}
        >
          <input
            value={value}
            placeholder={"placeholder" in contract.input ? contract.input.placeholder : "输入你的答案"}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            aria-label="workspace 答案输入"
          />
          <button type="submit" disabled={disabled || !value.trim()}>
            提交这一步
          </button>
        </form>
      )}
    </section>
  );
}

export function TutorSessionPage() {
  const { tpId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const restoreSessionId = searchParams.get("session") ?? undefined;
  const session = useTutorSession(tpId, { restoreSessionId });
  const [answerText, setAnswerText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [asrBusy, setAsrBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const startedRef = useRef(false);
  const mediaRef = useRef<MediaSessionController | null>(null);

  useEffect(() => {
    if (startedRef.current || !tpId) return;
    startedRef.current = true;
    if (restoreSessionId) {
      void session.restore(restoreSessionId);
    } else {
      void session.start();
    }
  }, [restoreSessionId, session, tpId]);
  // 刷新可恢复：会话 id 落到 URL（replace 不产生历史栈），F5 后走 GET restore。
  useEffect(() => {
    if (!session.sessionId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("session") === session.sessionId) return;
    url.searchParams.set("session", session.sessionId);
    window.history.replaceState(null, "", url.toString());
  }, [session.sessionId]);


  const submitAnswer = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setAnswerText("");
      void session.submitTurn({ input_kind: "reasoning_utterance", text: text.trim() });
    },
    [session],
  );

  const submitQuestion = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setQuestionText("");
      void session.submitTurn({ input_kind: "question_asked", text: text.trim() });
    },
    [session],
  );

  const recorder = useCoachRecorder({
    disabled: asrBusy || !session.sessionId,
    media: undefined,
    onAudio: (audio) => {
      if (!session.sessionId) return;
      setAsrBusy(true);
      setNotice("正在识别你的话…");
      tutorApi
        .asr(session.sessionId, { dataUrl: audio.dataUrl, durationMs: audio.durationMs })
        .then((result) => {
          setNotice(undefined);
          if (result.transcript.trim()) submitAnswer(result.transcript);
        })
        .catch(() => {
          setNotice("语音识别暂不可用，请用文字输入。");
        })
        .finally(() => setAsrBusy(false));
    },
    onError: (message) => setNotice(message),
  });
  void mediaRef;

  const checkpoint = session.currentCheckpoint;

  return (
    <main className="tutor-session-page">
      <header>
        <h2>智能一对一 · {tpId}</h2>
        <div className="tutor-status">
          <span data-testid="tutor-state">{STATE_LABELS[session.state] ?? session.state}</span>
          {checkpoint ? (
            <span data-testid="tutor-checkpoint">
              当前进度 {checkpoint.part_id}/{checkpoint.checkpoint_id}（路线 {checkpoint.route_id}）
            </span>
          ) : null}
          {session.sessionId ? <span data-testid="tutor-session-id">{session.sessionId}</span> : null}
        </div>
        {session.state === "speaking" ? (
          <button type="button" onClick={() => void session.bargeIn()} data-testid="tutor-barge-in">
            我要说话（打断）
          </button>
        ) : null}
        {session.state === "interrupted" ? (
          <button type="button" onClick={session.resumeFromInterrupt}>
            继续学习
          </button>
        ) : null}
        {session.state === "recovering" ? (
          <button type="button" onClick={session.retry} data-testid="tutor-retry">
            重试
          </button>
        ) : null}
      </header>

      {notice ? <p className="tutor-notice">{notice}</p> : null}
      {session.error ? <p className="tutor-error">{session.error}</p> : null}

      <section className="tutor-transcript" aria-label="对话记录" data-testid="tutor-transcript">
        {session.transcript.map((entry) => (
          <p key={entry.id} className={entry.role === "tutor" ? "tutor-says" : "student-says"}>
            <b>{entry.role === "tutor" ? "老师" : "我"}：</b>
            <MathText value={entry.text} />
          </p>
        ))}
      </section>

      <WorkspacePanel
        workspace={session.workspace}
        state={session.state}
        onSubmit={(evidence) => void session.submitWorkspaceEvidence(evidence)}
      />

      {session.state !== "completed" ? (
        <section className="tutor-inputs" aria-label="发言区">
          <form
            className="tutor-answer"
            onSubmit={(event) => {
              event.preventDefault();
              submitAnswer(answerText);
            }}
          >
            <input
              value={answerText}
              placeholder="说说这一步你是怎么想的（回答）"
              onChange={(event) => setAnswerText(event.target.value)}
              aria-label="回答输入"
            />
            <button type="submit" data-testid="tutor-submit-answer">
              回答
            </button>
          </form>
          <form
            className="tutor-question"
            onSubmit={(event) => {
              event.preventDefault();
              submitQuestion(questionText);
            }}
          >
            <input
              value={questionText}
              placeholder="向老师提问（提问）"
              onChange={(event) => setQuestionText(event.target.value)}
              aria-label="提问输入"
            />
            <button type="submit" data-testid="tutor-submit-question">
              提问
            </button>
          </form>
          <button
            type="button"
            disabled={recorder.recording || asrBusy || !session.sessionId}
            onClick={() => void recorder.toggle()}
            data-testid="tutor-record"
          >
            {recorder.recording ? "停止录音" : "按此语音回答"}
          </button>
        </section>
      ) : (
        <p data-testid="tutor-completed">这次学习完成了。</p>
      )}
    </main>
  );
}
