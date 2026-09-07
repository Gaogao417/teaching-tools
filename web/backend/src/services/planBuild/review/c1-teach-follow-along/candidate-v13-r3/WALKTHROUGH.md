# C1 首题 Teach 理解衔接走读（待教研审核）

三件新候选：TP-SMV-009@v13（planning/v7）、PR-SMV-001@v11 和 PR-SMV-002@v10（protocol/v3，planning/v8），全部 Draft，无 approval。旧 v12 已撤回，未作为来源或批准使用。

**当前未批准、未发布。C0 裁定：protocol/v3 + confirmation_target=follow_along 已裁定；当前 Beat 已有 Context 允许目标 fact；动态 board.explain 仍受现有工具可见性/权限约束，不新增最终答案展示政策，不扩大 support_boundary。待 C4 真实板书验证。** 本包可校验/联合导入，不等于 C2/C3 已实现或 C4 验收通过。

下列走读从开场到总结，区分听懂自述、关系表达和独立验证。每拍有自己的输入锚点，不能用整题末尾一句确认反填前面。

## BT-01 题设与目标

老师讲解：先看等腰、等角和翻折条件，再找到要讨论的 BE。你可以告诉我哪里已跟上、哪里还需要定位。

图/板书：题图保留 authored E；展示 FN-01..04，不提前构造 O。

- 学生：「这一步听懂了，可以继续。」老师：若当前范围相关且无待解决矛盾，接入下一拍；只记录跟上自述。
- 学生复述：「我知道是把 C 沿 AD 翻到 E，最后看 BE。」老师：关键关系成立则复用，不追加同义确认；只记录本次表达支持。
- 学生：「E 是随便在线段 BC 上取的点。」老师：「E 是 C 关于 AD 翻折后的对应点，不是任取点。我们先对照题图认清 C、E 与折痕。」本拍先补讲，后续相关反馈确认再继续。
- 学生：「不会算，你算给我看。」老师继续用批准依据演示，不要求画布填数；再判断是否接上。
- 学生：「跳过。」按既有合法控制处理，保留未确认边界，不能当听懂。

实际候选字段：completion_evidence=student_confirmation；confirmation_target=follow_along；participation=confirm；GT-01。

关键关系：知道 AB=AC、D 在 BC 上、给定角相等和 C 翻折至 E，并能定位目标 BE。

原话必须经现有 Semantic/Gate 正式链；此走读是待审核期望，不是 scripted verdict 的验收结论。

## BT-02 第一组相似及用途

老师讲解：我们把两组对应角对齐，得到第一组子母型相似。这一步用来把已知边和待求边连起来；不必先独立证明才能继续听。

图/板书：可讲解时展示 FN-05/FN-06 对应角和第一组相似，不等待 GT-02 算对。

- 学生：「这一步听懂了，可以继续。」老师：若当前范围相关且无待解决矛盾，接入下一拍；只记录跟上自述。
- 学生复述：「是两组角对应相等，所以可以用相似把已知边和 AD 连起来。」老师：关键关系成立则复用，不追加同义确认；只记录本次表达支持。
- 学生：「懂了，相似就是所有对应边都一样长。」老师：「相似要求对应边成比例，不是都相等。先对照对应顺序，再看两组三角形大小的比例。」本拍先补讲，后续相关反馈确认再继续。
- 学生：「不会算，你算给我看。」老师继续用批准依据演示，不要求画布填数；再判断是否接上。
- 学生：「跳过。」按既有合法控制处理，保留未确认边界，不能当听懂。

实际候选字段：completion_evidence=student_confirmation；confirmation_target=follow_along；participation=confirm；GT-02。

关键关系：两组对应角支持 AA；C-A-D 对应 C-B-A，相似关系用于连接已知边和待求边。

原话必须经现有 Semantic/Gate 正式链；此走读是待审核期望，不是 scripted verdict 的验收结论。

## BT-03 比例和前置长度

老师讲解：我来演示相似比怎样带出 AD、CD，再用整段减去 CD 得到 BD。你只需反馈比例方向和线段差是否接上，不必提交数值。

图/板书：展示 CA:CB=AD:BA=CD:CA=2:3；AD=CD=8/3、BD=10/3，均为批准中间材料。

