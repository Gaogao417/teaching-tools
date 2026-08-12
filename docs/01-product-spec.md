# Product Spec

## Summary

这个项目不是普通刷题页面，而是一个围绕 `skill unit` 组织内容的教学应用。

它由两部分组成：

- 学生侧 Web 运行时
  用于承载 `example` 与 `exercise`，完成交互、判题、反馈与结果记录
- 内部离线 authoring pipeline
  用于批量生成题目、做数学校验、写入题库

学生做题时只消费“已批准入库”的题目，不直接调用 AI、skill 或 Wolfram。

## Users

- 学生
  通过浏览器进入应用，完成例题学习与练习
- 教研 / 内容生产者
  使用离线工具链批量生产、校验并维护题库
- 工程实现者
  维护 Web 运行时、题库契约与 authoring pipeline

## Core Concepts

- `skill unit`
  可复用的最小教学方法单元
- `example`
  高提示、强引导的教学例题
- `exercise`
  更少提示、用于检验与巩固的短练习组
- `scenario`
  题库中的单道已批准题目记录，包含题面、答案键与元数据
- `learning runtime`
  学生在线做题时看到的统一运行时外壳

## Product Goals

### 1. Teaching Goals

- 让学生学习稳定的方法链，而不是只记最终答案
- 让 `example` 与 `exercise` 围绕同一套 `skill unit` 组织
- 让错误反馈能指向具体步骤与具体误区

### 2. System Goals

- Web 学生端只关心“选题、做题、判题、反馈、结果”
- 离线出题链路只关心“生成、校验、入库”
- 题库内容与前端渲染细节分离
- 新题型可以在不新增整页实现的前提下接入统一 runtime

## Scope

当前版本必须覆盖：

- Web 任务首页
- Web 做题运行时
- Web 结果页
- 后端 session 与结果持久化
- 离线题库生产方案的文档化边界

当前版本不要求：

- 小程序端
- 教师后台
- 实时 AI 出题给学生做
- 多端同步编辑器

## Success Criteria

- 学生可以在同一套 Web runtime 内完成 `example` 和 `exercise`
- 前后端职责按模式清晰：Learn/Practice frontend 使用公开真值做本地演示/训练，Assessment 真值和判定只在 backend
- 题库与运行时分层明确
- 内容生产链路与在线做题链路互不耦合

## Non-goals

- 不把项目做成通用 LMS
- 不把首版做成自由探索型数学软件
- 不把离线 authoring pipeline 暴露成学生端能力
- 不恢复或并行维护小程序产品线
