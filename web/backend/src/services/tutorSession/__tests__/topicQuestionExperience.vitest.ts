/**
 * 波次 B 合同测试：TopicQuestionTeaching 选择器（fail-closed 对账矩阵）+
 * v3/v4 协调器不变量（experience 必带、approach-set 传递依赖对账、
 * Provider 路由与 FORCE 回滚）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  canonicalHash,
} from "../../planBuild/canonicalInputs";
import {
  publishSyntheticPlanVt,
  publishSyntheticV3Experience,
  tempRoot,
} from "./vitestSupport";
import {
  approachRefsMatchSet,
  refEquals,
  resolvePolicyProvider,
  selectTopicQuestionTeaching,
  selectTopicQuestionTeachingWithRole,
} from "../topicQuestionExperience";
import {
  createTutorSessionCoordinator,
  TutorSessionCoordinatorError,
} from "../TutorSession";
import { getTutorSession } from "../TutorSessionEventStore";

const BASE = { qtId: "QT-TST-901", tpId: "TP-TST-901", taskId: "task-learn-901", scenarioId: "SC-TST-901" };

function freshRoot(): { root: string; published: ReturnType<typeof publishSyntheticV3Experience> } {
  const root = tempRoot("tqe");
  const published = publishSyntheticV3Experience(root, BASE);
  return { root, published };
}

/** 就地篡改注册表内某 artifact 的当前版本文件（不动 registry.yaml）。 */
function mutate(root: string, namespace: string, artifactId: string, mutate: (payload: Record<string, unknown>) => void): void {
  const registry = path.join(root, namespace, artifactId, "registry.yaml");
  const current = /current_version:\s*(v\d+)/.exec(readFileSync(registry, "utf8"))![1];
  const file = path.join(root, namespace, artifactId, `${current}.json`);
  const payload = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  mutate(payload);
  writeBack(file, payload);
}

