/**
 * mockBackend — in-memory backend that drives a sequence of engines.
 *
 * This is the POC's stand-in for the real backend (sessionRuntimeService +
 * EnginePlugin). It:
 *   - holds PRIVATE answerKeys (never serialized into the spec)
 *   - holds the authoritative backend WorldState
 *   - calls the current engine's reduce/commit/buildFlow
 *   - projects backend WorldState → scene entities (NO answerKey leaks)
 *   - returns real-shaped PocRuntimeSpec / RuntimeActionResponse
 *
 * The mock has NO per-engine business switch: it talks to every engine through
 * a uniform { init, reduce, commit, buildFlow } interface. Adding a third
 * engine requires no mock change.
 *
 * No React. No JSXGraph.
 */
import type {
  MathObject,
  PointObject,
  SegmentObject,
  WorldState,
} from "../domain/geometry.ts";
import type {
  PocSceneEntity,
  PocRuntimeSpec,
  RuntimeActionEvent,
  RuntimeActionResponse,
  ServerRuntimeState,
  SessionPhase,
} from "../shared/runtimeContracts.ts";
import {
  createMakeParallelEngine,
  type MakeParallelEngine,
  type MakeParallelState,
  type MakeParallelResult,
} from "./makeParallelEngine.ts";
import {
  createMarkSegmentValueEngine,
  type MarkSegmentValueEngine,
  type MarkSegmentValueState,
  type MarkSegmentValueResult,
} from "./markSegmentValueEngine.ts";

// --- the uniform engine interface the mock drives --------------------------
// A single type-erased shape covering both engines. The mock never branches on
// engine identity; it only calls these four methods.

type AnyEngineState = MakeParallelState | MarkSegmentValueState;
type AnyEngineResult = MakeParallelResult | MarkSegmentValueResult;

interface AnyEngine {
  readonly stepId: string;
  init(world: WorldState): AnyEngineState;
  reduce(
    state: AnyEngineState,
    action: RuntimeActionEvent,
    world: WorldState,
  ): {
    kind: "continue" | "reject" | "complete";
    state: AnyEngineState;
    message?: string;
    result?: AnyEngineResult;
  };
  commit(world: WorldState, result: AnyEngineResult): WorldState;
  buildFlow(state: AnyEngineState): PocRuntimeSpec["flow"];
}

function asAnyEngine(mp: MakeParallelEngine): AnyEngine {
  return mp as unknown as AnyEngine;
}
function asAnyEngine2(ms: MarkSegmentValueEngine): AnyEngine {
  return ms as unknown as AnyEngine;
}

// --- backend session state --------------------------------------------------

const VIEW_BOX = [-6, 6, 8, -4] as [number, number, number, number];

function initialWorld(): WorldState {
  return {
    objects: {
      A: { kind: "point", id: "A", x: 0, y: 4 },
      B: { kind: "point", id: "B", x: -4, y: -2 },
      C: { kind: "point", id: "C", x: -1, y: -2 },
      D: { kind: "point", id: "D", x: 3, y: 1 },
      E: { kind: "point", id: "E", x: 6, y: -3 },
      BC: { kind: "segment", id: "BC", endpoints: ["B", "C"] },
      DE: { kind: "segment", id: "DE", endpoints: ["D", "E"] },
    },
  };
}

export interface MockSession {
  engines: AnyEngine[];
  world: WorldState;
  actionIndex: number;
  actionStates: AnyEngineState[];
  completedStepIds: string[];
  attempts: number;
  lastFeedback?: { kind: "error" | "success" | "info"; message: string };
}

export function createMockSession(): MockSession {
  // The two engines + their PRIVATE answer keys. These objects are the only
  // place the answer truth exists; it is never copied into the spec.
  const makeParallel = createMakeParallelEngine(
    { through: "A", parallelTo: "BC", intersectionWith: "DE", intersectionPoint: "F" },
    { through: "A", parallelTo: "BC" }, // private answerKey
  );
  const markSegmentValue = createMarkSegmentValueEngine(
    { segment: "BC" },
    { expected: "3" }, // private answerKey
  );

  const engines: AnyEngine[] = [asAnyEngine(makeParallel), asAnyEngine2(markSegmentValue)];
  const world = initialWorld();
  const actionStates = engines.map((e) => e.init(world));

  return {
    engines,
    world,
    actionIndex: 0,
    actionStates,
    completedStepIds: [],
    attempts: 0,
  };
}

// --- the API surface (mirrors the real client.ts shape) ---------------------

export function startMockSession(): { session: MockSession; spec: PocRuntimeSpec } {
  const session = createMockSession();
  return { session, spec: buildSpec(session) };
}

/** Project the current session state to a spec (used by reset). */
export function buildSpecExternally(session: MockSession): PocRuntimeSpec {
  return buildSpec(session);
}

