import type { Dispatch, MutableRefObject, ReactElement, SetStateAction } from "react";
import type { ClientDraftState, ExerciseEngineKind, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { AngleEquationWorkspaceRenderer } from "../../../components/exercises/angleEquation/AngleEquationWorkspace";
import { CoordIsoscelesRightWorkspaceRenderer } from "../../../components/exercises/coordinateIsoscelesRight/CoordIsoscelesRightWorkspace";
import { DemoCounterWorkspaceRenderer } from "./DemoCounterWorkspace";
import { TriangleTrigWorkspaceRenderer } from "./WorkspaceScene";

export type WorkspaceRendererProps = {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
};

export const WORKSPACE_RENDERERS = {
  "triangle-trig": TriangleTrigWorkspaceRenderer,
  "demo-counter": DemoCounterWorkspaceRenderer,
  "angle-equation": AngleEquationWorkspaceRenderer,
  "coordinate-isosceles-right": CoordIsoscelesRightWorkspaceRenderer,
} satisfies Record<ExerciseEngineKind, (props: WorkspaceRendererProps) => ReactElement>;