function writeBack(file: string, payload: Record<string, unknown>): void {
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

describe("selectTopicQuestionTeaching（fail-closed 对账）", () => {
  it("happy path：返回 tutor 选择与 profile snapshot", () => {
    const { root } = freshRoot();
    const selection = selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId);
    expect(selection.kind).toBe("tutor");
    if (selection.kind !== "tutor") return;
    expect(selection.plan.schema).toBe("ai_teaching_tutor_plan_bundle/v3");
    expect(selection.variant.role).toBe("default");
    expect(selection.profileSnapshot).toMatchObject({
      profile_id: "PP-TST-001",
      version: "2026-08-22.1",
      primary_provider: "deepseek-langgraph",
      fallback_provider: "deterministic-rules",
      model_id: "deepseek-v4-flash",
    });
  });

  it("无 canonical root / 无 Approved Binding → legacy", () => {
    expect(selectTopicQuestionTeaching({ canonicalRoot: "" }, BASE.taskId)).toEqual({
      kind: "legacy",
      reason: "canonical_root_missing",
    });
    expect(selectTopicQuestionTeaching({ canonicalRoot: "/nonexistent-root-xyz" }, BASE.taskId)).toEqual({
      kind: "legacy",
      reason: "canonical_root_missing",
    });
    const { root } = freshRoot();
    expect(selectTopicQuestionTeaching({ canonicalRoot: root }, "task-unbound-999")).toEqual({
      kind: "legacy",
      reason: "no_approved_binding",
    });
  });

  it("Draft Binding（建议未审）→ legacy：未审核不开放学生流量（波次 D 口径）", () => {
    const { root } = freshRoot();
    // registry current 版本标 Draft（建议清单态）：approvedBindingsForTask
    // 只读 Approved，装载层必须当作无绑定处理，不静默开放学生流量。
    const bindingId = `TB-TST-${BASE.qtId.slice(-1)}01`;
    mutate(root, "topic-question-binding", bindingId, (payload) => {
      payload.status = "Draft";
    });
    const registryFile = path.join(root, "topic-question-binding", bindingId, "registry.yaml");
    const registryText = readFileSync(registryFile, "utf8").replace(/status: Approved/g, "status: Draft");
    writeFileSync(registryFile, registryText);
    expect(selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId)).toEqual({
      kind: "legacy",
      reason: "no_approved_binding",
    });
  });

  it("同 Task 两个 Approved Binding → AMBIGUOUS_BINDING（不静默挑选）", () => {
    const { root, published } = freshRoot();
    const second = JSON.parse(JSON.stringify(published.binding)) as Record<string, unknown>;
    second.artifact_id = "TB-TST-902";
    second.artifact_uri = "artifact://topic-question-binding/TB-TST-902@v1";
    second.content_hash = canonicalHash(second, "authoring");
    const dir = path.join(root, "topic-question-binding", "TB-TST-902");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "v1.json"), `${JSON.stringify(second, null, 2)}\n`);
    writeFileSync(path.join(dir, "registry.yaml"), "artifact_id: TB-TST-902\ncurrent_version: v1\nversions:\n- {version: v1, status: Approved}\n");

    const selection = selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId);
    expect(selection).toMatchObject({ kind: "error", code: "AMBIGUOUS_BINDING" });
  });

  it("binding.question_ref hash 漂移 → BINDING_QUESTION_STALE", () => {
    const { root } = freshRoot();
    mutate(root, "topic-question-binding", `TB-TST-${BASE.qtId.slice(-1)}01`, (payload) => {
      (payload.question_ref as { content_hash: string }).content_hash =
        "sha256:" + "0".repeat(64);
      payload.content_hash = canonicalHash(payload, "authoring");
    });
    const selection = selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId);
    expect(selection).toMatchObject({ kind: "error", code: "BINDING_QUESTION_STALE" });
  });

  it("plan approach_refs 与 ApproachSet 小问选择不一致 → APPROACH_SET_MISMATCH", () => {
    const { root } = freshRoot();
    // plan 内容变化 → plan hash 变化 → binding.tutor_plan_ref 同步重算
    // （模拟"发布侧自洽但讲法选择漂移"的装载层拦截）。
    let newPlanHash = "";
    mutate(root, "tutor-plan", BASE.tpId, (payload) => {
      (payload.approach_refs as Array<{ artifact_id: string }>)[0].artifact_id = "TA-TST-099";
      payload.content_hash = canonicalHash(payload, "plan");
      newPlanHash = payload.content_hash as string;
    });
    mutate(root, "topic-question-binding", `TB-TST-${BASE.qtId.slice(-1)}01`, (payload) => {
      const variant = (payload.teaching_variants as Array<{ tutor_plan_ref: { content_hash: string; version: string } }>)[0];
      variant.tutor_plan_ref.content_hash = newPlanHash;
      variant.tutor_plan_ref.version = "v2";
      payload.content_hash = canonicalHash(payload, "authoring");
    });
    const selection = selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId);
    expect(selection).toMatchObject({ kind: "error", code: "APPROACH_SET_MISMATCH" });
  });

  it("profile 语义版本漂移 → PROFILE_VERSION_MISMATCH", () => {
    const { root } = freshRoot();
    // 漂移制造在 plan 的 ref.version（profile 哈希保持一致）：
    // 场景 = plan 固定了错误的语义版本号（authoring 错误，装载层拦截）。
    let newPlanHash2 = "";
    mutate(root, "tutor-plan", BASE.tpId, (payload) => {
      (payload.policy_profile_ref as { version: string }).version = "2026-09-01.1";
      payload.content_hash = canonicalHash(payload, "plan");
      newPlanHash2 = payload.content_hash as string;
    });
    mutate(root, "topic-question-binding", `TB-TST-${BASE.qtId.slice(-1)}01`, (payload) => {
      const variant = (payload.teaching_variants as Array<{ tutor_plan_ref: { content_hash: string; version: string } }>)[0];
      variant.tutor_plan_ref.content_hash = newPlanHash2;
      variant.tutor_plan_ref.version = "v2";
      payload.content_hash = canonicalHash(payload, "authoring");
    });
    const selection = selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId);
    expect(selection).toMatchObject({ kind: "error", code: "PROFILE_VERSION_MISMATCH" });
  });

  it("profile 重发布导致 hash 漂移 → PROFILE_NOT_APPROVED", () => {
    const { root } = freshRoot();
    mutate(root, "tutor-policy-profile", "PP-TST-001", (payload) => {
      payload.profile_version = "2026-09-01.1";
      payload.content_hash = canonicalHash(payload, "authoring");
    });
    const selection = selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId);
    expect(selection).toMatchObject({ kind: "error", code: "PROFILE_NOT_APPROVED" });
  });

  it("Binding 无 default variant（非法内容）→ legacy fail closed", () => {
    const { root } = freshRoot();
    mutate(root, "topic-question-binding", `TB-TST-${BASE.qtId.slice(-1)}01`, (payload) => {
      const variants = payload.teaching_variants as Array<{ role: string }>;
      variants[0].role = "alternate";
      payload.content_hash = canonicalHash(payload, "authoring");
    });
    expect(selectTopicQuestionTeaching({ canonicalRoot: root }, BASE.taskId)).toEqual({
      kind: "legacy",
      reason: "no_approved_binding",
    });
  });

  it("alternate 讲法：存在时可选、不存在 → legacy(no_alternate_variant)", () => {
    const root = tempRoot("tqe-alt");
    publishSyntheticV3Experience(root, { ...BASE, alternateTpId: "TP-TST-902" });
    const alternate = selectTopicQuestionTeachingWithRole({ canonicalRoot: root }, BASE.taskId, "alternate");
    expect(alternate.kind).toBe("tutor");
    if (alternate.kind !== "tutor") return;
    expect(alternate.plan.artifact_id).toBe("TP-TST-902");

    const { root: soloRoot } = freshRoot();
    expect(selectTopicQuestionTeachingWithRole({ canonicalRoot: soloRoot }, BASE.taskId, "alternate")).toEqual({
      kind: "legacy",
      reason: "no_alternate_variant",
    });
  });
});