export function submitMockAction(
  session: MockSession,
  action: RuntimeActionEvent,
): RuntimeActionResponse {
  const engine = session.engines[session.actionIndex];
  if (!engine) {
    return {
      accepted: false,
      evaluation: "wrong",
      runtime: buildSpec(session),
      phase: "group_finished",
      nextIndex: session.actionIndex,
      finished: true,
    };
  }

  const state = session.actionStates[session.actionIndex];
  const transition = engine.reduce(state, action, session.world);
  session.attempts += 1;

  if (transition.kind === "continue") {
    session.actionStates[session.actionIndex] = transition.state;
    session.lastFeedback = { kind: "info", message: transition.message ?? "继续。" };
    return {
      accepted: true,
      evaluation: "progress",
      runtime: buildSpec(session),
      phase: "answering",
      nextIndex: session.actionIndex,
    };
  }

  if (transition.kind === "reject") {
    session.actionStates[session.actionIndex] = transition.state;
    session.lastFeedback = { kind: "error", message: transition.message ?? "错误。" };
    const runtimeState = buildRuntimeState(session, "wrong");
    return {
      accepted: false,
      evaluation: "wrong",
      runtime: { ...buildSpec(session), runtimeState },
      phase: "wrong_feedback",
      nextIndex: session.actionIndex,
    };
  }

  // complete -> commit, advance
  session.world = engine.commit(session.world, transition.result!);
  session.completedStepIds.push(engine.stepId);
  session.actionIndex += 1;
  const nextEngine = session.engines[session.actionIndex];
  const finished = !nextEngine;
  if (nextEngine) {
    session.actionStates[session.actionIndex] = nextEngine.init(session.world);
  }
  session.lastFeedback = finished
    ? { kind: "success", message: "全部完成！" }
    : { kind: "success", message: transition.message ?? "步骤完成，继续下一步。" };

  const phase: SessionPhase = finished ? "group_finished" : "correct_pause";
  const runtimeState = buildRuntimeState(session, "correct");
  return {
    accepted: true,
    evaluation: "correct",
    runtime: { ...buildSpec(session), runtimeState },
    phase,
    nextIndex: session.actionIndex,
    finished,
  };
}

// --- spec projection (backend WorldState → PocRuntimeSpec) ------------------
// CRITICAL: this must serialize only display data. The answerKey never appears.

function buildSpec(session: MockSession): PocRuntimeSpec {
  const engine = session.engines[session.actionIndex];
  const flow = engine ? engine.buildFlow(session.actionStates[session.actionIndex]) : {
    steps: [],
    currentStepId: "done",
    completionPolicy: "multi-step" as const,
  };

  return {
    instanceId: "poc-instance",
    taskId: "poc-geometry",
    prompt: "过 A 作 BC 的平行线，与 DE 相交于 F；然后标注 BC 的值。",
    scene: {
      sceneKind: "geometry",
      entities: worldToEntities(session.world),
      zones: buildZones(session),
      anchors: [],
      viewBox: VIEW_BOX,
    },
    flow,
    runtimeState: buildRuntimeState(session, "pending"),
    feedback: session.lastFeedback,
  };
}

/** Serialize backend MathObjects into PocSceneEntities. No answerKey. */
function worldToEntities(world: WorldState): PocSceneEntity[] {
  const entities: PocSceneEntity[] = [];
  for (const obj of Object.values(world.objects)) {
    entities.push(mathObjectToEntity(obj));
  }
  return entities;
}

function mathObjectToEntity(obj: MathObject): PocSceneEntity {
  switch (obj.kind) {
    case "point":
      return { kind: "vertex", id: obj.id, x: obj.x, y: obj.y, label: obj.id };
    case "segment":
      return { kind: "edge", id: obj.id, from: obj.endpoints[0], to: obj.endpoints[1] };
    case "parallel-line":
      return { kind: "parallel-line", id: obj.id, through: obj.through, parallelTo: obj.parallelTo };
    case "intersection":
      return { kind: "intersection", id: obj.id, of: obj.of };
    case "segment-value":
      return { kind: "segment-value", id: obj.id, segment: obj.segment, value: obj.value };
    default:
      // exhaustiveness
      return obj as never;
  }
}

function buildZones(session: MockSession): PocRuntimeSpec["scene"]["zones"] {
  if (session.actionIndex >= session.engines.length) return [];
  const engine = session.engines[session.actionIndex];
  const state = session.actionStates[session.actionIndex];
  const flow = engine.buildFlow(state);
  const activeStep = flow.steps.find((s) => s.status === "active");
  if (!activeStep) return [];

  const zones = [];
  for (const a of activeStep.allowedActions) {
    if (a.type === "select" && a.target) {
      // Determine if target is a point or segment by inspecting the world.
      const world = session.world;
      const obj = world.objects[a.target];
      if (!obj) continue;
      if (obj.kind === "point") {
        zones.push({ id: `zone-${a.target}`, zoneKind: "vertex" as const, targetRef: a.target, accepts: ["select" as const] });
      } else if (obj.kind === "segment") {
        zones.push({ id: `zone-${a.target}`, zoneKind: "edge" as const, targetRef: a.target, accepts: ["select" as const] });
      }
    }
  }
  return zones;
}

function buildRuntimeState(session: MockSession, status: ServerRuntimeState["problemStatus"]): ServerRuntimeState {
  const engine = session.engines[session.actionIndex];
  return {
    phase: session.actionIndex >= session.engines.length ? "group_finished" : "answering",
    currentStepId: engine ? engine.stepId : "done",
    completedStepIds: [...session.completedStepIds],
    problemStatus: status,
    attempts: session.attempts,
  };
}
