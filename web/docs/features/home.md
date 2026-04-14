# Home Feature Spec

## 摘要

Web 端“首页”现在不是一个孤立页面，而是 `WorkspaceShell` 下的 index route。

它由两层组成：

- `WorkspaceShell` 负责共享导航、学生身份和任务聚焦上下文
- `TaskOverviewPanel` 负责当前聚焦任务的概览、历史和开始入口

因此，首页的职责是“把学生带到正确任务”，而不是承载练习运行时本身。

## 当前结构

```text
WorkspaceShell
  -> SidebarNav
  -> AuthModal
  -> TaskPreviewPopover
  -> TaskOverviewPanel
```

## 职责边界

`WorkspaceShell` 负责：

- 加载 `task tree`
- 维护 focused task
- 管理侧边导航展开态
- 管理学生姓名与身份确认弹层
- 提供任务预览 popover

`TaskOverviewPanel` 负责：

- 展示当前聚焦任务的标题、摘要、样题和步骤说明
- 展示当前学生的历史训练数据
- 根据本地 stored session 呈现“开始训练 / 继续训练”入口
- 跳转到 `/practice/:taskId`

首页不负责：

- 创建练习 session
- 判题
- 承载练习交互
- 汇总练习结果

## 状态来源

首页依赖：

- `task tree`
- shell 提供的 `focusedTask`
- 当前学生名
- 当前学生对应任务的历史数据
- 本地 stored session id

首页局部状态只应包含：

- 任务历史加载态
- 与当前 focused task 对应的展示态

任务树展开、身份确认和任务预览不属于首页面板局部状态，而属于 shell。

## 关键交互

### 任务导航

- 学生在侧边导航中切换任务
- shell 更新 focused task
- index panel 随 focused task 刷新详情与历史

### 身份确认

- 未填写姓名时，shell 打开 `AuthModal`
- index panel 的 CTA 不直接创建 session，而是先请求 shell 完成身份确认
- 姓名切换后，首页重新读取当前学生历史

### 开始或继续训练

- 点击 CTA 后跳转到 `/practice/:taskId`
- 练习 session 的创建与恢复由 `PracticePage` 负责
- 首页只负责提供正确入口和上下文，不偷跑训练状态机

## 验收条件

- 学生可以在统一 workspace 壳层内完成“选任务 -> 看详情 -> 开始训练”
- 未填写姓名时，不会直接开始训练，而是走统一身份确认入口
- 任务详情和历史始终跟随当前 focused task 与当前学生
- 首页不再被描述为独立承载任务树、身份输入和练习入口之外的第二套页面体系