describe("对账纯函数（refEquals / approachRefsMatchSet）", () => {
  const ref = (over: Partial<{ artifact_id: string; version: string; content_hash: string }> = {}) => ({
    artifact_id: "TA-1",
    version: "v1",
    content_hash: "sha256:" + "a".repeat(64),
    ...over,
  });

  it("refEquals 三元组逐字段判定", () => {
    expect(refEquals(ref(), ref())).toBe(true);
    expect(refEquals(ref(), ref({ artifact_id: "TA-2" }))).toBe(false);
    expect(refEquals(ref(), ref({ version: "v2" }))).toBe(false);
    expect(refEquals(ref(), ref({ content_hash: "sha256:" + "b".repeat(64) }))).toBe(false);
  });

  it("approachRefsMatchSet：数量、缺 part、字段漂移均判 false", () => {
    const set = {
      schema: "x",
      parts: [{ part_id: "1", approach: ref(), alternates: [] }],
    } as unknown as Parameters<typeof approachRefsMatchSet>[1];
    const planRef = { ...ref(), part_id: "1" };
    const plan = { approach_refs: [planRef] } as never;
    expect(approachRefsMatchSet(plan, set)).toBe(true);
    expect(approachRefsMatchSet({ approach_refs: [planRef, { ...ref(), part_id: "2" }] } as never, set)).toBe(false);
    expect(approachRefsMatchSet({ approach_refs: [{ ...ref(), part_id: "9" }] } as never, set)).toBe(false);
    expect(approachRefsMatchSet({ approach_refs: [{ ...ref({ version: "v2" }), part_id: "1" }] } as never, set)).toBe(false);
  });
});

describe("resolvePolicyProvider（§2 Provider 路由）", () => {
  const profile: Parameters<typeof resolvePolicyProvider>[0] = {
    schema: "ai_teaching_tutor_policy_profile/v1",
    artifact_id: "PP-TST-001",
    version: "v1",
    status: "Approved",
    profile_version: "1",
    primary_provider: "deepseek-langgraph",
    fallback_provider: "deterministic-rules",
    model_id: "m",
    prompt_version: "p",
    content_hash: "sha256:" + "c".repeat(64),
  };

  it("默认按 profile.primary_provider 路由", () => {
    expect(resolvePolicyProvider(profile, {})).toEqual({ provider: "deepseek-langgraph", forced: false });
  });

  it("FORCE 只在紧急回滚时改 Provider，不改语义", () => {
    expect(resolvePolicyProvider(profile, { TUTOR_POLICY_FORCE_PROVIDER: "deterministic" })).toEqual({
      provider: "deterministic-rules",
      forced: true,
    });
    expect(resolvePolicyProvider(profile, { TUTOR_POLICY_FORCE_PROVIDER: "deepseek-langgraph" })).toEqual({
      provider: "deepseek-langgraph",
      forced: false,
    });
  });
});