- 学生：「这一步听懂了，可以继续。」老师：若当前范围相关且无待解决矛盾，接入下一拍；只记录跟上自述。
- 学生复述：「先按对应顺序求 AD、CD，再用 BC 减 CD 求 BD。」老师：关键关系成立则复用，不追加同义确认；只记录本次表达支持。
- 学生：「BD 应该用 BC 加 CD。」老师：「D 在 BC 上，BC 由 BD 和 DC 拼成。我们沿同一线段看整段与部分，再写减法。」本拍先补讲，后续相关反馈确认再继续。
- 学生：「不会算，你算给我看。」老师继续用批准依据演示，不要求画布填数；再判断是否接上。
- 学生：「跳过。」按既有合法控制处理，保留未确认边界，不能当听懂。

实际候选字段：completion_evidence=student_confirmation；confirmation_target=follow_along；participation=confirm；GT-03。

关键关系：相似比方向统一；AD、CD 来自对应边比例，BD 是 BC 减 CD。

原话必须经现有 Semantic/Gate 正式链；此走读是待审核期望，不是 scripted verdict 的验收结论。

## BT-04 第二组相似与点序

老师讲解：先看 O 的位置和第二组相似，再把比例计算与线段差分开讲。AO、DO、BO、OE 可由老师演示，不把画布填数当作继续听讲的门槛。

图/板书：复用 RES7 构造 O→AO/DO/BO/OE；讲解时显示 AO=16/5、DO=32/15、BO=6/5、OE=4/5；Teach 不挂 RES8 填数模板。

- 学生：「这一步听懂了，可以继续。」老师：若当前范围相关且无待解决矛盾，接入下一拍；只记录跟上自述。
- 学生复述：「AO、DO 用相似比例求，BO、OE 再根据点的顺序做减法。」老师：关键关系成立则复用，不追加同义确认；只记录本次表达支持。
- 学生：「懂了，OE 应该是 AE 加 AO。」老师：「A、O、E 的顺序决定 AE 是整段，所以 OE=AE−AO。先回到点序，再接回长度关系。」本拍先补讲，后续相关反馈确认再继续。
- 学生：「不会算，你算给我看。」老师继续用批准依据演示，不要求画布填数；再判断是否接上。
- 学生：「跳过。」按既有合法控制处理，保留未确认边界，不能当听懂。

实际候选字段：completion_evidence=student_confirmation；confirmation_target=follow_along；participation=confirm；GT-04。

关键关系：△DAO∽△DBA 的对应关系；先由比例得 AO、DO，再依 B-O-D-C 与 A-O-E 求 BO、OE。

原话必须经现有 Semantic/Gate 正式链；此走读是待审核期望，不是 scripted verdict 的验收结论。

## BT-05 蝶形相似与收束

老师讲解：先把两组对应边比例与夹角放在一起，再接到 BE 与 AD 的比例。这里关心你是否接上推理，不要求自己算出答案后老师才讲方法。

图/板书：FN-20..22 可作中间讲解：BO:AO=OE:OD=3:8，△BOE∽△AOD，BE:AD=3:8；FN-23 的 BE=1 可由老师演示后再确认跟上：依据 protocol/v3 的 follow_along 当前 Beat 受限教学许可，不先伪造 GT-05 studentpass；assessment 不变。

- 学生：「这一步听懂了，可以继续。」老师：若当前范围相关且无待解决矛盾，接入下一拍；只记录跟上自述。
- 学生复述：「需要两边成比例和夹角相等，得到蝶形相似后再接 BE 与 AD。」老师：关键关系成立则复用，不追加同义确认；只记录本次表达支持。
- 学生：「只要有一组对顶角就一定相似。」老师：「仅有一组角相等还不够；本题还要核对夹角两侧的对应边比例。我们回看这两组比。」本拍先补讲，后续相关反馈确认再继续。
- 学生：「不会算，你算给我看。」老师继续用批准依据演示，不要求画布填数；再判断是否接上。
- 学生：「跳过。」按既有合法控制处理，保留未确认边界，不能当听懂。

实际候选字段：completion_evidence=student_confirmation；confirmation_target=follow_along；participation=confirm；GT-05。

关键关系：BO:AO 与 OE:OD 同向相等且夹角相等，得到 △BOE∽△AOD，再由 BE:AD 求 BE。

原话必须经现有 Semantic/Gate 正式链；此走读是待审核期望，不是 scripted verdict 的验收结论。

## BT-06 全链总结

老师讲解：我们回看整条路线。你可以说哪里已经连起来，也可以用自己的话讲一段；已有清楚反馈时不再要求重复同义确认。

图/板书：展示已讲过的三段关系图；不以最后一句懂了反填前面各拍确认，也不新增掌握结论。

