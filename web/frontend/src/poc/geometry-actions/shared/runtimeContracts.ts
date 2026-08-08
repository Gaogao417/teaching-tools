/**
 * POC runtime contracts — shape-compatible with web/shared/contracts.ts but
 * minimal, POC-scoped, and extended for derived geometry.
 *
 * Why a local spec type instead of importing web/shared/contracts.ts directly?
 *   1. The real ExerciseRuntimeSpec couples to remediation/challenge/topic-
 *      practice types the POC doesn't need.
 *   2. The real SceneEntity union has no way to express "a line through A
 *      parallel to BC" or "the intersection of two lines". The POC needs these
 *      to carry derived MathObjects from backend to frontend. We extend the
 *      entity union here rather than pollute web/shared/contracts.ts.
 *   3. The POC needs a board viewBox on the scene so createBoard isn't
 *      hardcoded; the real SceneSpec doesn't carry that.
 *
 * The field names and shapes mirror the real contract's core so that swapping
 * the mock for the real backend later is a mechanical change.
 */

// --- coordinate + enum aliases (mirror web/shared/contracts.ts) -------------

export interface XYPoint {
  x: number;
  y: number;
}

export type RuntimeActionType =
  | "select"
  | "input"
  | "assign"
  | "compose"
  | "clear"
  | "submit";

export type SessionPhase =
  | "answering"
  | "correct_pause"
  | "wrong_feedback"
  | "group_finished";

export type ProblemStatus = "pending" | "correct" | "wrong";
export type RuntimeStepStatus = "locked" | "active" | "done";
export type RuntimeEvaluation = "correct" | "wrong" | "progress";

// --- scene entities ---------------------------------------------------------
// Standard entities (subset of the real SceneEntity union the POC uses).

export interface VertexSceneEntity {
  kind: "vertex";
  id: string;
  x: number;
  y: number;
  label?: string;
}

export interface EdgeSceneEntity {
  kind: "edge";
  id: string;
  from: string;
  to: string;
  label?: string;
  role?: string;
}

// POC-only derived entities (NOT in the real contract). These express geometry
// the standard SceneEntity union cannot. See file header for rationale.

export interface ParallelLineSceneEntity {
  kind: "parallel-line";
  id: string;
  through: string; // PointId
  parallelTo: string; // SegmentId
}

export interface IntersectionSceneEntity {
  kind: "intersection";
  id: string;
  of: [string, string]; // [LineId, SegmentId]
}

export interface SegmentValueSceneEntity {
  kind: "segment-value";
  id: string;
  segment: string; // SegmentId
  value: string;
}

export type PocSceneEntity =
  | VertexSceneEntity
  | EdgeSceneEntity
  | ParallelLineSceneEntity
  | IntersectionSceneEntity
  | SegmentValueSceneEntity;

// --- zones / anchors (mirror real contract, POC subset) ---------------------

export interface InteractionZone {
  id: string;
  zoneKind: "edge" | "vertex" | "region" | "slot" | "input";
  targetRef: string;
  accepts?: RuntimeActionType[];
}

export interface SceneAnchor {
  id: string;
  anchorKind: "value-input" | "label" | "formula-slot" | "badge";
  entityRef?: string;
  x?: number;
  y?: number;
  placeholder?: string;
  value?: string;
  label?: string;
}

export interface PocSceneSpec {
  sceneKind: string;
  entities: PocSceneEntity[];
  zones: InteractionZone[];
  anchors: SceneAnchor[];
  /** Board view box [x1, y1, x2, y2]; drives createBoard instead of hardcoding. */
  viewBox?: [number, number, number, number];
}

// --- flow / actions (mirror real contract) ----------------------------------

export interface ActionSpec {
  type: RuntimeActionType;
  target?: string;
  stepId?: string;
  selectionKind?: "single" | "ordered";
  valueKind?: "text" | "integer" | "length" | "ratio-part";
}

export interface FlowStep {
  id: string;
  title: string;
  goal: string;
  status: RuntimeStepStatus;
  allowedActions: ActionSpec[];
  submitMode: "immediate" | "explicit";
}

export interface FlowSpec {
  steps: FlowStep[];
  currentStepId: string;
  completionPolicy: "single-step" | "multi-step" | "whole-problem";
}

// --- runtime spec (the shape the mock backend produces) ---------------------

export interface ServerRuntimeState {
  phase: SessionPhase;
  currentStepId: string;
  completedStepIds: string[];
  problemStatus: ProblemStatus;
  attempts: number;
  wrongObjectIds?: string[];
}

/**
 * POC runtime spec. Structurally like ExerciseRuntimeSpec but with the POC
 * scene (derived entities + viewBox). The mock backend produces this; the
 * projector consumes it.
 */
export interface PocRuntimeSpec {
  instanceId: string;
  taskId: string;
  prompt: string;
  scene: PocSceneSpec;
  flow: FlowSpec;
  runtimeState: ServerRuntimeState;
  /** Most recent feedback message (display-only, never the answer). */
  feedback?: { kind: "error" | "success" | "info"; message: string };
}

// --- action envelope (what the frontend submits) ----------------------------

export interface RuntimeActionEvent {
  type: RuntimeActionType;
  targetId?: string;
  value?: string;
  sourceId?: string;
  stepId?: string;
}

export interface RuntimeActionResponse {
  accepted: boolean;
  evaluation: RuntimeEvaluation;
  runtime: PocRuntimeSpec;
  phase: SessionPhase;
  nextIndex: number;
  finished?: boolean;
}