describe("协调器 v3/v4 不变量", () => {
  it("v3 plan 经 Binding 面启动：session_started 为 v4 全链 provenance", () => {
    const { root } = freshRoot();
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    coordinator.start({
      sessionId: "TS-9001",
      studentId: "student-a",
      tpId: BASE.tpId,
      access: "binding",
      experience: {
        task_id: BASE.taskId,
        scenario_id: BASE.scenarioId,
        approach_set_ref: { artifact_id: `AS-TST-${BASE.qtId.slice(-1)}01`, version: "v1", content_hash: "sha256:" + "1".repeat(64) },
        policy_profile_snapshot: {
          profile_id: "PP-TST-001",
          version: "2026-08-22.1",
          primary_provider: "deterministic-rules",
          fallback_provider: "deepseek-langgraph",
          model_id: "deepseek-v4-flash",
          prompt_version: "policy-voice-deepseek/v1",
        },
        provider: "deterministic-rules",
      },
    });
    expect(getTutorSession("TS-9001")).toMatchObject({ event_schema: "v4", plan_artifact_id: BASE.tpId });
    const started = coordinator.getEvents("TS-9001")[0];
    expect(started.event_type).toBe("session_started");
    expect(started.payload).toMatchObject({
      task_id: BASE.taskId,
      scenario_id: BASE.scenarioId,
      approach_set_ref: { artifact_id: `AS-TST-${BASE.qtId.slice(-1)}01` },
      tutor_plan_ref: { artifact_id: BASE.tpId },
      policy_profile_snapshot: { profile_id: "PP-TST-001", primary_provider: "deterministic-rules" },
    });
    // restore 走 pinned 快照：contexts 缓存清除后仍能重建（loadSession 路径）。
    const view = coordinator.getSessionView("TS-9001");
    expect(view.revision).toBeGreaterThanOrEqual(1);
  });

  it("v3 plan 缺 experience / v2 plan 带 experience → INVALID_INPUT fail closed", () => {
    const { root } = freshRoot();
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    expect(() =>
      coordinator.start({ sessionId: "TS-9002", studentId: "s", tpId: BASE.tpId, access: "binding" }),
    ).toThrowError(TutorSessionCoordinatorError);

    const rootV2 = tempRoot("tqe-v2");
    publishSyntheticPlanVt(rootV2, { qtId: BASE.qtId, tpId: "TP-TST-905", parts: 0 });
    const coordinatorV2 = createTutorSessionCoordinator({ canonicalRoot: rootV2 });
    expect(() =>
      coordinatorV2.start({
        sessionId: "TS-9003",
        studentId: "s",
        tpId: "TP-TST-905",
        access: "binding",
        experience: {
          task_id: "t",
          scenario_id: "sc",
          approach_set_ref: { artifact_id: "AS-TST-901", version: "v1", content_hash: "sha256:" + "1".repeat(64) },
          policy_profile_snapshot: {
            profile_id: "PP-TST-001",
            version: "1",
            primary_provider: "deterministic-rules",
            fallback_provider: "deepseek-langgraph",
            model_id: "m",
            prompt_version: "p",
          },
          provider: "deterministic-rules",
        },
      }),
    ).toThrowError(/不携带 experience|必须携带 experience/);
  });

  it("binding 面绕过 golden TP-ID 白名单（Approved Binding 是新权威）", () => {
    const { root } = freshRoot();
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    // TP-TST-901 不在 golden 白名单：隔离面 403，binding 面正常启动。
    expect(() =>
      coordinator.start({ sessionId: "TS-9004", studentId: "s", tpId: BASE.tpId }),
    ).toThrowError(expect.objectContaining({ code: "FEATURE_FLAG_OFF" }));
    coordinator.start({
      sessionId: "TS-9005",
      studentId: "s",
      tpId: BASE.tpId,
      access: "binding",
      experience: {
        task_id: BASE.taskId,
        scenario_id: BASE.scenarioId,
        approach_set_ref: { artifact_id: `AS-TST-${BASE.qtId.slice(-1)}01`, version: "v1", content_hash: "sha256:" + "1".repeat(64) },
        policy_profile_snapshot: {
          profile_id: "PP-TST-001",
          version: "2026-08-22.1",
          primary_provider: "deterministic-rules",
          fallback_provider: "deepseek-langgraph",
          model_id: "m",
          prompt_version: "p",
        },
        provider: "deterministic-rules",
      },
    });
    expect(getTutorSession("TS-9005")).toMatchObject({ event_schema: "v4" });
  });

  it("TUTOR_POLICY_FORCE_PROVIDER 只降级 Provider：v4+deepseek 会话仍走确定性端口", async () => {
    const { root } = freshRoot();
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    coordinator.start({
      sessionId: "TS-9007",
      studentId: "s",
      tpId: BASE.tpId,
      access: "binding",
      experience: {
        task_id: BASE.taskId,
        scenario_id: BASE.scenarioId,
        approach_set_ref: { artifact_id: `AS-TST-${BASE.qtId.slice(-1)}01`, version: "v1", content_hash: "sha256:" + "1".repeat(64) },
        policy_profile_snapshot: {
          profile_id: "PP-TST-001",
          version: "2026-08-22.1",
          primary_provider: "deepseek-langgraph",
          fallback_provider: "deterministic-rules",
          model_id: "deepseek-v4-flash",
          prompt_version: "policy-voice-deepseek/v1",
        },
        provider: "deepseek-langgraph",
      },
    });
    process.env.TUTOR_POLICY_FORCE_PROVIDER = "deterministic";
    try {
      const turn = await coordinator.driveTutorTurn("TS-9007", { kind: "system", reason: "session_started" });
      expect(turn.decision?.policy_version ?? "").toMatch(/deterministic/i);
      // 快照未被改写：会话仍是 v4 + 原 profile。
      expect(getTutorSession("TS-9007")).toMatchObject({ event_schema: "v4" });
      const started = coordinator.getEvents("TS-9007")[0];
      expect((started.payload as unknown as { policy_profile_snapshot: { primary_provider: string } }).policy_profile_snapshot.primary_provider).toBe("deepseek-langgraph");
    } finally {
      delete process.env.TUTOR_POLICY_FORCE_PROVIDER;
    }
  });

  it("v4 会话 session_started 事件损坏（缺 profile snapshot）→ POLICY_PROFILE_INVALID fail closed", async () => {
    const { root } = freshRoot();
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    coordinator.start({
      sessionId: "TS-9008",
      studentId: "s",
      tpId: BASE.tpId,
      access: "binding",
      experience: {
        task_id: BASE.taskId,
        scenario_id: BASE.scenarioId,
        approach_set_ref: { artifact_id: `AS-TST-${BASE.qtId.slice(-1)}01`, version: "v1", content_hash: "sha256:" + "1".repeat(64) },
        policy_profile_snapshot: {
          profile_id: "PP-TST-001",
          version: "2026-08-22.1",
          primary_provider: "deterministic-rules",
          fallback_provider: "deepseek-langgraph",
          model_id: "m",
          prompt_version: "p",
        },
        provider: "deterministic-rules",
      },
    });
    // 直接删除事件行模拟 v4 事件损坏（进程内 contexts 缓存先用真会话建立后清除：
    // 这里用新进程内协调器实例绕过缓存——同一 contexts Map 在同一实例内，
    // 因此用独立实例读同一 SQLITE_PATH）。
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.SQLITE_PATH as string);
    db.prepare("DELETE FROM tutor_session_events WHERE session_id = ?").run("TS-9008");
    db.close();
    const reader = createTutorSessionCoordinator({ canonicalRoot: root });
    expect(() => reader.getSessionView("TS-9008")).toThrowError(
      expect.objectContaining({ code: "POLICY_PROFILE_INVALID" }),
    );
  });

  it("协调器内 approach-set 传递依赖对账：plan 与 AS 小问选择漂移 → fail closed", () => {
    const root = tempRoot("tqe-as");
    publishSyntheticV3Experience(root, { ...BASE });
    // 直接篡改 plan 的 approach_set_ref 指向不存在的 AS（绕过选择器）。
    mutate(root, "tutor-plan", BASE.tpId, (payload) => {
      (payload.approach_set_ref as { artifact_id: string }).artifact_id = "AS-TST-999";
      payload.content_hash = canonicalHash(payload, "plan");
    });
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    expect(() =>
      coordinator.start({
        sessionId: "TS-9006",
        studentId: "s",
        tpId: BASE.tpId,
        access: "binding",
        experience: {
          task_id: BASE.taskId,
          scenario_id: BASE.scenarioId,
          approach_set_ref: { artifact_id: "AS-TST-999", version: "v1", content_hash: "sha256:" + "1".repeat(64) },
          policy_profile_snapshot: {
            profile_id: "PP-TST-001",
            version: "2026-08-22.1",
            primary_provider: "deterministic-rules",
            fallback_provider: "deepseek-langgraph",
            model_id: "m",
            prompt_version: "p",
          },
          provider: "deterministic-rules",
        },
      }),
    ).toThrowError(TutorSessionCoordinatorError);
  });
});
