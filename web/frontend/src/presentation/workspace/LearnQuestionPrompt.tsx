/**
 * LearnQuestionPrompt —— Learn Question 的唯一 canonical 渲染
 *（VS1 remediation，2026-08-26 验收裁定）。
 *
 * 题目主 stems 与全部 subquestions 一体化呈现在 FocusWorkspace 的
 * FocusPrompt 槽（region-question）内——subquestions 不得进入 canvas
 * 区域形成额外布局行。每问显示由 `part_id` 派生的编号（（1）（2）…），
 * 并携带稳定 identity（data-part-id）与 accessible label（第 N 问）；
 * 顺序与 response 的 subquestions 顺序一致。
 */
import { MathText } from "../../components/math/MathText";

export interface LearnSubquestion {
  part_id: string;
  prompt: string;
}

export interface LearnQuestionPromptProps {
  stem?: string;
  subquestions?: LearnSubquestion[];
}

export function LearnQuestionPrompt({ stem, subquestions }: LearnQuestionPromptProps) {
  return (
    <>
      <span>题目</span>
      <div className="learn-question-body">
        <h1><MathText value={stem ?? ""} /></h1>
        {subquestions?.length ? (
          <ol className="learn-question-subquestions" aria-label="小问">
            {subquestions.map((subquestion) => (
              <li
                key={subquestion.part_id}
                data-part-id={subquestion.part_id}
                aria-label={`第 ${subquestion.part_id} 问`}
              >
                <span className="learn-question-part-number" aria-hidden="true">（{subquestion.part_id}）</span>
                <MathText value={subquestion.prompt} />
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </>
  );
}
