/**
 * GeometryCanvas — the PUBLIC, generic renderer boundary.
 *
 * Props are ONLY domain types (WorldState, InteractionView, GeometryEvent) plus
 * a viewBox. This component does NOT import "jsxgraph", does NOT know which
 * Action is running, and does NOT own submit logic. It renders the board + any
 * generic input fields declared by InteractionView.inputs, forwarding every
 * GeometryEvent up to the page (which owns the draft + submit round-trip).
 */
import type { GeometryEvent } from "../domain/events.ts";
import type { InputSpec, InteractionView } from "../domain/interaction.ts";
import type { WorldState } from "../domain/geometry.ts";
import { JSXGraphCanvas } from "./JSXGraphCanvas.tsx";

interface Props {
  world: WorldState;
  interaction: InteractionView;
  viewBox?: [number, number, number, number];
  onEvent: (event: GeometryEvent) => void;
}

export function GeometryCanvas({ world, interaction, viewBox, onEvent }: Props) {
  const inputs = interaction.inputs ?? [];
  const activeInputs = inputs.filter((i) => i.active !== false);

  return (
    <div className="ks-poc__canvas">
      <JSXGraphCanvas world={world} interaction={interaction} viewBox={viewBox} onEvent={onEvent} />

      {activeInputs.length > 0 && (
        <div className="ks-poc__inputs">
          {activeInputs.map((spec) => (
            <InputField key={spec.objectId} spec={spec} onEvent={onEvent} />
          ))}
        </div>
      )}
    </div>
  );
}

function InputField({
  spec,
  onEvent,
}: {
  spec: InputSpec;
  onEvent: (event: GeometryEvent) => void;
}) {
  return (
    <label className="ks-poc__input-row">
      {spec.label && <span className="ks-poc__input-label">{spec.label}</span>}
      <input
        className="ks-poc__input"
        type="text"
        inputMode={spec.expectedKind === "number" ? "decimal" : "text"}
        value={spec.value ?? ""}
        placeholder={spec.expectedKind === "number" ? "输入数字" : "输入文本"}
        onChange={(e) =>
          onEvent({
            kind: "input-change",
            objectId: spec.objectId,
            value: e.target.value,
          })
        }
      />
    </label>
  );
}
