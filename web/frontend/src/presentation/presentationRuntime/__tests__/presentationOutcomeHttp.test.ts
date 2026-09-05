/**
 * F7 Step 6：Presentation outcome 真实 HTTP 集成（ledger 增补 20 偏差 3 的
 * 网络面证据）。fake client 无法证明幂等与 revision 行为——这里用本地
 * node:http 服务 + 真 `HttpTutorRuntimeClient`（真 fetch）覆盖：
 *
 * 1. 「服务端已提交但响应丢失」：socket destroy → 客户端网络错误、token 保留
 *    → 同键 adopt 重发**同 client_request_id 同 payload** → 服务端幂等回放
 *    200 → acked；adapter 全程只 present 一次（不重新呈现）。
 * 2. 「HTTP 200 但 turn=revision-conflict」：应用层确定性失败——释放 token、
 *    提示、不重试循环。
 * 3. 「failed acked 后 restore 重投同键」：维持暂停——不自动重播、零新请求。
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { HttpTutorRuntimeClient, type ValidatedSessionSnapshot } from "../../../api/tutorRuntimeClient";
import { PresentationRuntimeController } from "../PresentationRuntimeController";
import { createCapabilityRegistry } from "../capabilityRegistry";
import type { PendingPresentationOutcomeRequest, PresentationAdapterResult, PresentationPresentRequest, PresentationRuntimePorts, PresentationToolAdapter } from "../types";
import {
  pendingVoicePresentation,
  runtimeSnapshotRaw,
  validFromRaw,
} from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";

interface RecordedRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

interface HttpHarness {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

function startServer(handle: (request: RecordedRequest, respond: (status: number, payload: unknown) => void, dropConnection: () => void) => void): Promise<HttpHarness> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
      const recorded: RecordedRequest = { method: request.method ?? "POST", url: request.url ?? "", body };
      requests.push(recorded);
      handle(
        recorded,
        (status, payload) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(payload));
        },
        () => { response.socket?.destroy(); },
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function singlePresentAdapter(result: PresentationAdapterResult): { adapter: PresentationToolAdapter; get presentCalls(): number } {
  let presentCalls = 0;
  return {
    get presentCalls() { return presentCalls; },
    adapter: {
      supports: (action) => action.kind === "voice",
      present: () => {
        presentCalls += 1;
        return Promise.resolve(result);
      },
    },
  };
}

function makePorts(client: HttpTutorRuntimeClient, adopted: ValidatedSessionSnapshot[]): PresentationRuntimePorts {
  return {
    reportOutcome: (request: PendingPresentationOutcomeRequest) =>
      client.reportPresentationOutcome(request.sessionId, request.actionId, {
        sequenceId: request.sequenceId,
        ordinal: request.ordinal,
        outcome: request.outcome,
        ...(request.failureClass !== undefined ? { failureClass: request.failureClass } : {}),
        ...(request.message !== undefined ? { message: request.message } : {}),
        clientRequestId: request.clientRequestId,
        expectedRevision: request.expectedRevision,
      }),
    adoptOutcomeSnapshot: (snapshot, expectedSessionId) => {
      expect(snapshot.session_id).toBe(expectedSessionId);
      adopted.push(snapshot);
      return true;
    },
    onProtocolAnomaly: () => undefined,
    onNotice: () => undefined,
    onStateChanged: () => undefined,
    isDefinitiveFailure: (failure) =>
      typeof failure === "object" && failure !== null && "status" in failure && typeof (failure as { status: unknown }).status === "number" && (failure as { status: number }).status >= 400 && (failure as { status: number }).status < 500,
  };
}

function pendingSnapshot(revision = 12): ValidatedSessionSnapshot {
  return validFromRaw(runtimeSnapshotRaw({ pendingPresentation: true, revision }));
}

describe("Presentation outcome 真实 HTTP 集成（幂等 / revision / 失败暂停）", () => {
  const harnesses: Array<() => Promise<void>> = [];
  afterAll(async () => {
    await Promise.all(harnesses.splice(0).map((close) => close()));
  });

  beforeAll(() => {
    // jsdom 环境兜底：真 fetch（Node undici）打本地 127.0.0.1 服务。
    if (typeof globalThis.fetch !== "function") {
      throw new Error("fetch unavailable in test environment");
    }
  });

  it("服务端已提交但响应丢失：同 client_request_id 同 payload 重试 → 幂等回放；adapter 只 present 一次", async () => {
    /** 服务端已应用的 outcome（重试时幂等回放同一份响应快照）。 */
    let appliedResponse: Record<string, unknown> | undefined;
    let dropped = false;
    const harness = await startServer((request, respond, dropConnection) => {
      if (!request.url.includes("/presentation-actions/VA-bt01-narrate/outcomes")) {
        respond(404, { error: { code: "NOT_FOUND" } });
        return;
      }
      if (appliedResponse !== undefined) {
        respond(200, appliedResponse); // 幂等回放（同 key 已应用）
        return;
      }
      appliedResponse = runtimeSnapshotRaw({ revision: 99 });
      if (!dropped) {
        dropped = true;
        dropConnection(); // 已提交，但响应丢失
        return;
      }
      respond(200, appliedResponse);
    });
    harnesses.push(harness.close);

    const client = new HttpTutorRuntimeClient(harness.url);
    const voice = singlePresentAdapter({ outcome: "presented" });
    const adopted: ValidatedSessionSnapshot[] = [];
    const controller = new PresentationRuntimeController(createCapabilityRegistry([voice.adapter]), [voice.adapter], makePorts(client, adopted));

    controller.adopt(pendingSnapshot(12));
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1), { timeout: 3000 });
    // 网络失败 → token 保留；同键新快照（restore 重投）触发同请求重发。
    controller.adopt(pendingSnapshot(12));
    await vi.waitFor(() => expect(harness.requests).toHaveLength(2), { timeout: 3000 });
    expect(harness.requests[1]!.body).toEqual(harness.requests[0]!.body);
    expect(harness.requests[1]!.body.client_request_id).toBe("pres-outcome:TS-99000801:PS-0001:0:VA-bt01-narrate:presented");
    await vi.waitFor(() => expect(adopted).toHaveLength(1), { timeout: 3000 });
    expect(voice.presentCalls).toBe(1); // 全程不重新呈现
    expect(harness.requests[0]!.url).toBe("/api/vnext/tutor-sessions/TS-99000801/presentation-actions/VA-bt01-narrate/outcomes");
  });

  it("HTTP 200 + turn revision-conflict：释放 token、不重试循环", async () => {
    const harness = await startServer((request, respond) => {
      if (!request.url.includes("/presentation-actions/VA-bt01-narrate/outcomes")) {
        respond(404, { error: { code: "NOT_FOUND" } });
        return;
      }
      respond(200, runtimeSnapshotRaw({
        revision: 13,
        turn: { status: "revision-conflict", failure: { category: "presentation", failure_class: "STALE_REVISION", retryable: true } },
      }));
    });
    harnesses.push(harness.close);

    const client = new HttpTutorRuntimeClient(harness.url);
    const voice = singlePresentAdapter({ outcome: "presented" });
    const adopted: ValidatedSessionSnapshot[] = [];
    const notices: string[] = [];
    const ports = makePorts(client, adopted);
    ports.onNotice = (message) => { notices.push(message); };
    const controller = new PresentationRuntimeController(createCapabilityRegistry([voice.adapter]), [voice.adapter], ports);

    controller.adopt(pendingSnapshot(12));
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1), { timeout: 3000 });
    await vi.waitFor(() => expect(notices).toHaveLength(1), { timeout: 3000 });
    expect(notices[0]).toContain("revision-conflict");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.requests).toHaveLength(1); // 无重试循环
    expect(adopted).toHaveLength(0); // 未采用
  });

  it("failed acked 后 restore 重投同键：维持暂停，不自动重播、零新请求", async () => {
    const harness = await startServer((request, respond) => {
      if (!request.url.includes("/presentation-actions/VA-bt01-narrate/outcomes")) {
        respond(404, { error: { code: "NOT_FOUND" } });
        return;
      }
      respond(200, runtimeSnapshotRaw({ revision: 23 })); // failed 已接受：cursor 停留，快照无 pending
    });
    harnesses.push(harness.close);

    const client = new HttpTutorRuntimeClient(harness.url);
    const voice = singlePresentAdapter({ outcome: "failed", failureClass: "provider_failure" });
    const adopted: ValidatedSessionSnapshot[] = [];
    const controller = new PresentationRuntimeController(createCapabilityRegistry([voice.adapter]), [voice.adapter], makePorts(client, adopted));

    controller.adopt(pendingSnapshot(22));
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1), { timeout: 3000 });
    expect(harness.requests[0]!.body).toMatchObject({ outcome: "failed", failure_class: "provider_failure" });
    await vi.waitFor(() => expect(adopted).toHaveLength(1), { timeout: 3000 });
    // restore 重投同键（服务端 cursor 停留当前 action 的合法重投）。
    controller.adopt(pendingSnapshot(22));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.requests).toHaveLength(1); // 零新请求
    expect(voice.presentCalls).toBe(1); // 不自动重播
  });
});
