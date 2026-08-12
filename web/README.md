# Web App

`web/` 目录承载当前学生可用的在线做题系统。

## Directory

- `frontend/`: React + Vite 前端
- `backend/`: Express + SQLite 后端
- `shared/`: 共享契约、任务定义与题型共享类型
- `trigonometry-practice.html`: 旧原型，仅作参考

## Canonical Docs

- 项目级文档入口：[`../docs/README.md`](../docs/README.md)
- `../docs/` 是当前唯一有效的产品与架构文档来源

## Local Development

一键启动：

```bash
cd web
chmod +x dev.sh
./dev.sh
```

脚本会：

- 自动从 `.env.example` 复制 `.env`
- 检查前后端依赖
- 同时启动 backend 与 frontend

分别启动：

后端：

```bash
cd web/backend
npm install
source ~/.zshrc 2>/dev/null  # 本机 API key / Claude Code GLM gateway
npm run dev
```

前端：

```bash
cd web/frontend
npm install
VITE_API_BASE_URL=http://localhost:3001 npm run dev
```

## Environment Variables

后端常用：

- `PORT`
- `HOST`
- `FRONTEND_ORIGIN`
- `SQLITE_PATH`
- `DASHSCOPE_API_KEY`（Qwen ASR 与 TTS，仅后端）
- `COACH_CLAUDE_MODEL`（默认 `glm-5.2`，由 Claude Code 调用）
- `COACH_ASR_MODEL`（默认 `qwen3-asr-flash`）
- `COACH_TTS_MODEL` / `COACH_TTS_VOICE`（默认 `qwen3-tts-instruct-flash` / `Cherry`，仅 `COACH_ANSWER_PROVIDER=claude-code` 时生效）
- `COACH_ANSWER_PROVIDER`（默认 `claude-code`，即 ASR→LLM→TTS 三段；设为 `omni` 改用单次 `qwen3.5-omni-plus` 调用,直接听学生语音并用自然语音作答）
- `COACH_OMNI_MODEL` / `COACH_OMNI_VOICE` / `COACH_OMNI_TIMEOUT_MS`（omni 链路参数，默认 `qwen3.5-omni-plus` / `Tina` / `45000`；复用同一个 `DASHSCOPE_API_KEY`,限北京区域。有效 omni 音色: Tina/Ethan/Serena）
- `COACH_COSY_MODEL` / `COACH_COSY_VOICE` / `COACH_COSY_TIMEOUT_MS`（CosyVoice-v3-plus 链路，默认 `cosyvoice-v3-plus` / `longanyang` / `45000`；走 `DASHSCOPE_WS_BASE_URL` WebSocket）
- `COACH_REALTIME_MODEL` / `COACH_REALTIME_VOICE` / `DASHSCOPE_REALTIME_WS_URL`（全双工实时对话 `qwen3.5-omni-plus-realtime`，默认音色 `Ethan`；教练面板「实时对话」按钮启停,浏览器流式采音↔后端中继↔DashScope）

前端教练面板顶部有 **Omni / CosyVoice** 分段切换,按请求选择语音链路(偏好存 localStorage);不传时回退 `COACH_ANSWER_PROVIDER`。

前端常用：

- `VITE_API_BASE_URL`

## Deployment

- 前端可部署到静态站点托管
- 后端可部署到 Node.js 运行环境
- API 通过 HTTPS 暴露，并将前端域名配置到 `FRONTEND_ORIGIN`
- 前端部署需开启 SPA 路由回退，保证 `/learn/:taskId`、`/practice/:taskId` 与 `/review/:taskId` 可直达
