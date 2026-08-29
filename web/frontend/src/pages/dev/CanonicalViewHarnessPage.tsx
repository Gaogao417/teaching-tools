/**
 * FE 准备轨 canonical view harness 页（2026-08-28，fe-prep）。
 *
 * - dev/test-only：以 G1 冻结的 view/v1 canonical fixtures 自驱动
 *   （`web/shared/canonical/fixtures/` 只读 glob），渲染 canonical renderer；
 *   不访问任何后端、不进入 `/learn/:taskId` 数据流——F6 真实链接入前，
 *   本页**不构成任何"集成完成"的证据**（计划 §4）。
 * - URL：`/__fe-prep__/canonical-view?workspace=<fixture>&coach=<fixture>&participation=<fixture>`
 *   （fixture 名不含 .json；缺省项渲染占位）。
 * - 一切 fixture 输入先经 fail-closed parse（CanonicalViewGuard）：负例在
 *   渲染层被拒绝为 region-error，payload 文本零回显。
 * - 同 session 同 revision 投影检查（ADR-010 不变量 4 的渲染层防线，
 *   2026-08-29 复验修复 P2）：workspace 与 coach 同时存在且 session_id 或
 *   revision 任一不一致 → region-error，且 **两个 surface 均不渲染**
 *  （fail closed：mismatch 的投影不得部分组合呈现）。
 * - F6/F7 接线后本路由应删除或改为内部诊断页（对接面见 fe-prep exit
 *   report）。
 */
import { useSearchParams } from "react-router-dom";

import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { CanonicalViewGuard } from "../../presentation/canonicalView/CanonicalViewGuard";
import { CoachPanelViewSurface } from "../../presentation/canonicalView/CoachPanelViewSurface";
import { MainlineParticipationSurface } from "../../presentation/canonicalView/MainlineParticipationSurface";
import { StudentWorkspaceViewSurface } from "../../presentation/canonicalView/StudentWorkspaceViewSurface";
import { parseCoachPanelView, parseMainlineParticipation, parseStudentWorkspaceView } from "../../presentation/canonicalView/parseCanonicalView";
import { checkProjectionRevisionConsistency } from "../../presentation/canonicalView/projectionRevisionConsistency";
import { LearnQuestionPrompt } from "../../presentation/workspace/LearnQuestionPrompt";

const VIEW_FIXTURES: Record<string, unknown> = {
  ...import.meta.glob("../../../../shared/canonical/fixtures/student-workspace-view.*.json", { eager: true, import: "default" }),
  ...import.meta.glob("../../../../shared/canonical/fixtures/coach-panel-view.*.json", { eager: true, import: "default" }),
  ...import.meta.glob("../../../../shared/canonical/fixtures/mainline-participation.*.json", { eager: true, import: "default" }),
};

const FIXTURE_NAMES: readonly string[] = Object.keys(VIEW_FIXTURES)
  .map((key) => key.split("/").pop()!.replace(/\.json$/, ""))
  .sort();

function loadFixture(name: string | null): unknown {
  if (!name) return null;
  const entry = Object.entries(VIEW_FIXTURES).find(([key]) => key.endsWith(`/${name}.json`));
  return entry ? structuredClone(entry[1]) : { __missing_fixture__: name };
}

export function CanonicalViewHarnessPage() {
  const [params] = useSearchParams();
  const workspaceResult = params.has("workspace") ? parseStudentWorkspaceView(loadFixture(params.get("workspace"))) : null;
  const coachResult = params.has("coach") ? parseCoachPanelView(loadFixture(params.get("coach"))) : null;
  const standaloneParticipationResult = params.has("participation")
    ? parseMainlineParticipation(loadFixture(params.get("participation")))
    : null;

  const workspaceParsed = workspaceResult !== null && workspaceResult.ok ? workspaceResult : null;
  const projectionMismatch =
    checkProjectionRevisionConsistency(
      workspaceParsed ? { session_id: workspaceParsed.view.session_id, revision: workspaceParsed.view.revision } : null,
      coachResult && coachResult.ok ? { session_id: coachResult.view.session_id, revision: coachResult.view.revision } : null,
    ) === false;
  let participationNode;
  if (standaloneParticipationResult) {
    participationNode = (
      <CanonicalViewGuard scope="mainline-participation" result={standaloneParticipationResult}>
        {(participation) => <MainlineParticipationSurface participation={participation} />}
      </CanonicalViewGuard>
    );
  } else if (workspaceParsed) {
    participationNode = <MainlineParticipationSurface participation={workspaceParsed.view.participation} />;
  } else if (workspaceResult) {
    participationNode = <p className="canonical-harness-placeholder">workspace 视图校验失败，无 participation 可投影。</p>;
  } else {
    participationNode = <p className="canonical-harness-placeholder">未选择 participation 输入（workspace 正例的内嵌 participation 自动生效）。</p>;
  }

  return (
    <main className="ks-focus-page canonical-view-harness-page" data-testid="canonical-view-harness">
      <header className="canonical-view-harness-header">
        <h1>FE 准备轨 · canonical view/v1 harness（未集成）</h1>
        <p>
          fixtures 驱动的 canonical renderer 冒烟页：不接真实后端 response，不进入 /learn/:taskId 数据流；
          F6 真实链接入前不得视为集成完成。
        </p>
        <nav aria-label="fixtures">
          <ul>
            {FIXTURE_NAMES.map((name) => (
              <li key={name}>
                <a href={`?workspace=${name}`}>{name}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {projectionMismatch ? (
        <section
          className="canonical-view-guard"
          role="alert"
          aria-label="视图校验失败"
          data-testid="region-error"
          data-guard-scope="projection-consistency"
        >
          <p>StudentWorkspaceView 与 CoachPanelView 的 session_id/revision 不一致——两投影必须来自同一 session 的同一 revision，已停止组合渲染（fail closed）。</p>
          <p>内容不可用时显示此提示，不展示未经组合校验的内容。</p>
        </section>
      ) : (
        <FocusWorkspace
          ariaLabel="canonical view harness"
          prompt={
            <div className="canonical-harness-question">
              <LearnQuestionPrompt
                stem="（harness 占位题目）view/v1 不含题面合同：Learn Question 由任务数据提供"
                subquestions={[{ part_id: "1", prompt: "（harness 占位）小问内容不属 view/v1；当前教学关注点见右侧 Coach Panel。" }]}
              />
            </div>
          }
          rail={
            coachResult ? (
              <CanonicalViewGuard scope="coach-panel-view" result={coachResult}>
                {(view) => <CoachPanelViewSurface view={view} />}
              </CanonicalViewGuard>
            ) : (
              <p className="canonical-harness-placeholder">未选择 coach-panel-view fixture。</p>
            )
          }
          actionEnd={<div className="action-row tutor-participation-row">{participationNode}</div>}
        >
          {workspaceResult ? (
            <CanonicalViewGuard scope="student-workspace-view" result={workspaceResult}>
              {(view) => <StudentWorkspaceViewSurface view={view} />}
            </CanonicalViewGuard>
          ) : (
            <p className="canonical-harness-placeholder">未选择 student-workspace-view fixture。</p>
          )}
        </FocusWorkspace>
      )}
    </main>
  );
}
