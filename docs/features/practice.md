# Practice Feature Spec

## Summary

练习页是 `WorkspaceShell` 内部的在线 runtime 主路由。

它的职责是承载学生做题流程，而不是承载离线出题流程。

当前主链路：

```text
WorkspaceShell
  -> PracticePage
    -> ExerciseRuntimeHost
```

## Responsibilities

`PracticePage` 负责：

- 启动和恢复 session
- 挂载当前 runtime
- 维护页面级计时、草稿与完成流转
- 调度页面级 feedback effect
- 将后端判定后的提交动作持久化为可复盘事件

`PracticePage` 不负责：

- 生成题目
- 调用 Python 出题
- 调用 Wolfram 校验
- 维护题库审核状态
- 展示完整解法或承担历史结果分析

Learn、Practice、Review 的路由与状态边界见 [learning-modes.md](./learning-modes.md)。

`ExerciseRuntimeHost` 负责：

- 消费 `ExerciseRuntimeSpec`
- 渲染左侧工作区与右侧引导区
- 收集动作并转成 `RuntimeActionEvent`

## Relation To Scenario Bank

对 frontend 来说，题目来源是 backend 内部细节。

不论 backend 当前使用：

- 内置模板实例
- 数据库中的 approved scenario

frontend 都只消费同一个 `ExerciseRuntimeSpec`。

这意味着：

- authoring pipeline 的演进不应改变前端主契约
- scenario 选择逻辑不应泄漏到练习页组件中

## Acceptance

- 学生始终在左侧完成主操作
- 练习页不依赖题型级页面分支
- runtime 可恢复
- authoring pipeline 的存在不会改变练习页 API 形态
