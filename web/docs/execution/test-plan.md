# Test Plan

## 摘要

测试必须覆盖“契约、运行时、交互边界”三层，而不是只测 API 或只测页面截图。

当前默认自动化入口为：

- backend: `npm test`
- frontend: `npm run build` 作为结构回归

## 契约测试

- `shared/contracts.ts` 与后端返回结构一致
- 仅验证 runtime-first 字段与行为
- `PracticeSessionSnapshot` 与 `RuntimeActionResponse` 不重新依赖页面特化字段

## 后端运行时测试

- session 创建、恢复、完成
- 当前步骤允许和禁止的动作
- 正确 / 错误 / 自动推进 / 整组完成
- 结果持久化与历史查询
- `LEGACY_SESSION_EXPIRED` 显式错误语义

## 前端结构回归

- `WorkspaceShell -> TaskOverviewPanel / PracticePage / ResultPage` 路由组合可正常构建
- `ExerciseRuntimeHost` 维持 `WorkspaceScene + GuidePanel + FeedbackController` 分层
- 左侧工作区是唯一操作区，右侧不出现主输入控件

## 集成验收场景

- `meaning` 一整组完成
- `ratioToSide` 一整组完成
- `guidedSolve` 多步推进完成
- 刷新后恢复 session
- 整组完成后进入结果流

## 回归清单

- 新增同引擎任务时，不得向 `PracticePage` 添加任务级分支
- 新增 shared 字段后，必须同步 `docs/03` 与 `docs/04`
- 调整练习交互后，必须重新验证“左侧操作 / 右侧引导”边界
