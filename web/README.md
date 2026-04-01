# Web 重构工程

## 目录

- `frontend/`: React + Vite 前端
- `backend/`: Express + SQLite 后端
- `shared/`: 前后端共享契约
- `trigonometry-practice.html`: 旧原型，保留为视觉与逻辑参考

## 本地开发

一键启动：

```bash
cd web
chmod +x dev.sh
./dev.sh
```

脚本会：

- 自动从 `.env.example` 复制 `.env`
- 检查前后端依赖是否已安装
- 同时启动 backend 和 frontend
- 按 `Ctrl+C` 时一起关闭

后端：

```bash
cd web/backend
npm install
npm run dev
```

前端：

```bash
cd web/frontend
npm install
VITE_API_BASE_URL=http://localhost:3001 npm run dev
```

## 环境变量

后端常用：

- `PORT`
- `HOST`
- `FRONTEND_ORIGIN`
- `SQLITE_PATH`

前端常用：

- `VITE_API_BASE_URL`

## 部署说明

- 前端构建产物部署到腾讯云 CloudBase 静态网站托管
- 后端部署到腾讯云 Lighthouse，建议使用 `Nginx + Node.js`
- API 域名通过 HTTPS 暴露，并将前端域名配置到 `FRONTEND_ORIGIN`
- CloudBase 需开启 SPA 路由回退，保证 `/practice/:taskId`、`/result/:sessionId` 可直接访问
