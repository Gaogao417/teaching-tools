# Practice Feature Spec

## 摘要

练习页是整个 Web 版产品的运行时主页面。

它不是某个题型的实现页，而是 `PracticePage -> ExerciseRuntimeHost` 这条主链路的页面壳层。

练习页的目标是承接 runtime，不是承接题型分支。

## 页面职责

`PracticePage` 负责：

- 创建和恢复 session
- 挂载当前活动实例的 runtime
- 展示页面级计时、题号和结果状态
- 调度统一反馈
- 在题目之间推进
- 完成时展示结果弹层并跳转结果页

`PracticePage` 不负责：

- 生成题目真值
- 判题
- 直接维护题型专属交互逻辑
- 长期膨胀成“meaning / ratioToSide / guidedSolve”三套页面

## 组件结构

页面目标结构固定为：

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

## 页面分区

### 顶部

顶部展示：

- 当前任务标题
- 当前题号 / 总题数
- 计时
- 返回与重开入口

### 中部

中部固定分成两栏：

- 左侧 `WorkspaceScene`
- 右侧 `GuidePanel`

### 底部

底部展示：

- 页面级反馈卡
- 提示信息
- 历史趋势或轻量统计

## 左右边界

### 左侧工作区

左侧是唯一操作区。

允许出现：

- 可点击对象
- 可交互区域
- 输入锚点
- 公式槽
- 当前步骤需要的提交入口

不允许出现：

- 和右侧重复的大段教学说明
- 为了兼容旧题型而新增第二套逻辑入口

### 右侧引导区

右侧是只读引导层。

允许出现：

- 当前目标
- step tracker
- 已完成步骤摘要
- 当前错误提示
- 下一步提示

不允许出现：

- 主输入控件
- 与左侧重复的提交入口
- 判题逻辑

## 与运行时的关系

练习页主路径消费的是：

- `PracticeSessionSnapshot`
- `ExerciseRuntimeSpec`
- `ServerRuntimeState`
- 本地 `ClientDraftState`

练习页向后端主路径上报的是：

- `RuntimeActionEvent`

兼容期内仍可保留 legacy `answer` 接口，但它不是页面主路径目标。

## 当前 3 个任务如何落位

### meaning

- 左侧完成有序选边
- 右侧只提示“先选分子 / 再选分母”

### ratioToSide

- 左侧在边锚点输入长度
- 右侧只提示当前比值和目标

### guidedSolve

- 左侧完成所有分步输入
- 右侧只读展示步骤推进与摘要

这 3 个任务只是同一 runtime model 的不同内容实例，不应演化成 3 套页面结构。

## 实现约束

- `PracticePage` 不允许继续按 `problem.type` 编排输入逻辑
- `ExerciseRuntimeHost` 不允许长期保留任务级分支渲染
- `renderers.tsx` 只能作为 legacy 过渡文件，不能继续扩展
- 新任务必须先落入 runtime-first contracts，再接入练习页

## 验收条件

- 学生不需要在右侧寻找输入入口
- 页面可以承接多任务而不让 `PracticePage` 膨胀成巨型分支文件
- 正确、错误、完成时有统一反馈
- session 可恢复
- 完成后能自然进入结果页
- 新增同引擎任务时，不需要改页面架构
