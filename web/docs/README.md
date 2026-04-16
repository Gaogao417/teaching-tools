# Web Docs

本目录是 Web 版项目唯一有效的设计文档入口。

目标是把“产品目标、系统分层、共享契约、页面交互、页面职责、实施顺序”拆开管理，避免在单份文档里混写，也避免旧文档和新文档并存造成双重真相源。

## 文档分层

- `01-product-spec.md`
  说明产品目标、用户、核心流程和验收标准。
- `02-system-architecture.md`
  说明前端、后端、shared 契约和页面容器之间的职责边界。
- `03-domain-model.md`
  说明题目、session、结果、render schema 等领域模型。
- `04-api-contracts.md`
  说明 API 资源、请求响应、错误语义和兼容策略。
- `05-interaction-model.md`
  说明全局交互原则、页面状态机、反馈节奏和题型交互模式。
- `features/`
  每个页面或功能自己的 spec，只写该 feature 的职责和验收，不重复系统级信息。
- `execution/`
  实施顺序、测试计划、迁移计划。
- `adr/`
  记录重要架构决策，避免关键决定埋在长文里。

建议阅读顺序：

1. `01-product-spec.md`
2. `02-system-architecture.md`
3. `03-domain-model.md`
4. `04-api-contracts.md`
5. `05-interaction-model.md`
6. `features/`
7. `execution/`
8. `adr/`

## 写作规则

- 一份文档只回答一个主问题。
- 页面文档不重复系统架构。
- 任务计划不发明新契约。
- `shared/contracts.ts` 变更时，`03-domain-model.md` 与 `04-api-contracts.md` 必须同步。
- 重要边界决策优先写成 ADR，再落进实现文档。
- 新增题型时，先更新 `02`、`03`、`04`，再写 feature 文档和实现。
- 文档里的“当前默认决策”一旦变化，必须同步清理失效段落，而不是追加新口径。
- 产品文档默认使用 `skill unit`、`example`、`exercise` 这套术语；如果实现文档仍出现 `practice`，应视为当前代码或路由命名。

## 当前状态

- `docs/` 已替代旧的页面级 design reports 和早期 plan/task 文档。
- `web/` 下不再保留第二套设计规范文档。
- 如果后续需要保留历史讨论，应进入 `adr/` 或单独的 issue / PR 记录，而不是重新放回根目录。
