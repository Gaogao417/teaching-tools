import "./loadEnv";
import http from "node:http";
import { createApp } from "./app";
import { attachRealtimeCoach } from "./services/coach/realtimeCoachRelay";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";

const app = createApp();
const server = http.createServer(app);
// Full-duplex realtime voice coach relay (browser <-> DashScope qwen-omni-realtime).
attachRealtimeCoach(server);

server.listen(port, host, () => {
  console.log(`backend listening on http://${host}:${port} (ws: /api/coach-realtime)`);
});
