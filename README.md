# teaching-tools

`teaching-tools` 当前是一个以 Web 为主的教学应用仓库，面向“离线出题入库 + 在线做题运行时”这两条链路。

## Repo Layout

- `docs/`: 项目级产品、架构、数据模型、接口与交互文档
- `web/`: Web 应用代码
  - `frontend/`: React + Vite 前端
  - `backend/`: Express + SQLite 后端
  - `shared/`: 前后端共享契约与任务定义
- `exercises/`: 教学 spec 与题型设计草案

## Read First

- 项目文档入口：[`docs/README.md`](docs/README.md)
- Web 本地开发：[`web/README.md`](web/README.md)

## Notes

- `web/trigonometry-practice.html` 是早期原型，仅保留为视觉与交互参考，不是当前实现入口。
- 仓库当前不再维护 `wxapp/` 小程序端；产品与工程真相源均以 Web 方案为准。
