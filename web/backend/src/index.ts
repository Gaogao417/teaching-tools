import "./loadEnv";
import http from "node:http";
import { createApp } from "./app";
import { attachRealtimeCoach } from "./transport/ws/realtimeCoachTransport";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";

const app = createApp();
const server = http.createServer(app);
// Full-duplex realtime voice coach relay (browser <-> DashScope qwen-omni-realtime).
attachRealtimeCoach(server);

server.listen(port, host, () => {
  console.log(`backend listening on http://${host}:${port} (ws: /api/coach-realtime)`);
});

// Recovery runs independently of read-only HTTP GET. Concurrent HTTP commands
// share the same persisted lease and kernel fencing check.
if (process.env.TUTOR_VNEXT_GENERATION === "1" && process.env.TUTOR_VNEXT_ROOT) {
  void Promise.all([
    import("./services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker"),
    import("./transport/http/vnextTutorRoutes"),
  ]).then(([worker, routes]) => {
    const stop = worker.startGenerationRecoveryWorker(routes.createApplication, (error) => console.error("generation recovery failed", error));
    server.once("close", stop);
  });
}
