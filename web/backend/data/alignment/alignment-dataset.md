# Alignment 数据集（Phase 5 remediation，agent 代拟待教师复核）

- 生成时间：2026-08-21T08:23:06.525Z
- 总量：463 条（≥180 门禁）；hard set（否定/反事实，零误判要求）：90 条
- 每 plan 分布：TP-SMV-001=40、TP-SMV-002=75、TP-SMV-003=111、TP-SMV-004=44、TP-SMV-005=82、TP-SMV-006=111
- 标注者：migration-agent（教师审核不可得时的代理处置；review_status=agent-drafted）
- 复核口径：逐条核对 utterance→label 是否符合教学判断；hard set 条目重点确认「不得判为 expected/alternate」

| id | plan | 当前节点 | 学生话语 | 期望标签 | 来源 | hard | 备注 |
|---|---|---|---|---|---|---|---|
| TP-SMV-001-A001 | TP-SMV-001 | CP1 | 学生看到 $\angle DAC=\angle ACD$ 能立刻写出 AD=DC 并设元。 | expected_checkpoint@CP1 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-001-A002 | TP-SMV-001 | CP1 | 我看到 $\angle DAC=\angle ACD$ 能马上得到 AD=DC 并且设未知数。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-001-A003 | TP-SMV-001 | CP1 | 我看到 $\angle DAC=\angle ACD$ 能马上写出 AD=DC 并且设未知数。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-001-A004 | TP-SMV-001 | CP1 | 就是说，我看到 $\angle DAC=\angle ACD$ 能立刻得到 AD=DC 并设元。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-001-A005 | TP-SMV-001 | CP1 | 学生看到 $\angle DAC=\angle ACD$ 能立刻写出 AD=DC 并设元。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-001-A006 | TP-SMV-001 | CP1 | 学生看到 $\angle DAC=\angle ACD$ 能立刻写出 AD=DC 并设元。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-001-A007 | TP-SMV-001 | CP1 | 就是说那个…… $\angle DAC=\angle ACD$ 能立刻写出 AD=DC 并设元。，对吧 | expected_checkpoint@CP1 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-001-A008 | TP-SMV-001 | CP1 | 学生能列出翻折不变量清单（对应边相等、对应角相等）。 | expected_checkpoint@CP2 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-001-A009 | TP-SMV-001 | CP1 | 学生能先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$。 | expected_checkpoint@CP3 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-001-A010 | TP-SMV-001 | CP1 | 「 $\angle DAC=\angle ACD$ 能立刻写出 AD=DC 并设元」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-001-A011 | TP-SMV-001 | CP1 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-001-A012 | TP-SMV-001 | CP1 | 这些结论根本不成立，题目本身有问题 | unclear | negation | 是 | 补充反例 1：全盘否定（无具体对齐主张）→ 非 expected/alternate |
| TP-SMV-001-A013 | TP-SMV-001 | CP1 | 我完全不知道从哪里开始，一点思路都没有 | unclear | vague | 是 | 补充反例 2：完全空白 |
| TP-SMV-001-A014 | TP-SMV-001 | CP1 | 这道题是求长度吧？我不确定题目在问什么 | unclear | vague | 是 | 补充反例 3：元问题（关于题目而非推理） |
| TP-SMV-001-A015 | TP-SMV-001 | CP2 | 学生能列出翻折不变量清单（对应边相等、对应角相等）。 | expected_checkpoint@CP2 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-001-A016 | TP-SMV-001 | CP2 | 我可以写出来翻折不变量列表（对应边相等、对应角相等）。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-001-A017 | TP-SMV-001 | CP2 | 学生能列出翻折不变量列表（对应边相等、对应角相等）。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-001-A018 | TP-SMV-001 | CP2 | 就是说，我可以写出来翻折不变量清单（对应边相等、对应角相等）。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-001-A019 | TP-SMV-001 | CP2 | 学生能列出翻折不变量清单（对硬边相等、对应脚相等）。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-001-A020 | TP-SMV-001 | CP2 | 学生能列出翻折不变量清单（对应变像等、对应角相等）。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-001-A021 | TP-SMV-001 | CP2 | 就是说那个……列出翻折不变量清单（对应边相等、对应角相等）。，对吧 | expected_checkpoint@CP2 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-001-A022 | TP-SMV-001 | CP2 | 学生能先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$。 | expected_checkpoint@CP3 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-001-A023 | TP-SMV-001 | CP2 | 「列出翻折不变量清单（对应边相等、对应角相等）」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-001-A024 | TP-SMV-001 | CP2 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-001-A025 | TP-SMV-001 | CP3 | 学生能先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$。 | expected_checkpoint@CP3 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-001-A026 | TP-SMV-001 | CP3 | 我可以先解出 t 与 BD，再选余弦定理收尾，最后得到 $BE=1$。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-001-A027 | TP-SMV-001 | CP3 | 学生能先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-001-A028 | TP-SMV-001 | CP3 | 就是说，我可以先解出 t 与 BD，再选余弦定理收尾，最后得到 $BE=1$。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-001-A029 | TP-SMV-001 | CP3 | 学生能先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-001-A030 | TP-SMV-001 | CP3 | 学生能先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-001-A031 | TP-SMV-001 | CP3 | 就是说那个……先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$。，对吧 | expected_checkpoint@CP3 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-001-A032 | TP-SMV-001 | CP3 | 在斜三角形中硬凑勾股 | incorrect@CP3 | deviation |  | plan common_deviations 原文 |
| TP-SMV-001-A033 | TP-SMV-001 | CP3 | 「先解出 t 与 BD，再选余弦定理收口，最后得到 $BE=1$」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-001-A034 | TP-SMV-001 | CP3 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-001-A035 | TP-SMV-001 | CP2 | 学生已能学生看到翻折条件能先列不变量清单，而不是直接硬算 BE。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-001-A036 | TP-SMV-001 | CP2 | 我已能学生看到翻折条件能先列不变量列表，而不是直接硬算 BE。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-001-A037 | TP-SMV-001 | CP1 | 嗯……我不太确定这一步该怎么下手 | unclear | vague |  | 含糊输入 1 |
| TP-SMV-001-A038 | TP-SMV-001 | CP1 | 感觉好像是要用相似，但说不清楚 | unclear | vague |  | 含糊输入 2 |
| TP-SMV-001-A039 | TP-SMV-001 | CP1 | 这个条件和那个条件，我也不知道怎么连起来 | unclear | vague |  | 含糊输入 3 |
| TP-SMV-001-A040 | TP-SMV-001 | CP1 | (空) | no_progress | silence |  | 空文本（no_progress 只来自确定性路径） |
| TP-SMV-002-A001 | TP-SMV-002 | CP1 | 学生能先改比例再找三角形，而不是盯着等积式发呆。 | expected_checkpoint@CP1 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-002-A002 | TP-SMV-002 | CP1 | 我可以先改比例再找三角形，而不是盯着等积式发呆。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-002-A003 | TP-SMV-002 | CP1 | 学生能先改比例再找三角形，而不是盯着等积式发呆。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-002-A004 | TP-SMV-002 | CP1 | 就是说，我可以先改比例再找三角形，而不是盯着等积式发呆。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-002-A005 | TP-SMV-002 | CP1 | 学生能先改比例再找三脚形，而不是盯着等积式发呆。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-002-A006 | TP-SMV-002 | CP1 | 学生能先改比例再找三角形，而不是盯着等积式发呆。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-002-A007 | TP-SMV-002 | CP1 | 就是说那个……先改比例再找三角形，而不是盯着等积式发呆。，对吧 | expected_checkpoint@CP1 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-002-A008 | TP-SMV-002 | CP1 | 学生能在图中找到以 D 为公共直角顶点的两个直角三角形。 | expected_checkpoint@CP2 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-002-A009 | TP-SMV-002 | CP1 | 学生能写全「相似对应角 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-002-A010 | TP-SMV-002 | CP1 | 「先改比例再找三角形，而不是盯着等积式发呆」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-002-A011 | TP-SMV-002 | CP1 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-002-A012 | TP-SMV-002 | CP1 | 这些结论根本不成立，题目本身有问题 | unclear | negation | 是 | 补充反例 1：全盘否定（无具体对齐主张）→ 非 expected/alternate |
| TP-SMV-002-A013 | TP-SMV-002 | CP1 | 我完全不知道从哪里开始，一点思路都没有 | unclear | vague | 是 | 补充反例 2：完全空白 |
| TP-SMV-002-A014 | TP-SMV-002 | CP1 | 这道题是求长度吧？我不确定题目在问什么 | unclear | vague | 是 | 补充反例 3：元问题（关于题目而非推理） |
| TP-SMV-002-A015 | TP-SMV-002 | CP2 | 学生能在图中找到以 D 为公共直角顶点的两个直角三角形。 | expected_checkpoint@CP2 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-002-A016 | TP-SMV-002 | CP2 | 我可以在图中找到以 D 为公共直角顶点的两个直角三角形。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-002-A017 | TP-SMV-002 | CP2 | 学生能在图中找到以 D 为公共直角顶点的两个直角三角形。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-002-A018 | TP-SMV-002 | CP2 | 就是说，我可以在图中找到以 D 为公共直角顶点的两个直角三角形。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-002-A019 | TP-SMV-002 | CP2 | 学生能在图中找到以 D 为公共直脚顶点的两个直角三角形。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-002-A020 | TP-SMV-002 | CP2 | 学生能在图中找到以 D 为公共直角顶点的两个直角三角形。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-002-A021 | TP-SMV-002 | CP2 | 就是说那个……在图中找到以 D 为公共直角顶点的两个直角三角形。，对吧 | expected_checkpoint@CP2 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-002-A022 | TP-SMV-002 | CP2 | 学生能写全「相似对应角 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-002-A023 | TP-SMV-002 | CP2 | 学生能说出改写后四条边各自的来源任务。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-002-A024 | TP-SMV-002 | CP2 | 「在图中找到以 D 为公共直角顶点的两个直角三角形」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-002-A025 | TP-SMV-002 | CP2 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-002-A026 | TP-SMV-002 | CP3 | 学生能写全「相似对应角 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-002-A027 | TP-SMV-002 | CP3 | 我可以写全「相似对应角 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-002-A028 | TP-SMV-002 | CP3 | 学生能写全「相似对应角 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-002-A029 | TP-SMV-002 | CP3 | 就是说，我可以写全「相似对应角 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-002-A030 | TP-SMV-002 | CP3 | 学生能写全「相似对硬脚 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-002-A031 | TP-SMV-002 | CP3 | 学生能写全「相似对应角 → 互余 → 垂直」的链条，不跳步。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-002-A032 | TP-SMV-002 | CP3 | 就是说那个……写全「相似对应角 → 互余 → 垂直」的链条，不跳步。，对吧 | expected_checkpoint@CP3 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-002-A033 | TP-SMV-002 | CP3 | 学生能说出改写后四条边各自的来源任务。 | unclear | cross-checkpoint-near |  | 跨 part 相邻（候选外 → unclear） |
| TP-SMV-002-A034 | TP-SMV-002 | CP3 | 学生能分工：第一组相似给哪两条边、角平分线给哪两条边。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-002-A035 | TP-SMV-002 | CP3 | 导角链跳步，直接宣布垂直 | incorrect@CP3 | deviation |  | plan common_deviations 原文 |
| TP-SMV-002-A036 | TP-SMV-002 | CP3 | 「写全「相似对应角 → 互余 → 垂直」的链条，不跳步」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-002-A037 | TP-SMV-002 | CP3 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-002-A038 | TP-SMV-002 | CP4 | 学生能说出改写后四条边各自的来源任务。 | expected_checkpoint@CP4 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-002-A039 | TP-SMV-002 | CP4 | 我可以说出改写后四条边各自的来源任务。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-002-A040 | TP-SMV-002 | CP4 | 学生能说出改写后四条边各自的来源任务。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-002-A041 | TP-SMV-002 | CP4 | 就是说，我可以说出改写后四条边各自的来源任务。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-002-A042 | TP-SMV-002 | CP4 | 学生能说出改写后四条边各自的来源任务。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-002-A043 | TP-SMV-002 | CP4 | 学生能说出改写后四条变各自的来源任务。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-002-A044 | TP-SMV-002 | CP4 | 就是说那个……说出改写后四条边各自的来源任务。，对吧 | expected_checkpoint@CP4 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-002-A045 | TP-SMV-002 | CP4 | 学生能分工：第一组相似给哪两条边、角平分线给哪两条边。 | expected_checkpoint@CP5 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-002-A046 | TP-SMV-002 | CP4 | 学生能执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-002-A047 | TP-SMV-002 | CP4 | 「说出改写后四条边各自的来源任务」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-002-A048 | TP-SMV-002 | CP4 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-002-A049 | TP-SMV-002 | CP5 | 学生能分工：第一组相似给哪两条边、角平分线给哪两条边。 | expected_checkpoint@CP5 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-002-A050 | TP-SMV-002 | CP5 | 我可以分工：第一组相似给哪两条边、角平分线给哪两条边。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-002-A051 | TP-SMV-002 | CP5 | 学生能分工：第一组相似给哪两条边、角平分线给哪两条边。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-002-A052 | TP-SMV-002 | CP5 | 就是说，我可以分工：第一组相似给哪两条边、角平分线给哪两条边。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-002-A053 | TP-SMV-002 | CP5 | 学生能分工：第一组相似给哪两条边、脚平分线给哪两条边。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-002-A054 | TP-SMV-002 | CP5 | 学生能分工：第一组相似给哪两条变、角平分线给哪两条边。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-002-A055 | TP-SMV-002 | CP5 | 就是说那个……分工：第一组相似给哪两条边、角平分线给哪两条边。，对吧 | expected_checkpoint@CP5 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-002-A056 | TP-SMV-002 | CP5 | 学生能执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | expected_checkpoint@CP6 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-002-A057 | TP-SMV-002 | CP5 | 「分工：第一组相似给哪两条边、角平分线给哪两条边」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-002-A058 | TP-SMV-002 | CP5 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-002-A059 | TP-SMV-002 | CP6 | 学生能执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | expected_checkpoint@CP6 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-002-A060 | TP-SMV-002 | CP6 | 我可以执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-002-A061 | TP-SMV-002 | CP6 | 学生能执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-002-A062 | TP-SMV-002 | CP6 | 就是说，我可以执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-002-A063 | TP-SMV-002 | CP6 | 学生能执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-002-A064 | TP-SMV-002 | CP6 | 学生能执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-002-A065 | TP-SMV-002 | CP6 | 就是说那个……执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）。，对吧 | expected_checkpoint@CP6 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-002-A066 | TP-SMV-002 | CP6 | 「执行「乘 → 约 → 收」并核对方向（分子分母对齐目标）」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-002-A067 | TP-SMV-002 | CP6 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-002-A068 | TP-SMV-002 | CP2 | 学生已能学生能把 $AD \cdot OC = AB \cdot OD$ 主动改写成比例式。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-002-A069 | TP-SMV-002 | CP2 | 我已能学生能把 $AD \cdot OC = AB \cdot OD$ 主动改写成比例式。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-002-A070 | TP-SMV-002 | CP5 | 学生已能学生见等积式目标先改比例式，再规划三角形组。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-002-A071 | TP-SMV-002 | CP5 | 我已能学生见等积式目标先改比例式，再规划三角形组。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-002-A072 | TP-SMV-002 | CP1 | 嗯……我不太确定这一步该怎么下手 | unclear | vague |  | 含糊输入 1 |
| TP-SMV-002-A073 | TP-SMV-002 | CP1 | 感觉好像是要用相似，但说不清楚 | unclear | vague |  | 含糊输入 2 |
| TP-SMV-002-A074 | TP-SMV-002 | CP1 | 这个条件和那个条件，我也不知道怎么连起来 | unclear | vague |  | 含糊输入 3 |
| TP-SMV-002-A075 | TP-SMV-002 | CP1 | (空) | no_progress | silence |  | 空文本（no_progress 只来自确定性路径） |
| TP-SMV-003-A001 | TP-SMV-003 | CP1 | 学生能把「重心」翻译成「中线」，再由等腰直角得到垂直。 | expected_checkpoint@CP1 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A002 | TP-SMV-003 | CP1 | 我可以把「重心」翻译成「中线」，再由等腰直角得到垂直。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A003 | TP-SMV-003 | CP1 | 学生能把「重心」翻译成「中线」，再由等腰直角得到垂直。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A004 | TP-SMV-003 | CP1 | 就是说，我可以把「重心」翻译成「中线」，再由等腰直角得到垂直。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A005 | TP-SMV-003 | CP1 | 学生能把「重心」翻译成「中线」，再由等腰直脚得到垂直。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A006 | TP-SMV-003 | CP1 | 学生能把「重心」翻译成「中线」，再由等腰直角得到垂直。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A007 | TP-SMV-003 | CP1 | 就是说那个……把「重心」翻译成「中线」，再由等腰直角得到垂直。，对吧 | expected_checkpoint@CP1 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A008 | TP-SMV-003 | CP1 | 学生能对同一个角写两条分解式并相减。 | expected_checkpoint@CP2 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-003-A009 | TP-SMV-003 | CP1 | 学生能核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-003-A010 | TP-SMV-003 | CP1 | 「把「重心」翻译成「中线」，再由等腰直角得到垂直」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A011 | TP-SMV-003 | CP1 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A012 | TP-SMV-003 | CP1 | 这些结论根本不成立，题目本身有问题 | unclear | negation | 是 | 补充反例 1：全盘否定（无具体对齐主张）→ 非 expected/alternate |
| TP-SMV-003-A013 | TP-SMV-003 | CP1 | 我完全不知道从哪里开始，一点思路都没有 | unclear | vague | 是 | 补充反例 2：完全空白 |
| TP-SMV-003-A014 | TP-SMV-003 | CP1 | 这道题是求长度吧？我不确定题目在问什么 | unclear | vague | 是 | 补充反例 3：元问题（关于题目而非推理） |
| TP-SMV-003-A015 | TP-SMV-003 | CP2 | 学生能对同一个角写两条分解式并相减。 | expected_checkpoint@CP2 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A016 | TP-SMV-003 | CP2 | 我可以对同一个角写两条分解式并相减。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A017 | TP-SMV-003 | CP2 | 学生能对同一个角写两条分解式并相减。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A018 | TP-SMV-003 | CP2 | 就是说，我可以对同一个角写两条分解式并相减。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A019 | TP-SMV-003 | CP2 | 学生能对同一个脚写两条分解式并相减。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A020 | TP-SMV-003 | CP2 | 学生能对同一个角写两条分解式并相减。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A021 | TP-SMV-003 | CP2 | 就是说那个……对同一个角写两条分解式并相减。，对吧 | expected_checkpoint@CP2 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A022 | TP-SMV-003 | CP2 | 学生能核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。 | expected_checkpoint@CP3 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-003-A023 | TP-SMV-003 | CP2 | 学生能想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-003-A024 | TP-SMV-003 | CP2 | 「对同一个角写两条分解式并相减」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A025 | TP-SMV-003 | CP2 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A026 | TP-SMV-003 | CP3 | 学生能核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。 | expected_checkpoint@CP3 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A027 | TP-SMV-003 | CP3 | 我可以核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A028 | TP-SMV-003 | CP3 | 学生能核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A029 | TP-SMV-003 | CP3 | 就是说，我可以核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A030 | TP-SMV-003 | CP3 | 学生能核对脚的记号转换（DAE→DAB、ECF→DCF）后落笔。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A031 | TP-SMV-003 | CP3 | 学生能核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A032 | TP-SMV-003 | CP3 | 就是说那个……核对角的记号转换（DAE→DAB、ECF→DCF）后落笔。，对吧 | expected_checkpoint@CP3 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A033 | TP-SMV-003 | CP3 | 学生能想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | unclear | cross-checkpoint-near |  | 跨 part 相邻（候选外 → unclear） |
| TP-SMV-003-A034 | TP-SMV-003 | CP3 | 学生能用合比性质把 DE/EH 转成 DH/EH。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-003-A035 | TP-SMV-003 | CP3 | 「核对角的记号转换（DAE→DAB、ECF→DCF）后落笔」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A036 | TP-SMV-003 | CP3 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A037 | TP-SMV-003 | CP4 | 学生能想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | expected_checkpoint@CP4 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A038 | TP-SMV-003 | CP4 | 我可以想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A039 | TP-SMV-003 | CP4 | 学生能想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A040 | TP-SMV-003 | CP4 | 就是说，我可以想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A041 | TP-SMV-003 | CP4 | 学生能想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A042 | TP-SMV-003 | CP4 | 学生能想到作高构造全等，把 BC 侧的量转到 CD 轴上。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A043 | TP-SMV-003 | CP4 | 就是说那个……想到作高构造全等，把 BC 侧的量转到 CD 轴上。，对吧 | expected_checkpoint@CP4 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A044 | TP-SMV-003 | CP4 | 学生能用合比性质把 DE/EH 转成 DH/EH。 | expected_checkpoint@CP5 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-003-A045 | TP-SMV-003 | CP4 | 学生能合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-003-A046 | TP-SMV-003 | CP4 | 「想到作高构造全等，把 BC 侧的量转到 CD 轴上」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A047 | TP-SMV-003 | CP4 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A048 | TP-SMV-003 | CP5 | 学生能用合比性质把 DE/EH 转成 DH/EH。 | expected_checkpoint@CP5 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A049 | TP-SMV-003 | CP5 | 我可以用合比性质把 DE/EH 转成 DH/EH。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A050 | TP-SMV-003 | CP5 | 学生能用合比性质把 DE/EH 转成 DH/EH。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A051 | TP-SMV-003 | CP5 | 就是说，我可以用合比性质把 DE/EH 转成 DH/EH。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A052 | TP-SMV-003 | CP5 | 学生能用合比性质把 DE/EH 转成 DH/EH。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A053 | TP-SMV-003 | CP5 | 学生能用合比性质把 DE/EH 转成 DH/EH。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A054 | TP-SMV-003 | CP5 | 就是说那个……用合比性质把 DE/EH 转成 DH/EH。，对吧 | expected_checkpoint@CP5 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A055 | TP-SMV-003 | CP5 | 学生能合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-003-A056 | TP-SMV-003 | CP5 | 学生能不重不漏列出两类并说明分类依据（腰的两个端点）。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-003-A057 | TP-SMV-003 | CP5 | 「用合比性质把 DE/EH 转成 DH/EH」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A058 | TP-SMV-003 | CP5 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A059 | TP-SMV-003 | CP6 | 学生能合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A060 | TP-SMV-003 | CP6 | 我可以合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A061 | TP-SMV-003 | CP6 | 学生能合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A062 | TP-SMV-003 | CP6 | 就是说，我可以合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A063 | TP-SMV-003 | CP6 | 学生能合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A064 | TP-SMV-003 | CP6 | 学生能合并分式并说明范围来自 E 的位置约束。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A065 | TP-SMV-003 | CP6 | 就是说那个……合并分式并说明范围来自 E 的位置约束。，对吧 | expected_checkpoint@CP6 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A066 | TP-SMV-003 | CP6 | 学生能不重不漏列出两类并说明分类依据（腰的两个端点）。 | unclear | cross-checkpoint-near |  | 跨 part 相邻（候选外 → unclear） |
| TP-SMV-003-A067 | TP-SMV-003 | CP6 | 学生能用「到两端等距 → 垂直」识别中垂线结构。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-003-A068 | TP-SMV-003 | CP6 | 范围写成 0<x<2（漏端点） | incorrect@CP6 | deviation |  | plan common_deviations 原文 |
| TP-SMV-003-A069 | TP-SMV-003 | CP6 | 「合并分式并说明范围来自 E 的位置约束」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A070 | TP-SMV-003 | CP6 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A071 | TP-SMV-003 | CP7 | 学生能不重不漏列出两类并说明分类依据（腰的两个端点）。 | expected_checkpoint@CP7 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A072 | TP-SMV-003 | CP7 | 我可以不重不漏写出来两类并说明分类依据（腰的两个端点）。 | expected_checkpoint@CP7 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A073 | TP-SMV-003 | CP7 | 学生能不重不漏列出两类并说明分类依据（腰的两个端点）。 | expected_checkpoint@CP7 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A074 | TP-SMV-003 | CP7 | 就是说，我可以不重不漏写出来两类并说明分类依据（腰的两个端点）。 | expected_checkpoint@CP7 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A075 | TP-SMV-003 | CP7 | 学生能不重不漏列出两类并说明分类依据（腰的两个端点）。 | expected_checkpoint@CP7 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A076 | TP-SMV-003 | CP7 | 学生能不重不漏列出两类并说明分类依据（腰的两个端点）。 | expected_checkpoint@CP7 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A077 | TP-SMV-003 | CP7 | 就是说那个……不重不漏列出两类并说明分类依据（腰的两个端点）。，对吧 | expected_checkpoint@CP7 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A078 | TP-SMV-003 | CP7 | 学生能用「到两端等距 → 垂直」识别中垂线结构。 | expected_checkpoint@CP8 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-003-A079 | TP-SMV-003 | CP7 | 学生能代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-003-A080 | TP-SMV-003 | CP7 | 「不重不漏列出两类并说明分类依据（腰的两个端点）」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A081 | TP-SMV-003 | CP7 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A082 | TP-SMV-003 | CP8 | 学生能用「到两端等距 → 垂直」识别中垂线结构。 | expected_checkpoint@CP8 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A083 | TP-SMV-003 | CP8 | 我可以用「到两端等距 → 垂直」识别中垂线结构。 | expected_checkpoint@CP8 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A084 | TP-SMV-003 | CP8 | 学生能用「到两端等距 → 垂直」识别中垂线结构。 | expected_checkpoint@CP8 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A085 | TP-SMV-003 | CP8 | 就是说，我可以用「到两端等距 → 垂直」识别中垂线结构。 | expected_checkpoint@CP8 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A086 | TP-SMV-003 | CP8 | 学生能用「到两端等距 → 垂直」识别中垂线结构。 | expected_checkpoint@CP8 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A087 | TP-SMV-003 | CP8 | 学生能用「到两端等距 → 垂直」识别中垂线结构。 | expected_checkpoint@CP8 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A088 | TP-SMV-003 | CP8 | 就是说那个……用「到两端等距 → 垂直」识别中垂线结构。，对吧 | expected_checkpoint@CP8 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A089 | TP-SMV-003 | CP8 | 学生能代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-003-A090 | TP-SMV-003 | CP8 | 「用「到两端等距 → 垂直」识别中垂线结构」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A091 | TP-SMV-003 | CP8 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A092 | TP-SMV-003 | CP9 | 学生能代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-003-A093 | TP-SMV-003 | CP9 | 我可以代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-003-A094 | TP-SMV-003 | CP9 | 学生能代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-003-A095 | TP-SMV-003 | CP9 | 就是说，我可以代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-003-A096 | TP-SMV-003 | CP9 | 学生能代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-003-A097 | TP-SMV-003 | CP9 | 学生能代回函数范围检验两解均合法。 | expected_checkpoint@CP9 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-003-A098 | TP-SMV-003 | CP9 | 就是说那个……代回函数范围检验两解均合法。，对吧 | expected_checkpoint@CP9 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-003-A099 | TP-SMV-003 | CP9 | 漏一类，或解后不代回范围 | incorrect@CP9 | deviation |  | plan common_deviations 原文 |
| TP-SMV-003-A100 | TP-SMV-003 | CP9 | 「代回函数范围检验两解均合法」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-003-A101 | TP-SMV-003 | CP9 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-003-A102 | TP-SMV-003 | CP2 | 学生已能学生看到重心条件能联想到三线合一与中线性质。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-003-A103 | TP-SMV-003 | CP2 | 我已能学生看到重心条件能联想到三线合一与中线性质。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-003-A104 | TP-SMV-003 | CP5 | 学生已能学生知道函数关系式要「设元 → 找等量 → 消元」。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-003-A105 | TP-SMV-003 | CP5 | 我已能学生知道函数关系式要「设元 → 找等量 → 消元」。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-003-A106 | TP-SMV-003 | CP8 | 学生已能学生能对「以 CG 为腰」枚举两种等腰可能并分别画图。，可直接跳过开场确认 | alternate_valid@R6 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-003-A107 | TP-SMV-003 | CP8 | 我已能学生能对「以 CG 为腰」枚举两种等腰可能并分别画图。，可直接跳过开场确认 | alternate_valid@R6 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-003-A108 | TP-SMV-003 | CP1 | 嗯……我不太确定这一步该怎么下手 | unclear | vague |  | 含糊输入 1 |
| TP-SMV-003-A109 | TP-SMV-003 | CP1 | 感觉好像是要用相似，但说不清楚 | unclear | vague |  | 含糊输入 2 |
| TP-SMV-003-A110 | TP-SMV-003 | CP1 | 这个条件和那个条件，我也不知道怎么连起来 | unclear | vague |  | 含糊输入 3 |
| TP-SMV-003-A111 | TP-SMV-003 | CP1 | (空) | no_progress | silence |  | 空文本（no_progress 只来自确定性路径） |
| TP-SMV-004-A001 | TP-SMV-004 | CP1 | 学生能说出哪两条线平行、截出哪两个三角形。 | expected_checkpoint@CP1 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-004-A002 | TP-SMV-004 | CP1 | 我可以说出哪两条线平行、截出哪两个三角形。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-004-A003 | TP-SMV-004 | CP1 | 学生能说出哪两条线平行、截出哪两个三角形。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-004-A004 | TP-SMV-004 | CP1 | 就是说，我可以说出哪两条线平行、截出哪两个三角形。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-004-A005 | TP-SMV-004 | CP1 | 学生能说出哪两条线平行、截出哪两个三脚形。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-004-A006 | TP-SMV-004 | CP1 | 学生能说出哪两条线平行、截出哪两个三角形。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-004-A007 | TP-SMV-004 | CP1 | 就是说那个……说出哪两条线平行、截出哪两个三角形。，对吧 | expected_checkpoint@CP1 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-004-A008 | TP-SMV-004 | CP1 | 学生能写出比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。 | expected_checkpoint@CP2 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-004-A009 | TP-SMV-004 | CP1 | 学生能独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-004-A010 | TP-SMV-004 | CP1 | 仪器边长与相似三角形对应边对应错 | incorrect@CP1 | deviation |  | plan common_deviations 原文 |
| TP-SMV-004-A011 | TP-SMV-004 | CP1 | 「说出哪两条线平行、截出哪两个三角形」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-004-A012 | TP-SMV-004 | CP1 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-004-A013 | TP-SMV-004 | CP1 | 这些结论根本不成立，题目本身有问题 | unclear | negation | 是 | 补充反例 1：全盘否定（无具体对齐主张）→ 非 expected/alternate |
| TP-SMV-004-A014 | TP-SMV-004 | CP1 | 我完全不知道从哪里开始，一点思路都没有 | unclear | vague | 是 | 补充反例 2：完全空白 |
| TP-SMV-004-A015 | TP-SMV-004 | CP1 | 这道题是求长度吧？我不确定题目在问什么 | unclear | vague | 是 | 补充反例 3：元问题（关于题目而非推理） |
| TP-SMV-004-A016 | TP-SMV-004 | CP2 | 学生能写出比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。 | expected_checkpoint@CP2 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-004-A017 | TP-SMV-004 | CP2 | 我可以得到比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-004-A018 | TP-SMV-004 | CP2 | 学生能写出比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-004-A019 | TP-SMV-004 | CP2 | 就是说，我可以得到比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-004-A020 | TP-SMV-004 | CP2 | 学生能写出比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-004-A021 | TP-SMV-004 | CP2 | 学生能写出比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-004-A022 | TP-SMV-004 | CP2 | 就是说那个……写出比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源。，对吧 | expected_checkpoint@CP2 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-004-A023 | TP-SMV-004 | CP2 | 学生能独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-004-A024 | TP-SMV-004 | CP2 | A 字型对应边错配 | incorrect@CP2 | deviation |  | plan common_deviations 原文 |
| TP-SMV-004-A025 | TP-SMV-004 | CP2 | 漏加仪器的 40cm 结构量 | incorrect@CP2 | deviation |  | plan common_deviations 原文 |
| TP-SMV-004-A026 | TP-SMV-004 | CP2 | 「写出比例式并解出 $MN=(a+b+40)\,\mathrm{cm}$，说明每项来源」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-004-A027 | TP-SMV-004 | CP2 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-004-A028 | TP-SMV-004 | CP3 | 学生能独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-004-A029 | TP-SMV-004 | CP3 | 我可以独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-004-A030 | TP-SMV-004 | CP3 | 学生能独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-004-A031 | TP-SMV-004 | CP3 | 就是说，我可以独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-004-A032 | TP-SMV-004 | CP3 | 学生能独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-004-A033 | TP-SMV-004 | CP3 | 学生能独立完成第二次建模并解释两种表达式为何表示同一树高。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-004-A034 | TP-SMV-004 | CP3 | 就是说那个……独立完成第二次建模并解释两种表达式为何表示同一树高。，对吧 | expected_checkpoint@CP3 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-004-A035 | TP-SMV-004 | CP3 | 两次实践的比例方向写反 | incorrect@CP3 | deviation |  | plan common_deviations 原文 |
| TP-SMV-004-A036 | TP-SMV-004 | CP3 | 单位换算出错 | incorrect@CP3 | deviation |  | plan common_deviations 原文 |
| TP-SMV-004-A037 | TP-SMV-004 | CP3 | 「独立完成第二次建模并解释两种表达式为何表示同一树高」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-004-A038 | TP-SMV-004 | CP3 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-004-A039 | TP-SMV-004 | CP2 | 学生已能学生能把实物图抽象成两条平行线截得的相似三角形。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-004-A040 | TP-SMV-004 | CP2 | 我已能学生能把实物图抽象成两条平行线截得的相似三角形。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-004-A041 | TP-SMV-004 | CP1 | 嗯……我不太确定这一步该怎么下手 | unclear | vague |  | 含糊输入 1 |
| TP-SMV-004-A042 | TP-SMV-004 | CP1 | 感觉好像是要用相似，但说不清楚 | unclear | vague |  | 含糊输入 2 |
| TP-SMV-004-A043 | TP-SMV-004 | CP1 | 这个条件和那个条件，我也不知道怎么连起来 | unclear | vague |  | 含糊输入 3 |
| TP-SMV-004-A044 | TP-SMV-004 | CP1 | (空) | no_progress | silence |  | 空文本（no_progress 只来自确定性路径） |
| TP-SMV-005-A001 | TP-SMV-005 | CP1 | 学生能立刻把角平分线条件翻译成两个三角形的公共等角。 | expected_checkpoint@CP1 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-005-A002 | TP-SMV-005 | CP1 | 我可以马上把角平分线条件翻译成两个三角形的公共等角。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-005-A003 | TP-SMV-005 | CP1 | 学生能马上把角平分线条件翻译成两个三角形的公共等角。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-005-A004 | TP-SMV-005 | CP1 | 就是说，我可以立刻把角平分线条件翻译成两个三角形的公共等角。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-005-A005 | TP-SMV-005 | CP1 | 学生能立刻把脚平分线条件翻译成两个三角形的公共等角。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-005-A006 | TP-SMV-005 | CP1 | 学生能立刻把角平分线条件翻译成两个三角形的公共等角。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-005-A007 | TP-SMV-005 | CP1 | 就是说那个……立刻把角平分线条件翻译成两个三角形的公共等角。，对吧 | expected_checkpoint@CP1 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-005-A008 | TP-SMV-005 | CP1 | 学生能用「等腰 + 外角」补出第二组角。 | expected_checkpoint@CP2 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-005-A009 | TP-SMV-005 | CP1 | 学生能写明判定依据（AA）并核对顶点对应顺序。 | expected_checkpoint@CP3 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-005-A010 | TP-SMV-005 | CP1 | 平分线两侧的角与三角形顶点对应错 | incorrect@CP1 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A011 | TP-SMV-005 | CP1 | 「立刻把角平分线条件翻译成两个三角形的公共等角」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-005-A012 | TP-SMV-005 | CP1 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-005-A013 | TP-SMV-005 | CP1 | 这些结论根本不成立，题目本身有问题 | unclear | negation | 是 | 补充反例 1：全盘否定（无具体对齐主张）→ 非 expected/alternate |
| TP-SMV-005-A014 | TP-SMV-005 | CP1 | 我完全不知道从哪里开始，一点思路都没有 | unclear | vague | 是 | 补充反例 2：完全空白 |
| TP-SMV-005-A015 | TP-SMV-005 | CP1 | 这道题是求长度吧？我不确定题目在问什么 | unclear | vague | 是 | 补充反例 3：元问题（关于题目而非推理） |
| TP-SMV-005-A016 | TP-SMV-005 | CP2 | 学生能用「等腰 + 外角」补出第二组角。 | expected_checkpoint@CP2 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-005-A017 | TP-SMV-005 | CP2 | 我可以用「等腰 + 外角」补出第二组角。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-005-A018 | TP-SMV-005 | CP2 | 学生能用「等腰 + 外角」补出第二组角。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-005-A019 | TP-SMV-005 | CP2 | 就是说，我可以用「等腰 + 外角」补出第二组角。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-005-A020 | TP-SMV-005 | CP2 | 学生能用「等腰 + 外脚」补出第二组角。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-005-A021 | TP-SMV-005 | CP2 | 学生能用「等腰 + 外角」补出第二组角。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-005-A022 | TP-SMV-005 | CP2 | 就是说那个……用「等腰 + 外角」补出第二组角。，对吧 | expected_checkpoint@CP2 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-005-A023 | TP-SMV-005 | CP2 | 学生能写明判定依据（AA）并核对顶点对应顺序。 | expected_checkpoint@CP3 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-005-A024 | TP-SMV-005 | CP2 | 学生能指出平行线截哪两条线产生这对内错角。 | expected_checkpoint@CP4 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-005-A025 | TP-SMV-005 | CP2 | 把外角当成底角本身 | incorrect@CP2 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A026 | TP-SMV-005 | CP2 | 「用「等腰 + 外角」补出第二组角」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-005-A027 | TP-SMV-005 | CP2 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-005-A028 | TP-SMV-005 | CP3 | 学生能写明判定依据（AA）并核对顶点对应顺序。 | expected_checkpoint@CP3 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-005-A029 | TP-SMV-005 | CP3 | 我可以写明判定依据（AA）并核对顶点对应顺序。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-005-A030 | TP-SMV-005 | CP3 | 学生能写明判定依据（AA）并核对顶点对应顺序。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-005-A031 | TP-SMV-005 | CP3 | 就是说，我可以写明判定依据（AA）并核对顶点对应顺序。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-005-A032 | TP-SMV-005 | CP3 | 学生能写明判定依据（AA）并核对顶点对硬顺序。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-005-A033 | TP-SMV-005 | CP3 | 学生能写明判定依据（AA）并核对顶点对应顺序。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-005-A034 | TP-SMV-005 | CP3 | 就是说那个……写明判定依据（AA）并核对顶点对应顺序。，对吧 | expected_checkpoint@CP3 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-005-A035 | TP-SMV-005 | CP3 | 学生能指出平行线截哪两条线产生这对内错角。 | expected_checkpoint@CP4 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-005-A036 | TP-SMV-005 | CP3 | 学生能完成「分解 → 相减 → 公共角」的三步配角。 | expected_checkpoint@CP5 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-005-A037 | TP-SMV-005 | CP3 | 顶点对应关系写错 | incorrect@CP3 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A038 | TP-SMV-005 | CP3 | 只证一组角相等就下相似结论 | incorrect@CP3 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A039 | TP-SMV-005 | CP3 | 「写明判定依据（AA）并核对顶点对应顺序」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-005-A040 | TP-SMV-005 | CP3 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-005-A041 | TP-SMV-005 | CP4 | 学生能指出平行线截哪两条线产生这对内错角。 | expected_checkpoint@CP4 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-005-A042 | TP-SMV-005 | CP4 | 我可以找到平行线截哪两条线产生这对内错角。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-005-A043 | TP-SMV-005 | CP4 | 学生能找到平行线截哪两条线产生这对内错角。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-005-A044 | TP-SMV-005 | CP4 | 就是说，我可以指出平行线截哪两条线产生这对内错角。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-005-A045 | TP-SMV-005 | CP4 | 学生能指出平行线截哪两条线产生这对内错脚。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-005-A046 | TP-SMV-005 | CP4 | 学生能指出平行线截哪两条线产生这对内错角。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-005-A047 | TP-SMV-005 | CP4 | 就是说那个……指出平行线截哪两条线产生这对内错角。，对吧 | expected_checkpoint@CP4 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-005-A048 | TP-SMV-005 | CP4 | 学生能完成「分解 → 相减 → 公共角」的三步配角。 | expected_checkpoint@CP5 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-005-A049 | TP-SMV-005 | CP4 | 学生能规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-005-A050 | TP-SMV-005 | CP4 | 平行等角认错位置（内错角与同位角混淆） | incorrect@CP4 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A051 | TP-SMV-005 | CP4 | 「指出平行线截哪两条线产生这对内错角」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-005-A052 | TP-SMV-005 | CP4 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-005-A053 | TP-SMV-005 | CP5 | 学生能完成「分解 → 相减 → 公共角」的三步配角。 | expected_checkpoint@CP5 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-005-A054 | TP-SMV-005 | CP5 | 我可以完成「分解 → 相减 → 公共角」的三步配角。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-005-A055 | TP-SMV-005 | CP5 | 学生能完成「分解 → 相减 → 公共角」的三步配角。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-005-A056 | TP-SMV-005 | CP5 | 就是说，我可以完成「分解 → 相减 → 公共角」的三步配角。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-005-A057 | TP-SMV-005 | CP5 | 学生能完成「分解 → 相减 → 公共脚」的三步配角。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-005-A058 | TP-SMV-005 | CP5 | 学生能完成「分解 → 相减 → 公共角」的三步配角。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-005-A059 | TP-SMV-005 | CP5 | 就是说那个……完成「分解 → 相减 → 公共角」的三步配角。，对吧 | expected_checkpoint@CP5 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-005-A060 | TP-SMV-005 | CP5 | 学生能规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-005-A061 | TP-SMV-005 | CP5 | 外角和分解相减时对应项错位 | incorrect@CP5 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A062 | TP-SMV-005 | CP5 | 「完成「分解 → 相减 → 公共角」的三步配角」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-005-A063 | TP-SMV-005 | CP5 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-005-A064 | TP-SMV-005 | CP6 | 学生能规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-005-A065 | TP-SMV-005 | CP6 | 我可以规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-005-A066 | TP-SMV-005 | CP6 | 学生能规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-005-A067 | TP-SMV-005 | CP6 | 就是说，我可以规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-005-A068 | TP-SMV-005 | CP6 | 学生能规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-005-A069 | TP-SMV-005 | CP6 | 学生能规划「先相似比、再平行比」的转移顺序，不硬凑。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-005-A070 | TP-SMV-005 | CP6 | 就是说那个……规划「先相似比、再平行比」的转移顺序，不硬凑。，对吧 | expected_checkpoint@CP6 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-005-A071 | TP-SMV-005 | CP6 | 平行线截得的比例上下位写反 | incorrect@CP6 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A072 | TP-SMV-005 | CP6 | 不用第一问结论另起炉灶 | incorrect@CP6 | deviation |  | plan common_deviations 原文 |
| TP-SMV-005-A073 | TP-SMV-005 | CP6 | 「规划「先相似比、再平行比」的转移顺序，不硬凑」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-005-A074 | TP-SMV-005 | CP6 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-005-A075 | TP-SMV-005 | CP2 | 学生已能学生看到角平分线与等腰能分别翻译出等角。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-005-A076 | TP-SMV-005 | CP2 | 我已能学生看到角平分线与等腰能分别翻译出等角。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-005-A077 | TP-SMV-005 | CP5 | 学生已能学生能把平行条件翻译成等角，并寻找公共角。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-005-A078 | TP-SMV-005 | CP5 | 我已能学生能把平行条件翻译成等角，并寻找公共角。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-005-A079 | TP-SMV-005 | CP1 | 嗯……我不太确定这一步该怎么下手 | unclear | vague |  | 含糊输入 1 |
| TP-SMV-005-A080 | TP-SMV-005 | CP1 | 感觉好像是要用相似，但说不清楚 | unclear | vague |  | 含糊输入 2 |
| TP-SMV-005-A081 | TP-SMV-005 | CP1 | 这个条件和那个条件，我也不知道怎么连起来 | unclear | vague |  | 含糊输入 3 |
| TP-SMV-005-A082 | TP-SMV-005 | CP1 | (空) | no_progress | silence |  | 空文本（no_progress 只来自确定性路径） |
| TP-SMV-006-A001 | TP-SMV-006 | CP1 | 学生能由三角函数值还原直角边并算出 AG。 | expected_checkpoint@CP1 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A002 | TP-SMV-006 | CP1 | 我可以由三角函数值还原直角边并算出 AG。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A003 | TP-SMV-006 | CP1 | 学生能由三角函数值还原直角边并算出 AG。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A004 | TP-SMV-006 | CP1 | 就是说，我可以由三角函数值还原直角边并算出 AG。 | expected_checkpoint@CP1 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A005 | TP-SMV-006 | CP1 | 学生能由三脚函数值还原直角边并算出 AG。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A006 | TP-SMV-006 | CP1 | 学生能由三角函数值还原直角变并算出 AG。 | expected_checkpoint@CP1 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A007 | TP-SMV-006 | CP1 | 就是说那个……由三角函数值还原直角边并算出 AG。，对吧 | expected_checkpoint@CP1 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A008 | TP-SMV-006 | CP1 | 学生能在两个不同三角形里分别表达正切。 | expected_checkpoint@CP2 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-006-A009 | TP-SMV-006 | CP1 | 学生能说明「锐角 + 三角函数值相等 → 角相等」的依据。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-006-A010 | TP-SMV-006 | CP1 | 「由三角函数值还原直角边并算出 AG」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A011 | TP-SMV-006 | CP1 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A012 | TP-SMV-006 | CP1 | 这些结论根本不成立，题目本身有问题 | unclear | negation | 是 | 补充反例 1：全盘否定（无具体对齐主张）→ 非 expected/alternate |
| TP-SMV-006-A013 | TP-SMV-006 | CP1 | 我完全不知道从哪里开始，一点思路都没有 | unclear | vague | 是 | 补充反例 2：完全空白 |
| TP-SMV-006-A014 | TP-SMV-006 | CP1 | 这道题是求长度吧？我不确定题目在问什么 | unclear | vague | 是 | 补充反例 3：元问题（关于题目而非推理） |
| TP-SMV-006-A015 | TP-SMV-006 | CP2 | 学生能在两个不同三角形里分别表达正切。 | expected_checkpoint@CP2 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A016 | TP-SMV-006 | CP2 | 我可以在两个不同三角形里分别表达正切。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A017 | TP-SMV-006 | CP2 | 学生能在两个不同三角形里分别表达正切。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A018 | TP-SMV-006 | CP2 | 就是说，我可以在两个不同三角形里分别表达正切。 | expected_checkpoint@CP2 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A019 | TP-SMV-006 | CP2 | 学生能在两个不同三脚形里分别表达正切。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A020 | TP-SMV-006 | CP2 | 学生能在两个不同三角形里分别表达正切。 | expected_checkpoint@CP2 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A021 | TP-SMV-006 | CP2 | 就是说那个……在两个不同三角形里分别表达正切。，对吧 | expected_checkpoint@CP2 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A022 | TP-SMV-006 | CP2 | 学生能说明「锐角 + 三角函数值相等 → 角相等」的依据。 | expected_checkpoint@CP3 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-006-A023 | TP-SMV-006 | CP2 | 学生能写出「平行内错角 + 已证等角 → 差角相等」的链条。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-006-A024 | TP-SMV-006 | CP2 | 「在两个不同三角形里分别表达正切」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A025 | TP-SMV-006 | CP2 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A026 | TP-SMV-006 | CP3 | 学生能说明「锐角 + 三角函数值相等 → 角相等」的依据。 | expected_checkpoint@CP3 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A027 | TP-SMV-006 | CP3 | 我可以说明「锐角 + 三角函数值相等 → 角相等」的依据。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A028 | TP-SMV-006 | CP3 | 学生能说明「锐角 + 三角函数值相等 → 角相等」的依据。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A029 | TP-SMV-006 | CP3 | 就是说，我可以说明「锐角 + 三角函数值相等 → 角相等」的依据。 | expected_checkpoint@CP3 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A030 | TP-SMV-006 | CP3 | 学生能说明「锐脚 + 三角函数值相等 → 角相等」的依据。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A031 | TP-SMV-006 | CP3 | 学生能说明「锐角 + 三角函数值像等 → 角相等」的依据。 | expected_checkpoint@CP3 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A032 | TP-SMV-006 | CP3 | 就是说那个……说明「锐角 + 三角函数值相等 → 角相等」的依据。，对吧 | expected_checkpoint@CP3 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A033 | TP-SMV-006 | CP3 | 学生能写出「平行内错角 + 已证等角 → 差角相等」的链条。 | unclear | cross-checkpoint-near |  | 跨 part 相邻（候选外 → unclear） |
| TP-SMV-006-A034 | TP-SMV-006 | CP3 | 学生能核对待定相似的对应顶点后再用条件。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-006-A035 | TP-SMV-006 | CP3 | 「说明「锐角 + 三角函数值相等 → 角相等」的依据」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A036 | TP-SMV-006 | CP3 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A037 | TP-SMV-006 | CP4 | 学生能写出「平行内错角 + 已证等角 → 差角相等」的链条。 | expected_checkpoint@CP4 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A038 | TP-SMV-006 | CP4 | 我可以得到「平行内错角 + 已证等角 → 差角相等」的链条。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A039 | TP-SMV-006 | CP4 | 学生能写出「平行内错角 + 已证等角 → 差角相等」的链条。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A040 | TP-SMV-006 | CP4 | 就是说，我可以得到「平行内错角 + 已证等角 → 差角相等」的链条。 | expected_checkpoint@CP4 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A041 | TP-SMV-006 | CP4 | 学生能写出「平行内错脚 + 已证等角 → 差角相等」的链条。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A042 | TP-SMV-006 | CP4 | 学生能写出「平行内错角 + 已证等角 → 差角像等」的链条。 | expected_checkpoint@CP4 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A043 | TP-SMV-006 | CP4 | 就是说那个……写出「平行内错角 + 已证等角 → 差角相等」的链条。，对吧 | expected_checkpoint@CP4 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A044 | TP-SMV-006 | CP4 | 学生能核对待定相似的对应顶点后再用条件。 | expected_checkpoint@CP5 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-006-A045 | TP-SMV-006 | CP4 | 学生能用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-006-A046 | TP-SMV-006 | CP4 | 「写出「平行内错角 + 已证等角 → 差角相等」的链条」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A047 | TP-SMV-006 | CP4 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A048 | TP-SMV-006 | CP5 | 学生能核对待定相似的对应顶点后再用条件。 | expected_checkpoint@CP5 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A049 | TP-SMV-006 | CP5 | 我可以核对待定相似的对应顶点后再用条件。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A050 | TP-SMV-006 | CP5 | 学生能核对待定相似的对应顶点后再用条件。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A051 | TP-SMV-006 | CP5 | 就是说，我可以核对待定相似的对应顶点后再用条件。 | expected_checkpoint@CP5 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A052 | TP-SMV-006 | CP5 | 学生能核对待定相似的对硬顶点后再用条件。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A053 | TP-SMV-006 | CP5 | 学生能核对待定相似的对应顶点后再用条件。 | expected_checkpoint@CP5 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A054 | TP-SMV-006 | CP5 | 就是说那个……核对待定相似的对应顶点后再用条件。，对吧 | expected_checkpoint@CP5 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A055 | TP-SMV-006 | CP5 | 学生能用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-006-A056 | TP-SMV-006 | CP5 | 学生能识别共顶点、底共线的等高结构并把面积比化成线段比。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-006-A057 | TP-SMV-006 | CP5 | 「核对待定相似的对应顶点后再用条件」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A058 | TP-SMV-006 | CP5 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A059 | TP-SMV-006 | CP6 | 学生能用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A060 | TP-SMV-006 | CP6 | 我可以用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A061 | TP-SMV-006 | CP6 | 学生能用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A062 | TP-SMV-006 | CP6 | 就是说，我可以用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A063 | TP-SMV-006 | CP6 | 学生能用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A064 | TP-SMV-006 | CP6 | 学生能用余切（而非正切）使所求变落在分子，解出 $BP=\frac{17}{3}$。 | expected_checkpoint@CP6 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A065 | TP-SMV-006 | CP6 | 就是说那个……用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$。，对吧 | expected_checkpoint@CP6 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A066 | TP-SMV-006 | CP6 | 学生能识别共顶点、底共线的等高结构并把面积比化成线段比。 | unclear | cross-checkpoint-near |  | 跨 part 相邻（候选外 → unclear） |
| TP-SMV-006-A067 | TP-SMV-006 | CP6 | 学生能用相似把 MH/GP 建立倍数关系并列一元方程。 | unclear | cross-checkpoint-far |  | 远距节点（候选外 → unclear） |
| TP-SMV-006-A068 | TP-SMV-006 | CP6 | 用正切导致求出倒数 | incorrect@CP6 | deviation |  | plan common_deviations 原文 |
| TP-SMV-006-A069 | TP-SMV-006 | CP6 | 「用余切（而非正切）使所求边落在分子，解出 $BP=\frac{17}{3}$」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A070 | TP-SMV-006 | CP6 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A071 | TP-SMV-006 | CP7 | 学生能识别共顶点、底共线的等高结构并把面积比化成线段比。 | expected_checkpoint@CP7 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A072 | TP-SMV-006 | CP7 | 我可以识别共顶点、底共线的等高结构并把面积比化成线段比。 | expected_checkpoint@CP7 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A073 | TP-SMV-006 | CP7 | 学生能识别共顶点、底共线的等高结构并把面积比化成线段比。 | expected_checkpoint@CP7 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A074 | TP-SMV-006 | CP7 | 就是说，我可以识别共顶点、底共线的等高结构并把面积比化成线段比。 | expected_checkpoint@CP7 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A075 | TP-SMV-006 | CP7 | 学生能识别共顶点、底共线的等高结构并把面积比化成线段比。 | expected_checkpoint@CP7 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A076 | TP-SMV-006 | CP7 | 学生能识别共顶点、底共线的等高结构并把面积比化成线段比。 | expected_checkpoint@CP7 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A077 | TP-SMV-006 | CP7 | 就是说那个……识别共顶点、底共线的等高结构并把面积比化成线段比。，对吧 | expected_checkpoint@CP7 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A078 | TP-SMV-006 | CP7 | 学生能用相似把 MH/GP 建立倍数关系并列一元方程。 | expected_checkpoint@CP8 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-006-A079 | TP-SMV-006 | CP7 | 学生能完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | cross-checkpoint-far |  | 带偏差清单的远距节点（候选内） |
| TP-SMV-006-A080 | TP-SMV-006 | CP7 | 「识别共顶点、底共线的等高结构并把面积比化成线段比」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A081 | TP-SMV-006 | CP7 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A082 | TP-SMV-006 | CP8 | 学生能用相似把 MH/GP 建立倍数关系并列一元方程。 | expected_checkpoint@CP8 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A083 | TP-SMV-006 | CP8 | 我可以用相似把 MH/GP 建立倍数关系并列一元方程。 | expected_checkpoint@CP8 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A084 | TP-SMV-006 | CP8 | 学生能用相似把 MH/GP 建立倍数关系并列一元方程。 | expected_checkpoint@CP8 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A085 | TP-SMV-006 | CP8 | 就是说，我可以用相似把 MH/GP 建立倍数关系并列一元方程。 | expected_checkpoint@CP8 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A086 | TP-SMV-006 | CP8 | 学生能用相似把 MH/GP 建立倍数关系并列一元方程。 | expected_checkpoint@CP8 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A087 | TP-SMV-006 | CP8 | 学生能用相似把 MH/GP 建立倍数关系并列一元方程。 | expected_checkpoint@CP8 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A088 | TP-SMV-006 | CP8 | 就是说那个……用相似把 MH/GP 建立倍数关系并列一元方程。，对吧 | expected_checkpoint@CP8 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A089 | TP-SMV-006 | CP8 | 学生能完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | cross-checkpoint-near |  | 候选集内相邻节点推理 |
| TP-SMV-006-A090 | TP-SMV-006 | CP8 | 「用相似把 MH/GP 建立倍数关系并列一元方程」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A091 | TP-SMV-006 | CP8 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A092 | TP-SMV-006 | CP9 | 学生能完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | verbatim |  | plan 原文（教师批准） |
| TP-SMV-006-A093 | TP-SMV-006 | CP9 | 我可以完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | paraphrase |  | 固定同义表 variant=0 |
| TP-SMV-006-A094 | TP-SMV-006 | CP9 | 学生能完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | paraphrase |  | 固定同义表 variant=1 |
| TP-SMV-006-A095 | TP-SMV-006 | CP9 | 就是说，我可以完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | paraphrase |  | 固定同义表 variant=2 |
| TP-SMV-006-A096 | TP-SMV-006 | CP9 | 学生能完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | asr-noise |  | ASR 错字表 variant=0 |
| TP-SMV-006-A097 | TP-SMV-006 | CP9 | 学生能完整分两类并把两解分别代回检验。 | expected_checkpoint@CP9 | asr-noise |  | ASR 错字表 variant=1 |
| TP-SMV-006-A098 | TP-SMV-006 | CP9 | 就是说那个……完整分两类并把两解分别代回检验。，对吧 | expected_checkpoint@CP9 | mixed |  | 填充语 + 期望推理（混合表述） |
| TP-SMV-006-A099 | TP-SMV-006 | CP9 | 漏掉 F 在延长线上的情形 | incorrect@CP9 | deviation |  | plan common_deviations 原文 |
| TP-SMV-006-A100 | TP-SMV-006 | CP9 | 「完整分两类并把两解分别代回检验」这个说法是错的 | unclear | negation | 是 | 已知反例形态：期望推理的否定（不得判 expected/alternate） |
| TP-SMV-006-A101 | TP-SMV-006 | CP9 | 我不想列这些东西，直接跳过 | unclear | refusal | 是 | 已知反例形态：拒绝表述（无数学主张） |
| TP-SMV-006-A102 | TP-SMV-006 | CP2 | 学生已能学生见到 sinB=4/5 能想到作高构造直角三角形。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-006-A103 | TP-SMV-006 | CP2 | 我已能学生见到 sinB=4/5 能想到作高构造直角三角形。，可直接跳过开场确认 | alternate_valid@R2 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-006-A104 | TP-SMV-006 | CP5 | 学生已能学生能把「已证等角」当作第二问的现成工具。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-006-A105 | TP-SMV-006 | CP5 | 我已能学生能把「已证等角」当作第二问的现成工具。，可直接跳过开场确认 | alternate_valid@R4 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-006-A106 | TP-SMV-006 | CP8 | 学生已能学生能把面积比转成同高线段比。，可直接跳过开场确认 | alternate_valid@R6 | alternate-route |  | alternate entry_condition 原文 |
| TP-SMV-006-A107 | TP-SMV-006 | CP8 | 我已能学生能把面积比转成同高线段比。，可直接跳过开场确认 | alternate_valid@R6 | alternate-route |  | alternate entry_condition 改写 |
| TP-SMV-006-A108 | TP-SMV-006 | CP1 | 嗯……我不太确定这一步该怎么下手 | unclear | vague |  | 含糊输入 1 |
| TP-SMV-006-A109 | TP-SMV-006 | CP1 | 感觉好像是要用相似，但说不清楚 | unclear | vague |  | 含糊输入 2 |
| TP-SMV-006-A110 | TP-SMV-006 | CP1 | 这个条件和那个条件，我也不知道怎么连起来 | unclear | vague |  | 含糊输入 3 |
| TP-SMV-006-A111 | TP-SMV-006 | CP1 | (空) | no_progress | silence |  | 空文本（no_progress 只来自确定性路径） |
