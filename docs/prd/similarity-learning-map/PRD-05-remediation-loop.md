# PRD-05：失败诊断与补强回路

## 文档状态

- 状态：Draft
- 优先级：P1
- 依赖：PRD-02、PRD-04，以及现有 Result / Review 投影

## 1. 背景与问题

挑战题跨越多个专题。学生做不过时，简单提示“回去学习前置关卡”会产生新的摩擦：

- 不知道究竟缺哪一步。
- 被送回整个专题，而不是缺失动作。
- 做完补习后无法回到原挑战上下文。
- 原挑战中已经正确完成的步骤被迫重做。

## 2. 产品目标

- 将挑战失败映射到一个明确 capability 和具体步骤。
- 提供短、窄、可完成的补强任务，而不是重学整个专题。
- 补强完成后自动返回原挑战。
- 尽可能恢复原挑战题和已完成图形状态。

## 3. 诊断规则

诊断真值来自 runtime / engine，前端只展示。

每个核心错误至少返回：

```ts
type RemediationDiagnosis = {
  diagnosisCode: string;
  capabilityId: string;
  title: string;
  coachingCopy: string;
  focusStepId: string;
  sourceChallengeSessionId: string;
  recommendedRemediationId: string;
};
```

选择诊断时遵循：

1. 优先最早阻塞后续步骤的核心错误。
2. 多次出现同类错误时提高其优先级。
3. 计算失误不得覆盖更前置的模型错误。
4. 已被证明掌握的能力不因一次偶发错误立即降级。

## 4. 失败反馈页

反馈必须先说明已经完成的部分，再指出一个核心缺口：

```text
你已经完成：
✓ 作出正确辅助线
✓ 标出第一组份数

当前卡点：
共同边的份数没有迁移到第二组相似

[练 3 道针对题] [仍然重试挑战]
```

首屏只展示一个主要诊断。其他尝试记录继续放在 Review 深层信息中。

## 5. 补强任务

补强不是普通完整题组，而是针对一个 capability 的短任务：

- 默认 3 道代表性动作题。
- 只保留必要题干和当前动作。
- 第一题可以有提示；后续题逐步减少提示。
- 正确结果仍通过统一 runtime 判定。
- 不在线生成新题，使用题库中已标注 capability 的场景。

补强完成条件由 capability 规则配置，前端不写死题数。

## 6. 返回挑战

进入补强时创建 resume context：

```ts
type RemediationResumeContext = {
  remediationSessionId: string;
  sourceChallengeSessionId: string;
  sourceInstanceId: string;
  sourceStepId: string;
  preservedCompletedStepIds: string[];
  returnMode: "resume-step" | "restart-instance";
};
```

返回策略：

- 若数学对象能够安全恢复，从失败步骤继续。
- 若补强改变了前序选择且无法保证一致性，重启当前题，但不重启整个挑战组。
- 返回后显示一条轻提示：“已完成补强，继续原挑战”。
- 返回后地图推荐节点保持为原挑战，直到挑战完成或学生主动退出。

## 7. 中断与恢复

- 刷新补强页面后恢复补强 session。
- 从其他页面返回时，地图节点仍显示“开启”；“补强中”只在节点详情或恢复提示中出现，不作为第四种节点状态。
- 学生可以主动退出补强；退出不删除 challenge 或 remediation 记录。
- 再次打开挑战时优先提示继续补强或直接重试。

## 8. 与 Review 的关系

- 即时失败反馈只给一个可行动诊断。
- Review 保存完整 attempt log、错误答案和图形回放。
- 补强完成记录出现在 Review 中，但不混入普通训练用时趋势。
- `ProblemReviewProjection.focusStepId` 可直接用于聚焦错误步骤。

## 9. 题库要求

每个可补强 capability 至少需要：

- 3 道可独立运行的代表题。
- 明确 `capabilityId`。
- 明确 `diagnosisCode` 与 fallback move。
- 可恢复的结构化步骤，而非只有最终答案。

题库不满足时，产品降级为跳转到对应专题的具体 Learn 步骤，不显示虚假的“精准补强”。

## 10. 验收标准

1. 挑战失败能返回一个明确 capability 诊断。
2. 学生可在一次点击内进入对应补强任务。
3. 补强完成后可返回原 challenge session。
4. 能安全恢复时保留原题已完成步骤。
5. 无法安全恢复时只重启当前题，不重启整个挑战组。
6. 刷新、关闭后重开不会丢失补强和返回关系。
7. Review 能看见挑战、补强和重试之间的关联。

## 11. 埋点与指标

- `remediation_recommended`
- `remediation_started`
- `remediation_completed`
- `remediation_abandoned`
- `challenge_resumed_after_remediation`
- `challenge_passed_after_remediation`

核心指标：补强完成率、补强后返回率、返回挑战后的通过率、从失败到再次有效作答的时间。
