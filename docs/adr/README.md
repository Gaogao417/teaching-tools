# ADR

本目录记录项目级关键架构决策。

建议优先关注：

- 为什么项目采用 runtime-first 在线架构（ADR-001）
- 为什么在线 runtime 与离线 authoring pipeline 必须分开（ADR-002）
- 为什么 frontend 只消费 runtime，而不直接感知题库和出题工具链（ADR-001/002）
- 为什么几何画布交互层用 XState 管理工具流程，而把几何实体留给 GeometryModel（ADR-003）
- 为什么实时页面状态由 frontend Action Runtime 管理，而 backend 只提供教学计划、私有判题、session 与 AI coach（ADR-004）

## 目录

- [ADR-001 Runtime-first 在线架构](./ADR-001-runtime-first-architecture.md)
- [ADR-002 离线 Authoring / 在线 Runtime 分离](./ADR-002-offline-authoring-online-runtime.md)
- [ADR-003 XState 驱动的 Geometry Canvas 交互层](./ADR-003-xstate-geometry-canvas.md)
- [ADR-004 前端 Action Runtime 与后端教学计划边界](./ADR-004-frontend-action-runtime.md)
