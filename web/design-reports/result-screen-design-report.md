# Web Result Screen Design Report

## 1. Scope

本报告描述网页版结果页在“前端静态托管、后端独立 API 服务”场景下的职责，以及它如何承接练习会话结束后的结果展示。

结果页是教学 Web 应用的一部分，不再是单个 HTML 里的末尾视图。

## 2. Product Goal

结果页需要同时满足两个目标：

- 让学生立刻看到本次训练结果
- 让老师在后端服务中保留可累计的学生历史记录

因此它既是展示页，也是结果持久化链路的终点。

## 3. Route

建议路由：

- `/result/:sessionId`

进入流程：

1. 练习页调用 `finishPractice`
2. 浏览器跳转到 `/result/:sessionId`
3. 结果页请求该 session 的结果快照
4. 页面渲染指标、趋势和后续操作

结果页属于前端静态应用内部路由页面，数据全部通过 API 拉取。

## 4. Backend Contract

共享类型、错误响应、session 生命周期和持久化约束，以 `backend-design-report.md` 为准。

`GET /api/practice/result/:sessionId`

```ts
interface ResultSnapshot {
  sessionId: string
  taskId: 'meaning' | 'ratioToSide' | 'guidedSolve'
  studentName: string
  startedAt: string
  clearedAt: string
  title: string
  groupLabel: string
  elapsedMs: number
  bestMs: number | null
  avgMs: number | null
  copy: string
  problemCount: number
  firstTryAccuracy: number
  firstTryCorrectCount: number
  color: string
  deltaVsPreviousMs: number | null
  history: {
    elapsedMs: number
    clearedAt: string
  }[]
}
```

后续如需支持老师查看更细粒度统计，可以在不破坏当前结构的前提下增加：

- `studentId`
- `classroomId`

## 5. Page Structure

```text
结果标题区
指标卡区
历史趋势区
操作区
```

展示内容维持精简：

- 学生姓名
- 本次耗时
- 本组最佳
- 最近平均
- 首次正确率
- 历史趋势
- 再练一组
- 返回任务首页

## 6. Visual Direction

结果页应延续 `trigonometry-practice.html` 的同一视觉语言：

- 温暖背景
- 教具板卡片
- 明确统计层级
- 与练习页一致的主色与强调色

结果页允许更偏信息展示，但不能与首页、练习页断裂成另一套后台样式。

## 7. Device Adaptation

### 7.1 Desktop

- 指标卡可双列或四列排列
- 趋势图宽度优先
- 操作按钮横排

### 7.2 Mobile

- 指标卡改为单列或双列自适应
- 趋势区允许滚动但不允许溢出屏幕
- 操作按钮堆叠为纵向全宽

移动端优先级不能低于桌面端。

## 8. Data Persistence

结果页的核心前提是“结果已经持久化到独立后端服务”。

这意味着：

- `finishPractice` 不能只返回内存对象
- 结果快照必须可被后续查询
- 即使浏览器刷新，结果页也应可恢复
- 历史趋势默认按 `studentName + taskId` 聚合

数据库至少保存：

- session 基本信息
- `studentName`
- `taskId`
- `elapsedMs`
- `firstTryAccuracy`
- `clearedAt`
- 历史聚合所需数据

## 9. Deployment Considerations

因为前后端分域部署，结果页设计需要考虑：

- 页面通过 CDN 分发静态资源
- API 通过 HTTPS 独立提供数据
- 前端通过 `API_BASE_URL` 调用结果查询接口
- 后端需正确配置 CORS 与证书

结果页不再以“老师本机断网可用”作为默认前提。

## 10. Implementation Direction

结果页前端可以较轻，但服务端逻辑必须明确：

- `finishPractice` 写入结果
- `getPracticeResult` 查询结果
- `getTaskHistory` 可复用结果数据做聚合

建议技术路线：

- 前端：静态 Web 应用，部署到 CloudBase
- 后端：Node.js + Express，部署到 Lighthouse
- 数据：开发期 SQLite，生产建议 MySQL

## 11. Resolved Decisions

- 结果页使用独立路由 `/result/:sessionId`
- 页面数据通过 API 拉取，不依赖前端内存传递
- 历史结果保存在独立后端服务
- 默认部署方式是前端 CloudBase + 后端 Lighthouse
- 首版正式保留 `studentName` 维度