- 学生：「这一步听懂了，可以继续。」老师：若当前范围相关且无待解决矛盾，接入下一拍；只记录跟上自述。
- 学生复述：「第一组准备长度，第二组处理翻折和 O，最后蝶形把这些关系接到 BE。」老师：关键关系成立则复用，不追加同义确认；只记录本次表达支持。
- 学生：「前两组和最后求 BE 没有什么关系。」老师：「我们沿依赖往回看：蝶形需要的两组边比来自第二组长度，第二组又用了第一组求出的 AD、BD。」本拍先补讲，后续相关反馈确认再继续。
- 学生：「不会算，你算给我看。」老师继续用批准依据演示，不要求画布填数；再判断是否接上。
- 学生：「跳过。」按既有合法控制处理，保留未确认边界，不能当听懂。

实际候选字段：completion_evidence=student_confirmation；confirmation_target=follow_along；participation=confirm；GT-06。

关键关系：第一组给前置长度，第二组接入翻折和 O 的长度，蝶形把这些长度接到目标 BE。

原话必须经现有 Semantic/Gate 正式链；此走读是待审核期望，不是 scripted verdict 的验收结论。

## 默认上下文预算核查

BT-04 引用已有折叠/角关系事实，核心保留第二组相似和长度推导；BT-06 仅回顾已建立的三组相似与长度结论。完整历史推导仍保留在计划 regions/补讲中。各拍 explanation binding 与该拍核心一致，未扩大权限。

预算及逐拍实测：

[
  {
    "protocol_id": "PR-SMV-002",
    "beat_id": "BT-01",
    "budget": {
      "facts": 13,
      "inferences": 4,
      "approx_chars": 1261
    },
    "context_truncated": false
  },
  {
    "protocol_id": "PR-SMV-001",
    "beat_id": "BT-01",
    "budget": {
      "facts": 4,
      "inferences": 0,
      "approx_chars": 120
    },
    "context_truncated": false
  },
  {
    "protocol_id": "PR-SMV-001",
    "beat_id": "BT-02",
    "budget": {
      "facts": 5,
      "inferences": 2,
      "approx_chars": 299
    },
    "context_truncated": false
  },
  {
    "protocol_id": "PR-SMV-001",
    "beat_id": "BT-03",
    "budget": {
      "facts": 7,
      "inferences": 4,
      "approx_chars": 381
    },
    "context_truncated": false
  },
  {
    "protocol_id": "PR-SMV-001",
    "beat_id": "BT-04",
    "budget": {
      "facts": 12,
      "inferences": 6,
      "approx_chars": 1148
    },
    "context_truncated": false
  },
  {
    "protocol_id": "PR-SMV-001",
    "beat_id": "BT-05",
    "budget": {
      "facts": 10,
      "inferences": 4,
      "approx_chars": 459
    },
    "context_truncated": false
  },
  {
    "protocol_id": "PR-SMV-001",
    "beat_id": "BT-06",
    "budget": {
      "facts": 11,
      "inferences": 1,
      "approx_chars": 321
    },
    "context_truncated": false
  }
]

## 补讲与练习边界

PR-SMV-002@v10 现在只有一个 BT-01（follow_along），原四拍不再是必过流程。RES9–RES12 保存四个原诊断方向和原批准图引用，仅按本次问题与返回锚点选择相关项；已有明确断点直接解释，不再重复定位、讲遍四项或逐项问懂了吗。核心引用既有角关系/长度前提与 AA、SAS 推理，不加入 FN23，不扩大默认预算。原四拍完整只读记录与资源映射见 review-manifest.inquiry_revision。

走读：主线学生问「这个比例怎么来的」→ 打开单拍 Inquiry，选择蝶形比例方向解释对应边与夹角 → 学生相关复述或明确表示接上且无矛盾 → 现有 Navigator 的末拍完成规则返回保存的原主线 Beat，无第二个补讲 Gate。学生说「懂了，但对应方向还是反的」→ 不完成，留本次断点澄清；沉默/播放完成不完成。未定位的问题可以简短追问，但不会自动遍历四个方向。

资产保留既有 inquiry_branch/return_beat_id/expand_region_id。单拍终态沿用 evidence_collected 自边声明，Navigator 识别末拍后优先执行 inquiry_completed 返回；不新增导航规则。返回不代填原主线 Gate，也不宣称同一反馈已复用到主线：是否出现返回后同义确认由 main 的实际补讲返回链验证。

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
