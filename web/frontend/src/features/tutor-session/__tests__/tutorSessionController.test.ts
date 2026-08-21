/**
 * 波次 E controller 测试：XState 状态机迁移 + API 客户端合同（mock fetch）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { tutorSessionMachine } from "../tutorSessionMachine";
import { tutorApi } from "../tutorApi";

describe("tutorSessionMachine", () => {
  it("starting → speaking → awaitingInput：开场回合迁移", () => {
    const actor = createActor(tutorSessionMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe("starting");
    actor.send({ type: "SESSION_STARTED", sessionId: "TS-1", revision: 1 });
    expect(actor.getSnapshot().value).toBe("speaking");
    expect(actor.getSnapshot().context.sessionId).toBe("TS-1");
    actor.send({ type: "VOICE_DONE", revision: 2 });
    expect(actor.getSnapshot().value).toBe("awaitingInput");
  });

  it("回答回合：awaitingInput → thinking → speaking（voice）", () => {
    const actor = createActor(tutorSessionMachine);
    actor.start();
    actor.send({ type: "SESSION_STARTED", sessionId: "TS-1", revision: 1 });
    actor.send({ type: "VOICE_DONE", revision: 2 });
    actor.send({ type: "SUBMIT_INPUT" });
    expect(actor.getSnapshot().value).toBe("thinking");
    actor.send({ type: "TURN_RECEIVED", revision: 3, turnId: "t1", hasVoice: true, hasWorkspace: false, completed: false });
    expect(actor.getSnapshot().value).toBe("speaking");
    expect(actor.getSnapshot().context.revision).toBe(3);
    expect(actor.getSnapshot().context.lastTurnId).toBe("t1");
  });

  it("workspace 回合：VOICE_DONE 带 workspace → workspaceActive → 提交证据回 thinking", () => {
    const actor = createActor(tutorSessionMachine);
    actor.start();
    actor.send({ type: "SESSION_STARTED", sessionId: "TS-1", revision: 1 });
    actor.send({ type: "VOICE_DONE", revision: 2, hasWorkspace: true } as never);
    expect(actor.getSnapshot().value).toBe("workspaceActive");
    actor.send({ type: "WORKSPACE_SUBMITTED" });
    expect(actor.getSnapshot().value).toBe("thinking");
  });

  it("barge-in：speaking → interrupted（记录时延）→ resume", () => {
    const actor = createActor(tutorSessionMachine);
    actor.start();
    actor.send({ type: "SESSION_STARTED", sessionId: "TS-1", revision: 1 });
    actor.send({ type: "BARGE_IN", latencyMs: 42 });
    expect(actor.getSnapshot().value).toBe("interrupted");
    expect(actor.getSnapshot().context.lastBargeInLatencyMs).toBe(42);
    actor.send({ type: "RESUME_FROM_INTERRUPT" });
    expect(actor.getSnapshot().value).toBe("awaitingInput");
  });

  it("失败 → recovering → retry 回 awaitingInput；completed 为终态", () => {
    const actor = createActor(tutorSessionMachine);
    actor.start();
    actor.send({ type: "FAILED", message: "网络断了" });
    expect(actor.getSnapshot().value).toBe("recovering");
    expect(actor.getSnapshot().context.errorMessage).toBe("网络断了");
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("awaitingInput");
    expect(actor.getSnapshot().context.errorMessage).toBeUndefined();
    actor.send({ type: "COMPLETED" });
    expect(actor.getSnapshot().value).toBe("completed");
  });

  it("RESTORED：刷新恢复直接进入 awaitingInput", () => {
    const actor = createActor(tutorSessionMachine);
    actor.start();
    actor.send({ type: "RESTORED", sessionId: "TS-9", revision: 12 });
    expect(actor.getSnapshot().value).toBe("awaitingInput");
    expect(actor.getSnapshot().context.sessionId).toBe("TS-9");
    expect(actor.getSnapshot().context.revision).toBe(12);
  });
});

describe("tutorApi（mock fetch）", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("start 返回开场回合；错误映射 message/status/code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ session_id: "TS-1", opening: { voice: [] } }), { status: 201 }),
    );
    const started = await tutorApi.start("TP-SMV-001", "s");
    expect(started.session_id).toBe("TS-1");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "PLAN_NOT_GOLDEN", message: "不在白名单" } }), { status: 403 }),
    );
    const error = await tutorApi.start("TP-XXX-1", "s").catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { status?: number }).status).toBe(403);
    expect((error as Error).message).toBe("不在白名单");
  });

  it("turn 发送 clientTurnId + expectedRevision + 六类输入", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          session_id: "TS-1",
          revision: 4,
          client_turn_id: "t-1",
          idempotent_replay: false,
          mode: "guided_solve",
          current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
          decision: null,
          voice: [],
          workspace: [],
          event_cursor: 9,
        }),
        { status: 200 },
      ),
    );
    const turn = await tutorApi.turn("TS-1", "t-1", 3, { input_kind: "reasoning_utterance", text: "内错角相等" });
    expect(turn.revision).toBe(4);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      clientTurnId: "t-1",
      expectedRevision: 3,
      input: { input_kind: "reasoning_utterance", text: "内错角相等" },
    });
  });
});
