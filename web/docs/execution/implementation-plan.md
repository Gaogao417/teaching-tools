# Implementation Plan

## 摘要

实现顺序必须遵守“先文档、后契约、再运行时、最后页面细节”的原则。

否则系统会再次退回到按页面堆逻辑。

## 实施顺序

### 阶段 1: 文档冻结

- 固定 `docs/` 下的产品、架构、领域、契约、交互文档
- 清理旧 design reports 和根目录临时计划文档

### 阶段 2: 契约冻结

- 让 `shared/contracts.ts` 与 `docs/03`、`docs/04` 对齐
- 明确兼容层与目标 runtime model

### 阶段 3: 前端运行时骨架

- 把 `PracticePage` 改造成 `ExerciseRuntimeHost`
- 拆出左侧工作区和右侧引导区
- 引入统一 feedback controller

### 阶段 4: 后端运行时骨架

- 从 `practiceService` 中拆出 runtime / engine 责任区
- 让后端开始生成 runtime-first 数据

### 阶段 5: 题型迁移

- 先迁移当前 3 个题型
- 再基于通用运行时接新题型

## 迁移原则

- 一次只替换一层
- 优先增加兼容层，不一次性推翻现有接口
- 任何新增题型都不能绕过 runtime model 直接入页

## 风险点

- 文档未冻结就改实现，边界会反复变化
- 契约先改太猛，会打断当前练习流程
- 题型迁移时如果仍保留页面内大分支，重构会失败
