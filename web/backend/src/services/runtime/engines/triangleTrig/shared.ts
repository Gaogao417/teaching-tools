import type { InteractionZone, RuntimeActionEvent, XYPoint } from "../../../../../../shared/contracts";
import type { Angle, GuidedStepKey, Role, Side, TrigFunction } from "../../../../../../shared/triangleTrig";
import { appError } from "../../platform/errors";
import type { GuidedEngineState, LengthValue, RuntimeDraftPayload, TriangleTrigEngineState } from "./types";

export const ACUTE_ANGLES: Angle[] = ["A", "C"];
export const TRIGS: TrigFunction[] = ["sin", "cos", "tan", "cot"];

export const ROLE_BY_TRIG: Record<TrigFunction, [Role, Role]> = {
  sin: ["opposite", "hypotenuse"],
  cos: ["adjacent", "hypotenuse"],
  tan: ["opposite", "adjacent"],
  cot: ["adjacent", "opposite"],
};

export function makeLength(n: number, s = 1): LengthValue {
  return { n, s };
}

export const TRIPLE_BANK: Array<Record<Side, LengthValue>> = [
  { AB: makeLength(3), BC: makeLength(4), AC: makeLength(5) },
  { AB: makeLength(5), BC: makeLength(12), AC: makeLength(13) },
  { AB: makeLength(7), BC: makeLength(24), AC: makeLength(25) },
  { AB: makeLength(1), BC: makeLength(1, 3), AC: makeLength(2) },
  { AB: makeLength(1), BC: makeLength(1), AC: makeLength(1, 2) },
  { AB: makeLength(1), BC: makeLength(2), AC: makeLength(1, 5) },
  { AB: makeLength(1), BC: makeLength(3), AC: makeLength(1, 10) },
  { AB: makeLength(1), BC: makeLength(2, 2), AC: makeLength(3) },
];

export const VERTICES = {
  A: { x: 90, y: 288 },
  B: { x: 320, y: 288 },
  C: { x: 320, y: 110 },
} satisfies Record<"A" | "B" | "C", XYPoint>;

export const SIDE_POINTS: Record<
  Side,
  {
    label: XYPoint;
    input: XYPoint;
    hitZone: InteractionZone["shape"];
  }
> = {
  AB: {
    label: { x: 205, y: 316 },
    input: { x: 205, y: 255 },
    hitZone: { type: "lineCorridor", from: "vertex-A", to: "vertex-B", width: 30 },
  },
  BC: {
    label: { x: 348, y: 205 },
    input: { x: 350, y: 205 },
    hitZone: { type: "lineCorridor", from: "vertex-B", to: "vertex-C", width: 30 },
  },
  AC: {
    label: { x: 194, y: 122 },
    input: { x: 200, y: 150 },
    hitZone: {
      type: "polygon",
      points: [
        { x: 82, y: 302 },
        { x: 104, y: 322 },
        { x: 336, y: 124 },
        { x: 314, y: 96 },
      ],
    },
  },
};

export function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function formatLength(len: LengthValue): string {
  if (len.s === 1) return String(len.n);
  if (len.n === 1) return `sqrt(${len.s})`;
  return `${len.n}sqrt(${len.s})`;
}

function lengthValue(len: LengthValue): number {
  return len.n * Math.sqrt(len.s);
}

export function parseLengthInput(str: string): LengthValue | null {
  const value = str.trim().replace(/\s+/g, "");
  const unicodeSqrtMatch = value.match(/^(\d*)√\(?(\d+)\)?$/);
  if (unicodeSqrtMatch) {
    return makeLength(unicodeSqrtMatch[1] ? Number(unicodeSqrtMatch[1]) : 1, Number(unicodeSqrtMatch[2]));
  }
  const sqrtMatch = value.match(/^(\d*)sqrt\s*\(?(\d+)\)?$/i);
  if (sqrtMatch) {
    return makeLength(sqrtMatch[1] ? Number(sqrtMatch[1]) : 1, Number(sqrtMatch[2]));
  }
  const num = Number(value);
  if (!Number.isNaN(num)) {
    return makeLength(Math.round(num), 1);
  }
  return null;
}

export function lengthsEqual(a: LengthValue, b: LengthValue): boolean {
  return Math.abs(lengthValue(a) - lengthValue(b)) < 0.0001;
}

export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? "");
}

export function getRoleSideMap(referenceAngle: Angle): Record<Role, Side> {
  if (referenceAngle === "C") {
    return { opposite: "AB", adjacent: "BC", hypotenuse: "AC" };
  }
  return { opposite: "BC", adjacent: "AB", hypotenuse: "AC" };
}

export function sideForRole(referenceAngle: Angle, role: Role): Side {
  return getRoleSideMap(referenceAngle)[role];
}

export function roleForSide(referenceAngle: Angle, side: Side): Role {
  const mapping = getRoleSideMap(referenceAngle);
  return ((Object.keys(mapping) as Role[]).find((role) => mapping[role] === side) || "hypotenuse") as Role;
}

export function guidedCurrentStep(state: GuidedEngineState): GuidedStepKey {
  return (["ratio", "third", "final"] as const).find((key) => !state.stepState[key].done) || "final";
}

export function cloneTriangleTrigState(state: TriangleTrigEngineState): TriangleTrigEngineState {
  return JSON.parse(JSON.stringify(state)) as TriangleTrigEngineState;
}

export function parseDraftPayload(action: RuntimeActionEvent): RuntimeDraftPayload {
  if (action.type !== "submit") return {};
  if (!action.value) return {};
  try {
    return JSON.parse(action.value) as RuntimeDraftPayload;
  } catch (_error) {
    throw appError("ANSWER_INVALID", "Submit payload is invalid JSON");
  }
}

export function computeRatioPair(triple: Record<Side, LengthValue>, trig: TrigFunction, angle: Angle) {
  const [numRole, denRole] = ROLE_BY_TRIG[trig];
  const numerator = formatLength(triple[sideForRole(angle, numRole)]);
  const denominator = formatLength(triple[sideForRole(angle, denRole)]);
  return { numerator, denominator };
}
