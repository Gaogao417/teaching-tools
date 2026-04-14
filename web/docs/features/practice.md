# Practice Feature Spec

## 摘要

练习页是 `WorkspaceShell` 内部的运行时主路由。

它不是某个题型的实现页，而是 runtime session 的承载页。当前主链路为：

```text
WorkspaceShell
  -> PracticePage
    -> ExerciseRuntimeHost
```

练习页的目标仍然是承接 runtime，不是重新长回题型分支。

## 页面职责

`PracticePage` 负责：

- 启动和恢复 session
- 挂载当前活动实例的 `runtime`
- 维护页面级 `draft`、计时、题间推进和完成流转
- 调度页面级 feedback effect 与完成弹层
- 在同一路由壳层内处理重开、返回概览和结果跳转

`PracticePage` 不负责：

- 判题
- 生成题目内容
- 维护题型专属输入分支
- 在右侧引导区放置主输入控件

`ExerciseRuntimeHost` 负责：

- 接收 `ExerciseRuntimeSpec`
- 渲染左侧工作区与右侧引导区
- 把交互转换成 `RuntimeActionEvent`

## 当前结构与目标态

当前主路径结构是：

```text
PracticePage
  -> ExerciseRuntimeHost
    -> TriangleScene   (当前过渡实现)
    -> GuidePanel
```

目标态仍然是：

```text
PracticePage
  -> ExerciseRuntimeHost
    -> WorkspaceScene
      -> SceneRenderer
      -> InteractionZoneLayer
      -> InputAnchorLayer
      -> OverlayLayer
    -> GuidePanel
      -> ActionBanner
      -> StepTracker
      -> HintCard
      -> FeedbackCard
    -> FeedbackController
```

说明：

- 当前代码已经实现 runtime-first 主路径
- 但 `TriangleScene` 仍然是带三角形特化的过渡封装
- 它不应被视为最终对象层拆分结果

## 页面分区

### 左侧工作区

左侧是唯一操作区，允许出现：

- 可点击对象
- interaction zones
- scene anchors
- 公式槽
- 当前步骤需要的提交入口

左侧不应因为兼容旧题型，再长出第二套旁路交互。

### 右侧引导区

右侧是只读引导区，允许出现：

- 当前目标
- step tracker
- 已完成步骤摘要
- 错误提示
- 下一步提示

右侧不应出现：

- 主输入控件
- 与左侧重复的提交入口
- 判题逻辑

## 与壳层的关系

`WorkspaceShell` 提供：

- 学生身份上下文
- 统一导航壳层
- 任务聚焦上下文

因此练习页不再自己维护首页任务树或学生姓名输入，而是消费 shell 提供的上下文。

当学生身份缺失时，练习页只负责显示锁定态并请求 shell 拉起统一身份确认。

## 当前 3 个任务如何落位

### meaning

- 左侧完成有序选边
- 右侧只提示“先选分子 / 再选分母”

### ratioToSide

- 左侧通过 scene anchors 输入边长
- 右侧展示当前比值目标与引导

### guidedSolve

- 左侧完成多步输入与最终公式槽填写
- 右侧只读展示步骤推进和摘要

这 3 个任务只是同一 runtime model 的不同内容实例，不应回到 3 套页面结构。

## 实现约束

- `PracticePage` 不能重新依赖 `problem.type`
- `ExerciseRuntimeHost` 不能重新长出任务级分支渲染
- `renderers.tsx` 只能继续作为 legacy 过渡文件
- 新任务必须优先落入 runtime-first contracts，再接入练习页

## 验收条件

- 学生始终在左侧完成主操作，不需要去右侧找输入入口
- 页面可以承接多任务而不让 `PracticePage` 膨胀成题型分支文件
- 正确、错误、完成时有统一页面反馈
- session 可恢复
- 完成后可以自然进入结果页
- 新增同引擎任务时，不需要改页面主结构
