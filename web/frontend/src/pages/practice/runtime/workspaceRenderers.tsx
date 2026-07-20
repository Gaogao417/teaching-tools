import type { Dispatch, MutableRefObject, ReactElement, SetStateAction } from "react";
import type { ClientDraftState, ExerciseEngineKind, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { AngleEquationWorkspaceRenderer } from "../../../components/exercises/angleEquation/AngleEquationWorkspace";
import { BuoyancyForceAnalysisWorkspaceRenderer } from "../../../components/exercises/buoyancyForceAnalysis/BuoyancyForceAnalysisWorkspace";
import { CoordIsoscelesRightWorkspaceRenderer } from "../../../components/exercises/coordinateIsoscelesRight/CoordIsoscelesRightWorkspace";
import { TopicPracticeWorkspaceRenderer } from "../../../components/exercises/topicPractice/TopicPracticeWorkspace";
import { DemoCounterWorkspaceRenderer } from "./DemoCounterWorkspace";
import { TriangleTrigWorkspaceRenderer } from "./WorkspaceScene";

export type WorkspaceRendererProps = {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
  readOnly?: boolean;
};

export const WORKSPACE_RENDERERS = {
  "triangle-trig": TriangleTrigWorkspaceRenderer,
  "demo-counter": DemoCounterWorkspaceRenderer,
  "angle-equation": AngleEquationWorkspaceRenderer,
  "coordinate-isosceles-right": CoordIsoscelesRightWorkspaceRenderer,
  "buoyancy-force-analysis": BuoyancyForceAnalysisWorkspaceRenderer,
  "topic-practice": TopicPracticeWorkspaceRenderer,
} satisfies Record<ExerciseEngineKind, (props: WorkspaceRendererProps) => ReactElement>;
