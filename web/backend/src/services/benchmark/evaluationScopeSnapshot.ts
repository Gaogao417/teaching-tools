/**
 * evaluation-scope.yaml 的 src 侧快照（P1-10）。
 *
 * 来源：PRD 仓 migration/manifests/evaluation-scope.yaml（frozen 2026-08-18）。
 * 该 manifest 冻结 20-case 分布与两个 SUT；本文件是它的最小可编译摘要，
 * 供 benchmark skeleton runner 在不解析 YAML 的情况下使用。
 * 重新生成：tsx scripts/write-benchmark-run-skeleton.ts --print-scope-snapshot
 * （或手动同步；case_id/stage 必须逐条一致）。
 */

export interface EvaluationScopeSummary {
  datasetId: string;
  datasetVersion: string;
  suts: string[];
  cases: Array<{ case_id: string; stage: "intake" | "truth" | "approach" | "plan" | "realtime" }>;
}

export const evaluationScopeSnapshot: EvaluationScopeSummary = {
  datasetId: "similarity-mvp-benchmark-v1",
  datasetVersion: "v1",
  suts: ["sut-a-claudecode-glm52-qwen", "sut-b-deepseek-direct-mimo"],
  cases: [
    { case_id: "C-INT-01", stage: "intake" },
    { case_id: "C-INT-02", stage: "intake" },
    { case_id: "C-INT-03", stage: "intake" },
    { case_id: "C-INT-04", stage: "intake" },
    { case_id: "C-TRU-01", stage: "truth" },
    { case_id: "C-TRU-02", stage: "truth" },
    { case_id: "C-TRU-03", stage: "truth" },
    { case_id: "C-TRU-04", stage: "truth" },
    { case_id: "C-APP-01", stage: "approach" },
    { case_id: "C-APP-02", stage: "approach" },
    { case_id: "C-APP-03", stage: "approach" },
    { case_id: "C-APP-04", stage: "approach" },
    { case_id: "C-PLN-01", stage: "plan" },
    { case_id: "C-PLN-02", stage: "plan" },
    { case_id: "C-PLN-03", stage: "plan" },
    { case_id: "C-RT-01", stage: "realtime" },
    { case_id: "C-RT-02", stage: "realtime" },
    { case_id: "C-RT-03", stage: "realtime" },
    { case_id: "C-RT-04", stage: "realtime" },
    { case_id: "C-RT-05", stage: "realtime" },
  ],
};

export const CASE_DISTRIBUTION: Record<EvaluationScopeSummary["cases"][number]["stage"], number> = {
  intake: 4,
  truth: 4,
  approach: 4,
  plan: 3,
  realtime: 5,
};
