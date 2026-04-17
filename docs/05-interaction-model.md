# Interaction Model

## Summary

Web 学生端只有一个统一交互原则：

左侧负责操作，右侧负责引导。

这个原则适用于所有题型与所有 engine，不因为提示多少不同而改变。

## Global Rules

### 1. Single Action World

任一时刻，学生只应在一个主工作区完成主要输入动作。

左侧工作区负责：

- 点击
- 输入
- 选取
- 提交当前步骤

右侧引导区负责：

- 告诉学生当前在做什么
- 显示当前步骤
- 给出错误修正提示
- 给出下一步方向

### 2. Example And Exercise Share One Runtime Shell

`example` 与 `exercise` 的差异应主要体现在：

- 提示强度
- 反馈口径
- 练习组装逻辑

而不是：

- 不同页面外壳
- 不同输入区域模型
- 不同主交互入口

### 3. Immediate Feedback

每次动作都应有可感知结果：

- 当前输入是否有效
- 当前步骤是否完成
- 是否进入 `correct_pause`
- 是否停留在 `wrong_feedback`

### 4. Runtime Phases

页面级 phase 统一为：

- `answering`
- `correct_pause`
- `wrong_feedback`
- `group_finished`

产品侧的 `example` / `exercise` 是学习模式，不再发明第二套页面级 phase。

## Workspace Model

左侧工作区是唯一操作世界。

它可以包含：

- 可命中对象
- 输入锚点
- 当前步骤的提交入口
- 局部反馈高亮

它不应包含：

- 第二套隐藏主交互路径
- 右栏重复提交入口

## Guide Model

右侧引导区是只读 HUD。

必须包含：

- 当前目标
- 当前步骤
- 已完成步骤摘要
- 错误后修正提示
- 正确后下一步提示

不应包含：

- 主输入框
- 主提交按钮
- 判题逻辑

## Scope

本文件只描述在线 Web runtime 的交互原则。

离线 authoring pipeline 的 CLI、批处理与审核流程不属于本文件范围。
