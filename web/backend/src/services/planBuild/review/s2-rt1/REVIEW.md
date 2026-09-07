# S2 RT1 v7 候选审核与接线交付

2026-09-07。状态：待真实教研裁定；未发布、未授予 Approved，不代表 S2 批准资产运行验收通过。

## 请审核的具体内容

候选：`candidate-v12/candidate.json`，TP-SMV-009@v12，schema planning/v7，status=Draft，无 approval。

候选 content_hash：`sha256:a491b3facacafbe031f50f697652df6d47ff369a0af12b35137921574f0af20b`。
来源为真实 current Approved TP-SMV-009@v11，content_hash：`sha256:5224d6164198c074e5aa50a0072eebbb01e07f35e14a212c3914315e7e950bd2`。完整来源记录见 `candidate-v12/review.json`。

| 绑定 | 具体复用 | 审核判断 |
|---|---|---|
| VB-01..05 | RES7 的 pt-O、seg-AO、seg-DO、seg-BO、seg-OE 五个构造输出；allowed_template_ids 为真实输出 ID，与当前 compiler 解析口径一致 | 是否同意让模型在既有 BT-04 资源权限下选择这些既有构造；保留依赖顺序和执行裁决 |
| VB-06 | IF-08；依据 FN-02/FN-04/FN-12；presentation_resource=RES7 | 是否同意用批准前提解释既有 O 构造相关依据 |
| VB-07 | IF-09 及完整批准 premises/conclusion（候选 JSON 可逐项查阅）；presentation_resource=RES4 | 是否同意用现有批准图解释第二组相似的角关系 |
| VB-08 | 真实 Board catalog 的 BE-14；PR-SMV-001 的既有 GT-04 通过后才允许 reveal | 是否接受该保守披露条件；不会改变 GT-04 的验证目标 |

本候选未修改任何 RES 内容、PR 引用、Beat、Gate、RP、chunk graph 或 solution region。只更新 schema/version/build provenance 并增加上述绑定；旧 approval 已删除。来源 PR-SMV-001@v10、PR-SMV-002@v9、RG-SMV-001@v8 的版本/hash 引用原样保留。

建议可直接提交用户的裁定问题：是否批准此精确 hash 的 v12 候选，复用上述既有依据/构造与 GT-04 披露条件，并接受下述历史内容边界？如果有修改意见，修改后必须生成新 hash 再审。真实批准应记录审核者、时间、该精确 hash；工具不代签。

## PRDS RT1 核查与本轮边界

已核查 PRDS `mvp/foundation/f7/f7-rt1-content-review-materials.md`。其开头和 §1 的 v6/RefinementSpec/frontier/三层描述已被当前冻结 v7 及该文 §3、§6 的新范围撤回；本候选不据此新增结构。默认/最细是模型上下文选取与表达粒度，不是新导航，不改变 cursor/Beat/Gate。

RES3 的 TP beat_ref=BT-04 与 PR 消费 BT-03 的历史差异继续保留，当前执行仍以 PR resource_ids 为准；本候选不为该差异自行修改 TP/PR，也不把它宣称为已解决。RES3 不新增绑定。

GT-04 仍只验证四段数值，不证明相似判定掌握；GT-06 仍是 student_confirmation，不证明三句复述质量。RP-02 不承诺跳过主线 Beat。几何 emphasize/annotate 未新增；只复用 RES7 已有构造。是否要修历史内容/升级证据应另行裁定，不能以旧 refinement 设计作为此候选发布前置。

## 主 agent 接线

- 现有 `importApprovedPlanV5` / `loadCurrentPlanV5` 名称保留，接受 v5 和冻结 v7，拒绝 v6。NavigatorSessionV5.start/resume 的既有 importer 调用无需更换。v7 原 schema/content_hash/resource_bindings 保留；无绑定 v5 保持历史行为。
- GenerationCoordinator/Orchestrator 取 `imported.plan.resource_bindings ?? []` 作为批准绑定来源；不要从 Draft 文件注入生产会话。投影也保留 `resource_bindings`，参与 projection hash。
- `validateApprovedPlanV5` 校验 RG 引用闭包及 PR Gate；importer 另用实际 GoldenWorkspaceCatalog 校验 BE、构造输出和几何目标。其他题若有 workspace 绑定，传 options.workspaceCatalog，缺目录 fail closed。
- `preparePlanV7Candidate` + `scripts/prepare-plan-v7-candidate.ts` 只生成 Draft 和 review sidecar，不更新 registry，拒绝覆盖输出与现有版本。
- `publishApprovedPlanV7(root, externallyApprovedPayload, inputs, reviewedContentHash, options)` 要求真实审核后的 Approved payload 与精确 hash，验证全链后复用 append-only 发布器。inputs 应来自最新 anchored importer。此次没有调用该工具发布真实资产，也未修改 skills。

## 定向验证

`npx tsc --noEmit -p tsconfig.json`、`npx tsx src/services/planBuild/__tests__/planBuildV5.test.ts`、`npx tsx src/services/planBuild/__tests__/planBuildV7.test.ts`。

v7 测试复制真实供应链到一次性临时目录，只对测试候选添加 SYNTHETIC-TEST-ONLY approval；覆盖 publication → anchored importer → buildNavigatorPlan，测试后删除。负例包括 Draft/缺批准、registry hash、version、stale graph、未知 Gate/BE/geometry/template/basis/resource、缺推理前提、v6 拒绝与版本不可覆盖。该测试不能替代真实教研批准或浏览器 S2 验收。
