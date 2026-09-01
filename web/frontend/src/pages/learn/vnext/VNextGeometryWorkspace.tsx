/**
 * F7 — vNext 几何工作区（fe-prep 对接面 3 的生产化落点）。
 *
 * - 渲染：production `GeometryCanvasSurface`（JSXGraph 真渲染器，共享
 *   `buildGeometryModel` 适配——坐标系换算只在该适配层做一次）；题图来自
 *   golden catalog.baseGeometry（与命令 target 真源同源），不建第二 renderer。
 * - 交互：pointer 点击线段 + 键盘可操作线段列表（同一选择状态，aria-pressed）
 *   → 选中线段各填一个已知值 → 提交 `similarity.mark-known-segments`
 *   typed student command（surface=geometry，target=segment-XX，
 *   params.values.{XX}）——经 vNext 出口走 F3 五重校验，非本地状态伪装。
 * - selection/值是前端瞬时状态（ADR-010 §5 口径）；提交成功后以服务端
 *   StudentWorkspaceView 的 student_authored/annotated 元素为准回显。
 */
import { useMemo, useState } from "react";

import type { TopicGeometryModel } from "../../../../../shared/topicPractice";
import { buildGeometryModel } from "../../../geometry/adapters/topicGeometryModel";
import { GeometryCanvasSurface } from "../../../geometry/react/GeometryCanvas";
import type { InteractionView } from "../../../geometry/interaction/interaction-view";

export interface VNextGeometryWorkspaceProps {
  geometry: TopicGeometryModel | undefined;
  interactionEnabled: boolean;
  busy: boolean;
  /** 提交 typed 命令（由体验组件接 vNext hook）。 */
  onSubmitMarkKnown: (input: { targetIds: string[]; values: Record<string, string> }) => void;
}

export function VNextGeometryWorkspace({ geometry, interactionEnabled, busy, onSubmitMarkKnown }: VNextGeometryWorkspaceProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [modelVersion, setModelVersion] = useState(0);

  const model = useMemo(() => (geometry ? buildGeometryModel(geometry) : null), [geometry]);
  /** catalog 线段 id 已是 segment-XX 形态（命令 target 真源）；short 用于显示与 params.values 键。 */
  const segmentIds = useMemo(
    () => (geometry ? geometry.segments.map((segment) => segment.id.replace(/^segment-/, "")) : []),
    [geometry],
  );

  const toggleSegment = (segmentId: string): void => {
    if (!interactionEnabled) return;
    setSelected((prev) => (prev.includes(segmentId) ? prev.filter((id) => id !== segmentId) : [...prev, segmentId]));
    // 模型未变但选择态变化需要重绘强调——modelVersion 保持稳定（模型相同），
    // 选择强调由 entities.visualState 驱动。
    setModelVersion((version) => version);
  };

  const view: InteractionView = useMemo(() => {
    const entities: InteractionView["entities"] = {};
    for (const segmentId of segmentIds) {
      entities[segmentId] = {
        id: segmentId,
        kind: "line",
        enabled: interactionEnabled,
        expected: false,
        visualState: !interactionEnabled ? "idle" : selected.includes(segmentId) ? "selected" : "available",
      };
    }
    return {
      prompt: interactionEnabled ? "点击线段标记已知条件（可多选）" : "当前为只读回顾，画布不可操作。",
      entities,
      selected: selected.map((id) => ({ kind: "line", id })),
      cursor: interactionEnabled ? "pointer" : "default",
      canCancel: selected.length > 0,
      canGoBack: false,
    };
  }, [interactionEnabled, segmentIds, selected]);

  const allFilled = selected.length > 0 && selected.every((segmentId) => (values[segmentId] ?? "").trim().length > 0);

  const submit = (): void => {
    if (!allFilled || busy) return;
    onSubmitMarkKnown({
      targetIds: selected.map((short) => `segment-${short}`),
      values: Object.fromEntries(selected.map((short) => [short, values[short].trim()])),
    });
    setSelected([]);
    setValues({});
  };

  if (!model) {
    return <p className="student-workspace-empty-note" data-testid="vnext-geometry-missing">题图不可用（canonical 链未提供 baseGeometry）。</p>;
  }

  return (
    <div className="vnext-geometry-workspace" data-testid="vnext-geometry" data-interaction-enabled={interactionEnabled}>
      <GeometryCanvasSurface
        model={model}
        view={view}
        modelVersion={modelVersion}
        onClickEntity={(hit) => {
          if (hit.kind === "line") toggleSegment(hit.id);
        }}
      />
      {interactionEnabled ? (
        <div className="vnext-geometry-controls" data-testid="vnext-geometry-controls">
          <fieldset>
            <legend>标记已知线段（点击画布或按下列按钮选择）</legend>
            <div className="vnext-geometry-segment-list" role="group" aria-label="线段选择">
              {segmentIds.map((segmentId) => (
                <button
                  key={segmentId}
                  type="button"
                  className="btn btn-ghost vnext-segment-toggle"
                  aria-pressed={selected.includes(segmentId)}
                  data-testid={`vnext-segment-${segmentId}`}
                  onClick={() => toggleSegment(segmentId)}
                >
                  {segmentId}
                </button>
              ))}
            </div>
            {selected.map((segmentId) => (
              <label key={segmentId} className="vnext-segment-value">
                <span>{segmentId} =</span>
                <input
                  value={values[segmentId] ?? ""}
                  aria-label={`线段 ${segmentId} 的已知值`}
                  data-testid={`vnext-segment-value-${segmentId}`}
                  placeholder="如 t 或 4"
                  onChange={(event) => setValues((prev) => ({ ...prev, [segmentId]: event.target.value }))}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-primary"
              data-testid="vnext-submit-mark-known"
              disabled={!allFilled || busy}
              onClick={submit}
            >
              提交标记
            </button>
          </fieldset>
        </div>
      ) : (
        <p className="canonical-canvas-readonly-note" role="status">当前为只读回顾，画布不可操作。</p>
      )}
    </div>
  );
}
