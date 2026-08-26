/**
 * VS0 REQ-07 / L-06：POC（src/poc/geometry-actions）唯一测试价值的 production
 * 迁移。POC 的三个 tsx 独立测试（makeParallelEngine / markSegmentValueEngine /
 * projector）在删除前将其未覆盖语义迁到这里——真实 action machines +
 * createActionPageRuntime（即 /learn/:taskId 的 Workspace 渲染路径）：
 *
 * 1. 私有 answerKey 判定：错对象 reject 且状态不前移、不产生 evidence；
 *    对对象才推进/完成（POC makeParallel/markSegmentValue engine 语义）；
 * 2. 序列化学生安全面无 truth 字段：getView() 快照不得出现
 *    localTruth/teachingInput/expectedValues/expectedValue 字段名
 *    （POC "answerKey does NOT leak into the serialized flow" 的合同版）；
 * 3. 通用投影链（spec→world/interaction、draft 累积）已由
 *    projectWorkspaceView.test.ts / actionRuntime.test.ts 覆盖，不重复。
 */
import { describe, expect, it } from "vitest";
import type { ActionContract, ExercisePlan } from "../../../../shared/actionRuntime";
import { createActionActor } from "../actionActor";
import { createActionPageRuntime } from "../pageRuntime";

function geometryPlan(): ExercisePlan {
  const world = {
    revision: 0,
    geometry: {
      viewBox: { width: 10, height: 10 },
      points: [{ id: "A", x: 0, y: 4 }, { id: "B", x: -4, y: -2 }, { id: "C", x: -1, y: -2 }, { id: "D", x: 3, y: 1 }, { id: "E", x: 6, y: -3 }],
      segments: [{ id: "BC", from: "B", to: "C" }, { id: "DE", from: "D", to: "E" }],
    },
  };
  const makeParallel: ActionContract = {
    actionId: "step/make", sourceStepId: "step", kind: "make-parallel", version: 1,
    title: "作平行线", instruction: "过 A 作 BC 的平行线",
    input: { throughPointId: "A", referenceLineId: "BC", availablePointIds: ["A", "B", "C"], availableLineIds: ["BC", "DE"], outputLineId: "P", outputLineLabel: "AP" },
    capabilities: [], answerSlots: [], validationPolicy: "local-demonstration", submitOnComplete: false,
  };
  return {
    planVersion: 5,
    exerciseId: "exercise-vs00",
    revision: 0,
    mode: "learn",
    metadata: { taskId: "auxiliaryTwoRatios", title: "vs00", promptLatex: "prompt", skillTags: [] },
    world,
    coach: { profileId: "coach", displayName: "老师", avatarId: "school", tone: "supportive" },
    actions: [makeParallel],
    currentActionId: "step/make",
    completedActionIds: [],
  };
}

describe("VS0 POC 迁移：几何选择判定与 truth 隔离（production 路径）", () => {
  it("make-parallel：错点 reject 状态不前移；对点推进；错线 reject；对线完成 evidence", () => {
    const plan = geometryPlan();
    const contract = plan.actions[0];
    const actor = createActionActor(contract);

    // 错点（B 不是 through point，LocalTeaching truth 私有）：reject，停在选点步。
    actor.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "B" });
    let snapshot = actor.getSnapshot();
    expect(snapshot.done).toBe(false);
    expect(snapshot.wrongObjectId).toBe("B");
    expect(snapshot.wrongMessage).toContain("不是当前动作需要的对象");
    expect(snapshot.selectedByKind.points).toEqual([]);

    // 对点 A：推进到选线步。
    actor.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "A" });
    snapshot = actor.getSnapshot();
    expect(snapshot.done).toBe(false);
    expect(snapshot.wrongObjectId).toBeUndefined();
    expect(snapshot.selectedByKind.points).toEqual(["A"]);

    // 错线（DE 不是 reference line）：reject，状态不变。
    actor.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "DE" });
    snapshot = actor.getSnapshot();
    expect(snapshot.done).toBe(false);
    expect(snapshot.wrongObjectId).toBe("DE");
    expect(snapshot.selectedByKind.lines).toEqual([]);

    // 对线 BC：机器完成，evidence 携带学生选择（非 truth 字段）。
    actor.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "BC" });
    snapshot = actor.getSnapshot();
    expect(snapshot.done).toBe(true);
    expect(snapshot.evidence).toMatchObject({ kind: "make-parallel", throughPointId: "A", referenceLineId: "BC" });
    actor.stop();
  });

  it("mark-segment-values：错段 reject 状态不变；对段进入答题并本地判定", () => {
    const contract: ActionContract = {
      actionId: "step/mark", sourceStepId: "step", kind: "mark-segment-values", version: 1,
      title: "标注线段长", instruction: "标注 BC 的长",
      input: { labels: [{ segmentId: "BC", displayName: "BC", valueLatex: "2" }], availableSegmentIds: ["BC", "DE"], autoFocusSequence: true },
      capabilities: [], answerSlots: [{ id: "BC", label: "BC", kind: "number", required: true }],
      validationPolicy: "local-demonstration", submitOnComplete: true,
    };
    const actor = createActionActor(contract);

    // 错段（期望 BC）：reject，选择列表保持空。
    actor.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "DE" });
    let snapshot = actor.getSnapshot();
    expect(snapshot.wrongObjectId).toBe("DE");
    expect(snapshot.selectedByKind.lines).toEqual([]);

    // 对段 BC：进入输入；错值不完成，对值完成（POC markSegmentValue 语义）。
    actor.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "BC" });
    snapshot = actor.getSnapshot();
    expect(snapshot.selectedByKind.lines).toEqual(["BC"]);
    actor.send({ type: "ANSWER.CHANGED", slotId: "BC", value: "3" });
    actor.send({ type: "SUBMIT" });
    expect(actor.getSnapshot().done).toBe(false);
    expect(actor.getSnapshot().wrongMessage).toBeTruthy();
    actor.send({ type: "ANSWER.CHANGED", slotId: "BC", value: "2" });
    actor.send({ type: "SUBMIT" });
    expect(actor.getSnapshot().done).toBe(true);
    expect(actor.getSnapshot().evidence).toMatchObject({ kind: "mark-segment-values", values: { BC: "2" } });
    actor.stop();
  });

  it("序列化学生安全 View 无 truth 字段（answerKey 不进投影）", () => {
    const plan = geometryPlan();
    // 注入 LocalTeaching truth（真实 learn 材料化在服务端完成；这里直接构造）。
    const runtime = createActionPageRuntime({
      ...plan,
      actions: [{
        ...plan.actions[0],
        localTruth: { throughPointId: "A", referenceLineId: "BC" },
      } as ActionContract],
    });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "A" });
    const viewJson = JSON.stringify(runtime.getView());
    for (const forbidden of ["localTruth", "teachingInput", "expectedValues", "expectedValue", "answerKey"]) {
      expect(viewJson, `View 投影含 truth 字段 ${forbidden}`).not.toContain(`"${forbidden}"`);
    }
    // 学生自己的草稿选择允许出现在 preview（student-originated，非 truth）。
    expect(runtime.getView().canvas.preview).toMatchObject({ type: "parallel", throughPointId: "A" });
    runtime.stop();
  });
});
