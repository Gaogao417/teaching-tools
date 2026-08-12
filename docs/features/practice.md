# Practice Feature Spec

## Summary

练习页是 `WorkspaceShell` 内部的本地 Action 训练主路由。

它的职责是在答案公开的 guard、即时反馈和页面 affordance 下，训练学生快速、准确地完成正确 Action
序列，而不是保护答案或承载离线出题流程。

目标主链路：

```text
WorkspaceShell
  -> PracticePage
    -> ActionRuntimeFrame
      -> LocalTraining Action Runtime
      -> TrainingSyncQueue

pinned legacy session
  -> ExerciseRuntimeHost compatibility path
```

## Responsibilities

目标 `PracticePage` / Action Runtime 负责：

- 启动和恢复 session
- 一次加载当前题的完整 `ExercisePlan`
- 挂载 `LocalTraining` runtime，维护 Action 草稿、本地正确性和 world
- 记录 Action entry → completion 的耗时、正确/错误候选、BACK/CLEAR/hint/Coach 使用
- 在 wrong candidate 后立即反馈且不推进，在 correct completion 后应用 `DomainCommand` 并进入下一 Action
- 把 checkpoint/result 写入本地持久队列并异步上传

`PracticePage` 不负责：

- 生成题目
- 调用 Python 出题
- 调用 Wolfram 校验
- 维护题库审核状态
- 展示完整解法或承担历史结果分析
- 等待 backend 重新判定 Practice 的数学正确性
- 把客户端训练记录当作可信 Assessment 成绩

Learn、Practice、Review 的路由与状态边界见 [learning-modes.md](./learning-modes.md)。

Action surfaces / interaction adapter 负责：

- 消费 `WorkspaceView`
- 渲染左侧工作区与右侧引导区
- 把 hit-testable 的语义候选转成 `StudentEvent`
- 让合理但错误的候选到达 Action guard，不用 `enabled=false` 吞掉错误点击

判定、指标与同步的完整边界见
[ADR-006](../adr/ADR-006-local-practice-training-runtime.md)。迁移完成前，pinned legacy Practice session
可以继续使用原 server-authoritative compatibility path。

## Relation To Scenario Bank

对 frontend 来说，题目来源是 backend 内部细节。

不论 backend 当前使用：

- 内置模板实例
- 数据库中的 approved scenario

frontend 都只消费同一个 versioned `ExercisePlan`。

这意味着：

- authoring pipeline 的演进不应改变前端主契约
- scenario 选择逻辑不应泄漏到练习页组件中

## Acceptance

- 学生始终在左侧完成主操作
- 练习页不依赖题型级页面分支
- runtime 可恢复
- authoring pipeline 的存在不会改变练习页 API 形态
- 合理但错误的候选会进入 `wrongAttemptCount`，Action 状态与 world 不推进
- 一道题的 Action 切换不调用 backend evaluator 或重新获取 plan
- 网络失败不阻塞已加载题目的本地训练，结果恢复后幂等上传
