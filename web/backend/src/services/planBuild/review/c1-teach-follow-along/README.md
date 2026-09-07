# C1 首题 Teach 候选交付（未批准、未发布）

2026-09-07。**当前审核包为 candidate-v13-r3**：将 Inquiry 四拍收为一个针对断点的补讲拍，原四个诊断方向改为 RES9–RES12 按需资源；按 main 收口要求仅保留此最终目录（原单拍包目录 r4 归一命名为 r3），JSON 与精确 hash 不变；早期未批准草稿已移出交付。主 PR inquiry refs 与 TP refs 已同步新 hash。先读 [六拍走读](candidate-v13-r3/WALKTHROUGH.md)，再核对 [审核清单](candidate-v13-r3/review-manifest.json) 和三个 Draft JSON。此包重编排 Teach，不是 v12 延续批准。

## 精确候选

| artifact | 原 Approved version | 原 content_hash | 新 Draft version | 新 content_hash |
|---|---|---|---|---|
| PR-SMV-002 | v9 | `sha256:f798dbc953f401a59ab6000c3c7d2a1dda82a04c81341356ca7b5624428b19b1` | v10 | `sha256:948745ad4f2f59be44d6af5d5c6e4e2e6c469ca53ac8405133fbb3c16c39baef` |
| PR-SMV-001 | v10 | `sha256:b43b5f2e54bffe96d36fd61c554502225db2eb155672f3f0e828fba15a1fdfcf` | v11 | `sha256:8da11a9977c2da199a58f2e47cdf62e9106f6ddf38cc3c4a5a42b64b986a7acd` |
| TP-SMV-009 | v11 | `sha256:5224d6164198c074e5aa50a0072eebbb01e07f35e14a212c3914315e7e950bd2` | v13 | `sha256:560bda35c0212d0a3980bbbb819f5cc210b7db93aa864827a1e949ca9bd5b000` |

- [TP-SMV-009@v13](candidate-v13-r3/TP-SMV-009.v13.draft.json)：仍是 planning/v7 schema；两个 RP 仅表达上下文/呈现粒度，主线确认不跳拍；更新三个 chunk 的 PR refs 与资源归属。
- [PR-SMV-001@v11](candidate-v13-r3/PR-SMV-001.v11.draft.json)：protocol/v3（planning/v8），六拍全部 student_confirmation + confirmation_target=follow_along + participation=confirm；role 不再是 practice/verification；gate.requirement 明确关键关系/接受反馈/不接受误解。
- [PR-SMV-002@v10](candidate-v13-r3/PR-SMV-002.v10.draft.json)：同为 protocol/v3，仅一个补讲拍带跟上标记，保留原 Inquiry 入口和主线返回锚点；不再按四个方向顺序确认。

图 RG-SMV-001@v8、QT/AS/PP 沿原精确 pins。主 PR 的 inquiry_ref、新 TP 的 chunk refs、region local refs 全部与新 PR hash 对账。只更新新 Draft 内容；真实 skills 版本文件/registry 未改。

## 关键内容变更与边界

1. Teach 跟上与独立验证分开：各拍无矛盾的相关自述或正确复述可交 Semantic/Gate 判定推进，不要求数值 evaluator 或固定组件；不制造 independent mastery 证据。
2. RES3 的旧 TP/PR 归属矛盾在本新版本修正：统一 BT-03 / CH-01 的比例与长度演示，内容不再借用“第二组子母型”的过渡问句。
3. RES8 从 Teach 资源和 Beat/chunk 中移除；review-manifest 保留原 RES8 及旧 PR 的精确练习门槛作只读证据。选择练习要进入明确验证任务，C1 不虚构不存在的练习入口。
4. 复用 RES7 五个合法构造输出，另按六拍资源关联生成解释依据绑定。每条解释绑定仅引用该拍真实 RG facts/inferences；推理前提闭合，不复用旧 v12 绑定审批。
5. C0 已裁定 protocol/v3 标记。当前 Beat 已有 Context 允许目标 fact；动态 board.explain 仍受现有工具可见性/权限约束，不宣称新 final display 政策。may_reveal_answer=false 与 GT05/FN-23 保留，真实板书显示由 main C4 验证。
6. 阴性反馈包括“懂了，所以对应边相等”、只给角不核对夹边比例等；先澄清再判断。关键词、沉默、timeout、TTS/动画完成、旧确认、重复/过期 ASR 都不构成新理解证据。

材料列出的老师回应/走读是教研候选，不是真实模型质量或浏览器验收。C4 仍须逐拍实测证据链；Draft 校验通过不等于 user approval 或 S2/G7 Accepted。

## 工具与复验

在 `teaching-tools/web/backend` 运行：

