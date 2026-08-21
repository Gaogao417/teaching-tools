/**
 * VoiceAction 合同（Phase 5 / P5-09，PRD 04 §2.4）。
 *
 * Voice 是 Tutor 的语言呈现通道：说什么（text）、是否允许被打断
 * （interruptible）。voice 文本只能来自两类来源：
 * 1. Approved Plan 资源原文（explain/hint/repair/probe——已在 materializer
 *    泄漏门禁过审）；
 * 2. 固定教学脚手架句（prompt/confirm——不含任何数学内容与答案值，
 *    presenter 侧另有泄漏自查兜底）。
 *
 * canonical 事件 voice_action_issued payload 是 strict 四字段；
 * resource_id 只留在进程内呈现计划，用于审计，不进事件。
 */
import type { VoiceOutcome } from "../tutorSession/TutorSessionEvent";

export interface VoiceActionPlan {
  action_id: string;
  decision_id: string;
  text: string;
  interruptible: boolean;
  /** 进程内审计：voice 文本来源资源（canonocal 事件不含此字段）。 */
  resource_id?: string;
}

export interface VoiceCompletion {
  action_id: string;
  outcome: VoiceOutcome;
  failure_class?: string;
  message?: string;
}

/**
 * 教学脚手架句（2026-08-21 教师裁定的同一边界：不包装资源内容本体）。
 * 这些句子不承载数学内容，仅做元认知引导/确认——与 hint 引导词禁令一致，
 * prompt/confirm 也只用最小脚手架，不包裹、不改写 plan 资源原文。
 */
export const VOICE_SCAFFOLDS: Readonly<Record<string, string>> = {
  "prompt.clarify": "能再说具体一点吗？这一步你是怎么想的？",
  "prompt.self_check": "这一步先自己检查一下：哪里可能不对？",
  "prompt.hand_over": "好，思路交给你，这一步你来推进。",
  "prompt.reengage": "还在想吗？说说你目前的思路。",
  "prompt.resume_checkpoint": "我们回到刚才这一步，你继续。",
  "prompt.verify_after_question": "刚才的问题想清楚了吗？这一步你再说说看。",
  "prompt.verbalize_pointing": "你指的是哪个对象？用语言描述一下。",
  "prompt.action_step": "这一步交给你操作：在右侧完成它。",
  "prompt.generic": "这一步你怎么考虑？",
  "confirm.progress": "对，这一步成立。继续。",
  "confirm.assisted_progress": "好，借助提示过来了。下一步自己试试。",
  "confirm.alternate_path": "可以，你这条路线也成立，就按你的走。",
  "confirm.repair_complete": "这次对了。回到原步骤，继续。",
  "confirm.generic": "对，成立。继续。",
};
