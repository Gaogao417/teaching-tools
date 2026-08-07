import type { ExerciseEngineKind, TaskId } from "./contracts";

export type ScenarioStatus = "draft" | "validated" | "approved" | "rejected";
export type ScenarioSource =
  | "manual"
  | "python-generator"
  | "ai-assisted"
  | "reviewed-bank-import";

export type ScenarioValidationKind = "schema" | "domain" | "asset" | "mathematical";
export type ScenarioValidationLayer = "schema" | "deterministic" | "wolfram";

/** Offline-authored problem data. Runtime/UI projection remains an engine responsibility. */
export interface ScenarioRecord {
  id: string;
  taskId: TaskId;
  engineKind: ExerciseEngineKind;
  contentId: string;
  version: string;
  status: ScenarioStatus;
  promptData: Record<string, unknown>;
  answerKey: Record<string, unknown>;
  createdAt: string;
  approvedAt?: string;
  metadata: {
    source: ScenarioSource;
    authoringRunId: string;
    assignments: string[];
    difficulty?: string;
    tags?: string[];
  };
}

export interface ScenarioValidationReport {
  schema?: "teaching-tools/scenario-validation-report/v1";
  id: string;
  scenarioId: string;
  scenarioVersion: string;
  authoringRunId: string;
  passed: boolean;
  checks: Array<{
    name: string;
    kind: ScenarioValidationKind;
    /** Compatibility with the authoring CLI's execution-layer vocabulary. */
    layer?: ScenarioValidationLayer;
    passed: boolean;
    message?: string;
    evidence?: Record<string, unknown>;
  }>;
  wolframSummary?: string;
  createdAt: string;
}

export interface AuthoringRun {
  schema?: "teaching-tools/authoring-run/v1";
  id: string;
  status: "running" | "completed" | "failed";
  taskIds: TaskId[];
  startedAt: string;
  finishedAt?: string;
  toolchainVersion: string;
  inputSpecVersion: string;
  counts: {
    candidate: number;
    validated: number;
    approved: number;
    rejected: number;
  };
  /** Authoring-schema compatibility and immutable publication audit data. */
  outputCount?: number;
  scenarioIds?: string[];
  errorSummary?: string;
}
