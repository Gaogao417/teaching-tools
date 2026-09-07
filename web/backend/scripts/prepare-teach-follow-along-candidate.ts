/** tsx scripts/prepare-teach-follow-along-candidate.ts ROOT OUTPUT_DIR [BUILT_AT] */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { prepareTeachFollowAlongCandidate } from "../src/services/planBuild/c1/PrepareTeachFollowAlongCandidate";
import { MAINLINE_CONTENT } from "../src/services/planBuild/c1/TeachFollowAlongContent";
const [rootArg, outputArg, timestamp] = process.argv.slice(2);
if (!rootArg || !outputArg) throw new Error("Required: canonical ROOT and new OUTPUT_DIR (outside real assets)");
const canonicalRoot = resolve(rootArg), output = resolve(outputArg);
if (output === canonicalRoot || output.startsWith(canonicalRoot + "/")) throw new Error("Cannot write candidates into canonical registry");
if (existsSync(output)) throw new Error("Output already exists; never overwrite a reviewed candidate package");
const { candidate, review } = prepareTeachFollowAlongCandidate({ canonicalRoot }, timestamp ?? new Date().toISOString());
mkdirSync(output, { recursive: true });
function write(name: string, content: unknown) { writeFileSync(join(output, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n", { flag: "wx" }); }
write(`TP-SMV-009.${candidate.plan.version}.draft.json`, candidate.plan);
for (const p of candidate.protocols) write(`${p.protocol_id}.${p.version}.draft.json`, p);
write("review-manifest.json", review);
const scenes = MAINLINE_CONTENT.map(content => {
 const beat = candidate.protocols.find(p => p.protocol_kind === "mainline")!.beats.find(b => b.beat_id === content.beat)!;
 return `## ${content.beat} ${content.title}

老师讲解：${content.narration}

图/板书：${content.board}

- 学生：「这一步听懂了，可以继续。」老师：若当前范围相关且无待解决矛盾，接入下一拍；只记录跟上自述。
- 学生复述：「${content.restatement}」老师：关键关系成立则复用，不追加同义确认；只记录本次表达支持。
- 学生：「${content.misconception}」老师：「${content.teacher}」本拍先补讲，后续相关反馈确认再继续。
- 学生：「不会算，你算给我看。」老师继续用批准依据演示，不要求画布填数；再判断是否接上。
- 学生：「跳过。」按既有合法控制处理，保留未确认边界，不能当听懂。

实际候选字段：completion_evidence=${beat.completion_evidence.evidence_kind}；confirmation_target=${beat.completion_evidence.confirmation_target}；participation=${beat.participation}；${beat.completion_evidence.gate!.gate_id}。

关键关系：${content.relation}。

原话必须经现有 Semantic/Gate 正式链；此走读是待审核期望，不是 scripted verdict 的验收结论。`;
});
write("WALKTHROUGH.md", `# C1 首题 Teach 理解衔接走读（待教研审核）

三件新候选：TP-SMV-009@${candidate.plan.version}（planning/v7）、PR-SMV-001@v11 和 PR-SMV-002@v10（protocol/v3，planning/v8），全部 Draft，无 approval。旧 v12 已撤回，未作为来源或批准使用。

**当前未批准、未发布。C0 裁定：${review.c0_decision}** 本文是内容审核材料；代码及分层验证结果见 PRDS 的 Teach 理解衔接实施报告，不以 Draft 校验代替联合体验验收。

下列走读从开场到总结，区分听懂自述、关系表达和独立验证。每拍有自己的输入锚点，不能用整题末尾一句确认反填前面。

${scenes.join("\n\n")}

## 默认上下文预算核查

BT-04 引用已有折叠/角关系事实，核心保留第二组相似和长度推导；BT-06 仅回顾已建立的三组相似与长度结论。完整历史推导仍保留在计划 regions/补讲中。各拍 explanation binding 与该拍核心一致，未扩大权限。

预算及逐拍实测：\n\n${JSON.stringify(review.context_budget_audit, null, 2)}

## 补讲与练习边界

PR-SMV-002@v10 现在只有一个 BT-01（follow_along），原四拍不再是必过流程。RES9–RES12 保存四个原诊断方向和原批准图引用，仅按本次问题与返回锚点选择相关项；已有明确断点直接解释，不再重复定位、讲遍四项或逐项问懂了吗。核心引用既有角关系/长度前提与 AA、SAS 推理，不加入 FN23，不扩大默认预算。原四拍完整只读记录与资源映射见 review-manifest.inquiry_revision。

走读：主线学生问「这个比例怎么来的」→ 打开单拍 Inquiry，选择蝶形比例方向解释对应边与夹角 → 学生相关复述或明确表示接上且无矛盾 → 现有 Navigator 的末拍完成规则返回保存的原主线 Beat，无第二个补讲 Gate。学生说「懂了，但对应方向还是反的」→ 不完成，留本次断点澄清；沉默/播放完成不完成。未定位的问题可以简短追问，但不会自动遍历四个方向。

资产保留既有 inquiry_branch/return_beat_id/expand_region_id。单拍终态沿用 evidence_collected 自边声明，Navigator 识别末拍后优先执行 inquiry_completed 返回；不新增导航规则。返回不自动满足原主线 Gate。若学生原话也明确覆盖原拍目标，服务端对保存的原拍目标独立复核同一句话，记录范围后原子提交返回与合法推进，不重复询问；只确认补讲或局部控件确认不扩大为整拍确认。

学生明确选择自己做：这是一项独立验证任务，不能以「听懂了」判计算正确。review-manifest.json 保存原 PR/RES8 的只读验证要求；RES8 未挂入新 Teach 计划/Beat。C1 不捏造未存在的练习入口，任务切换由 main 核对现有正式字段/路由。

沉默、超时、presented、旧 Beat 确认、过期 ASR 和 Presenter 总结都不是当前理解证据。同输入重投/刷新/补讲返回应复用已有正式确认事实；由 C2/C4 验证，不由候选工具伪造。

## 请审核者逐项裁定

1. 六拍关键关系与上述老师回应是否准确、充分；中间结论可用于讲解，不要求先答对。
2. 无矛盾的相关自述、正确复述可前进；带误解的「懂了」先澄清，不按关键词通过。
3. 新计划将 RES3 明确改为 BT-03 比例讲解种子，修复旧 TP/PR 归属差异；RES4 负责 BT-04。是否接受这些新文字？
4. Teach 移除 RES8 强制操作，保留独立练习正确性边界；未独立验证不记掌握。
5. 是否接受补讲从四拍收为一拍，四个旧诊断方向仅按需选择？一次有效跟上证据返回原锚点，不要求连续四次确认；不代填主线证据。
6. BT-05 老师在明确 follow_along 的当前批准 Beat 演示最终结论，再确认理解；当前 Beat 已有 Context 允许目标 fact；动态 board.explain 仍受现有工具可见性/权限约束，不新增最终答案展示政策，不扩大 support_boundary。三件候选须共同审核各自精确 hash，当前包不可代签。

可见上下文/图板书允许范围需要 C2/C3 接线，静态校验不等于真实语义模型或浏览器验收。
`);
console.log(JSON.stringify({ output, status: review.status, release_ready: review.release_ready, candidates: review.proposed_publish_order }, null, 2));
