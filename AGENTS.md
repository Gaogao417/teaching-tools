# AGENTS.md — teaching-tools 工作纪律

## 仓库结构

- `web/backend`：Express + SQLite，tutor 服务（tutorSession / tutorPolicy / tutorPresentation / planBuild / contracts 测试）；
- `web/frontend`：React，唯一学生入口 `/learn/:taskId`（App.tsx 路由）；
- `web/shared`：前后端共享类型；**canonical 合同镜像在 `web/shared/canonical/`**。

## Canonical 合同（真源在 PRDS 仓）

真源是 sibling 仓 `../ai_teaching_prds_v2_00-07/contracts/`；本仓 `web/shared/canonical/` 只是 vendored 镜像：

- **禁止在本仓发明跨仓合同类型**；新增 schema const 的完整义务：PRDS 写 schema + 正/负 fixtures → 重生成 manifest → 本仓 `schemas.ts` 加 Zod 镜像 + `index.ts` dispatch + `publication.ts`（若 publishable）+ `canonicalContracts.test.ts` 白名单与 schema 计数断言 → 同步 teaching-skills-mvp 镜像 → 双仓测试绿；
- 改 fixtures 必须重生成 manifest 并三处同步（PRDS + 两仓），sha256 锁定，漂移即测试失败；
- 跨字段规则：JSON Schema 能表达的用 allOf if/then 下沉到 schema 层；其余用 `superRefine`，且必须与 Python `model_validator` 逐条一致（99 条 fixtures 双语言判定一致是门禁）；
- 新 ID 前缀先登记 PRDS `contracts/mappings/id-registry.yaml`。

## Legacy 纪律（vNext 主线不得踩）

TutorMove/`move_type`、hint/H0–H5、`pending_workspace`、`demonstration`、completion-only solution-board 是 legacy（L-01~L-05；账本：`../ai_teaching_prds_v2_00-07/migration/legacy-retirement-manifest.md`）：

- vNext golden session 的新代码**禁止 import** legacy writer（`TutorSessionEvent.ts` 的 v2 payload builders、`tutorExperience.ts` 的旧 guards 生产路径）；
- 旧事实进新合同只经 PRDS `contracts/mappings/legacy-contract-adapters.yaml` 的只读 adapter；
- 动 legacy 前重跑 consumer scan（rg 全 src），未知 consumer 不得默认为零。

## 测试门禁

```bash
cd web/backend && npm test && npm run test:vitest
cd web/frontend && npm run typecheck && npm test
# e2e（golden 集需 TUTOR_E2E_TASK_SET=golden 与 canonical root）：
cd web/frontend && npm run test:e2e:tutor
```

改 `web/shared/` 后必须同时过 backend 与 frontend 的 typecheck/test。
