import "./loadEnv";
import http from "node:http";
import { createApp } from "./app";
import { attachRealtimeCoach } from "./transport/ws/realtimeCoachTransport";
import { createGenerationWakeChannel, startGenerationRecoveryWorker } from "./services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";

// F7 P3（A5 pending 轮询）：v9 mutation 预约后 notify → worker wake 即时驱动；
// v7 缺省链不挂通道（零变化）。通道先建、worker 启动后订阅——启动窗口内的
// 通知由 worker 初始扫描 + 10s 周期兜底。
const generationEnabled = process.env.TUTOR_VNEXT_GENERATION === "1" && Boolean(process.env.TUTOR_VNEXT_ROOT?.trim());
const generationWake = createGenerationWakeChannel();

const app = createApp(generationEnabled ? { vnext: { generationWake: generationWake.notify } } : {});
const server = http.createServer(app);
// Full-duplex realtime voice coach relay (browser <-> DashScope qwen-omni-realtime).
attachRealtimeCoach(server);

server.listen(port, host, () => {
  console.log(`backend listening on http://${host}:${port} (ws: /api/coach-realtime)`);
});

// Recovery runs independently of read-only HTTP GET. Concurrent HTTP commands
// share the same persisted lease and kernel fencing check.
if (generationEnabled) {
  void import("./transport/http/vnextTutorRoutes").then((routes) => {
    const worker = startGenerationRecoveryWorker(routes.createApplication, (error) => console.error("generation recovery failed", error));
    const unsubscribe = generationWake.subscribe(() => worker.wake());
    server.once("close", () => {
      unsubscribe();
      worker.stop();
    });
  });
}