```sh
npx tsx scripts/prepare-teach-follow-along-candidate.ts /Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring /private/tmp/c1-new-review 2026-09-07T12:00:00Z
npx tsx scripts/validate-teach-follow-along-candidate.ts /Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3
npx tsx src/services/planBuild/__tests__/teachFollowAlongCandidate.test.ts
```

生成工具要求输出目录不存在且不在真实 canonical root 内；不写 registry、不批准、不覆盖材料。校验工具只读，核对三份文件自身 hash、联合引用、标记、resource/gate、manifest 的源/目标 pins。

定向测试覆盖真实 v2 历史无标记、C1 七拍/练习隔离、字段与绑定负例、旧 v12 拒绝、两 PR+TP 联合发布/导入及 v3 hash 篡改拒绝。测试的唯一 Approved 操作在 `f7-C1-SYNTHETIC-ONLY-*` 临时副本中，结束删除；不算教研批准。

主 agent 接线：现有 loadApprovedTeachingProtocolV2/importApprovedPlanV5 名字保留，但接收 v2/v3 原 schema；`completion_evidence.confirmation_target` 保留在 imported.protocols，v3 projection 也携带完整 completion_evidence 和原协议 schema。v2 投影不新增字段，避免历史投影 hash 改变。三件实际发布需先核对全包、记录真实审批，再协调切换，不能让服务读到更新 PR 但旧 TP 的混装 current 状态。

## 依据与 owner

本轮 C0 裁定由 main 给出；C1 只负责编排候选、工具、reader/materializer 与材料。Semantic/Gate、Navigator、展示权限核查、前端和报告证据强度由对应 owner 实现。

依据 PRDS `teach-follow-along-execution-spec.md`；合同与 owner/依赖边界引用 `mvp/foundation/f0/f0-contract-version-matrix.md` §2（RG/PR/TP）、`f0-dependency-ledger.md` F4/F5/F6 与 `f0-golden-lineage-manifest.md` 的历史基线，并用本 manifest 的当前 pins 更新具体输入事实。未采用 legacy adapter、未修改 legacy 资产或消费者；不是另开 Foundation 或替代 C0/C4 scope ledger。

## r3 预算回归

默认预算不变：14 facts / 8 inferences / 4000 字符。BT-04 为 12/6/1148，BT-06 为 11/1/321；其他主线及单拍补讲也全部通过。BT-04 使用既有角关系/折叠结论作为前提，BT-06 回顾已建立结论；完整 source regions 保留，不新增导航拍。每拍 explanation basis 在实际 Context 中完整可见。新 teachFollowAlongContextBudget.test.ts 固化旧两拍拒绝与新七拍通过，并将 runtime budget audit 纳入候选生成/校验。

## 最终 r3 单拍补讲审核与 main 接线

原 PR-SMV-002 四拍有序确认改为唯一 BT-01/GT-01，原四个 purpose、solution_refs 与诊断 requirement 保存为 RES9–RES12 可选方向；完整原 Beat 及精确来源 hash 另存 review-manifest.inquiry_revision。选择与本次问题/返回锚点相关的方向，不依次讲完四项，不额外要求说“懂了”。已有相关有效复述即可结束补讲，误解或未解决问题继续澄清。

预算 13 facts / 4 inferences / 1261 字符（包含四份资源文本），默认 14/8/4000 不变。核心使用原补讲范围内既有角关系与长度事实支持 AA/SAS，不重新携带所有前序证明；未新增 FN23 或资源解释绑定权限。主线六拍内容与预算不变，只更新其 Inquiry hash pin。

现有 TutorNavigatorV5 对 Inquiry 的最后一拍有效证据执行 inquiry_completed→return_to_mainline，目的地沿保存的 return_beat_id；候选采用既有 evidence_collected 终态自边形式，不改 Navigator。createSyntheticFollowAlongRoot() 自动消费新版。服务端已支持同一句自然反馈对保存的原拍目标再次复核：覆盖完整目标则原子返回并推进，否则仅返回原锚点。局部控件确认不跨范围复用；没有自动代填主线 Gate。

待用户裁定：是否接受“一个断点、一个补讲拍、一次有效反馈返回”的教学组织，以及 RES9–RES12 从必过诊断流程改为按需方向。三份候选仍为 Draft。main 已报告 C4 十项通过，包含 one-inquiry 自然返回、按真实 bindings 发起五条 geometry.construct 以及其他 Beat 的 board.explain、跨目标反馈复用及失败回滚；这是 main 提供的集成测试结果，不能代替用户教研批准。

收口验证：C1 编译、候选永久测试、默认预算测试及整包只读校验通过；main 继续统一门禁/提交。本次目录归一未修改候选内容。
