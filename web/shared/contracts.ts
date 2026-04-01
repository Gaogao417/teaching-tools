export type TaskId = "meaning" | "ratioToSide" | "guidedSolve";

export type SessionPhase =
  | "answering"
  | "correct_pause"
  | "wrong_feedback"
  | "group_finished";

export type ProblemStatus = "pending" | "correct" | "wrong";

export type TrigFunction = "sin" | "cos" | "tan" | "cot";
export type Angle = "A" | "C";
export type Role = "opposite" | "adjacent" | "hypotenuse";
export type Side = "AB" | "BC" | "AC";
export type GuidedStepKey = "mark" | "ratio" | "third" | "final";

export interface TaskTreeResponse {
  grades: GradeNode[];
}

export interface GradeNode {
  id: string;
  name: string;
  chapters: ChapterNode[];
}

export interface ChapterNode {
  id: string;
  name: string;
  tasks: TaskNode[];
}

export interface TaskNode {
  id: TaskId;
  title: string;
  summary: string;
  difficulty: "easy" | "medium" | "hard";
  sample: {
    prompt: string;
    answerPreview?: string;
  };
  steps: string[];
  color?: string;
}

export interface TaskHistoryItem {
  studentName: string;
  elapsedMs: number;
  clearedAt: string;
  problemCount: number;
  firstTryAccuracy: number;
}

export interface TaskHistoryResponse {
  taskId: TaskId;
  studentName: string;
  items: TaskHistoryItem[];
}

export interface BaseProblem {
  id: string;
  taskId: TaskId;
  type: TaskId;
  index: number;
  status: ProblemStatus;
  attempts: number;
  firstTryCorrect: boolean | null;
}

export interface MeaningProblem extends BaseProblem {
  type: "meaning";
  prompt: string;
  target: TrigFunction;
  referenceAngle: Angle;
  ui: {
    numeratorLabel: string;
    denominatorLabel: string;
    selectableRoles: Role[];
  };
}

export interface RatioToSideProblem extends BaseProblem {
  type: "ratioToSide";
  prompt: string;
  target: TrigFunction;
  referenceAngle: Angle;
  ratio: {
    numerator: string;
    denominator: string;
  };
  ui: {
    edges: Side[];
  };
}

export interface GuidedSolveProblem extends BaseProblem {
  type: "guidedSolve";
  prompt: string;
  target: TrigFunction;
  referenceAngle: Angle;
  knownType: TrigFunction;
  given: Array<{
    edge: Side;
    value: string;
    role: Role;
  }>;
  stepKeys: GuidedStepKey[];
  stepState: Record<
    GuidedStepKey,
    {
      done: boolean;
      value: string;
    }
  >;
}

export type Problem = MeaningProblem | RatioToSideProblem | GuidedSolveProblem;

export interface MeaningAnswerPayload {
  type: "meaning";
  numeratorRole: Role;
  denominatorRole: Role;
}

export interface RatioToSideAnswerPayload {
  type: "ratioToSide";
  placements: Partial<Record<Side, string>>;
}

export interface GuidedSolveAnswerPayload {
  type: "guidedSolve";
  stepKey: GuidedStepKey;
  value: Record<string, string>;
}

export type AnswerPayload =
  | MeaningAnswerPayload
  | RatioToSideAnswerPayload
  | GuidedSolveAnswerPayload;

export interface StartPracticeRequest {
  taskId: TaskId;
  studentName: string;
}

export interface StartPracticeResponse {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  problems: Problem[];
  startedAt: string;
}

export interface AnswerRequest {
  sessionId: string;
  problemId: string;
  payload: AnswerPayload;
}

export interface AnswerResponse {
  correct: boolean;
  allSolved: boolean;
  hint?: string;
  problemState: Problem;
  nextIndex: number;
  phase: SessionPhase;
}

export interface RestorePracticeResponse {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  currentIndex: number;
  problems: Problem[];
  elapsedMs: number;
  phase: SessionPhase;
}

export interface ResultSnapshot {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  startedAt: string;
  clearedAt: string;
  title: string;
  groupLabel: string;
  elapsedMs: number;
  bestMs: number | null;
  avgMs: number | null;
  copy: string;
  problemCount: number;
  firstTryAccuracy: number;
  firstTryCorrectCount: number;
  color: string;
  deltaVsPreviousMs: number | null;
  history: Array<{
    elapsedMs: number;
    clearedAt: string;
  }>;
}

export interface FinishPracticeRequest {
  sessionId: string;
}

export interface FinishPracticeResponse {
  sessionId: string;
  resultSnapshot: ResultSnapshot;
  alreadyFinished?: boolean;
}

export interface ApiErrorResponse {
  error: {
    code:
      | "BAD_REQUEST"
      | "INVALID_STUDENT_NAME"
      | "TASK_NOT_FOUND"
      | "SESSION_NOT_FOUND"
      | "SESSION_FINISHED"
      | "PROBLEM_NOT_FOUND"
      | "ANSWER_INVALID"
      | "INTERNAL_ERROR";
    message: string;
  };
}
