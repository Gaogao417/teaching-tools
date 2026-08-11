---
action_kind: replace-with-action-kind
action_version: 1
runtime_model: action-runtime-v2
status: draft
requesting_topic: replace-with-topic-id-or-standalone
---

# Action Capability Spec: Replace with action name

## Capability boundary

**Learner operation:**

**Why existing Actions cannot express it:**

**Reusable boundary:**

**Non-goals:**

- Topic-specific wording, IDs, and answer values.

## Version decision

| Question | Decision |
| --- | --- |
| New kind or existing kind? |  |
| Compatible extension or incompatible contract? |  |
| Registered key | `replace-with-kind@1` |
| Legacy versions retained | Not applicable / list |

## Shared contract

**Public input shape:**

```ts
type Input = {
  // Public structure only.
};
```

**Private teaching truth:**

```ts
type TeachingInput = {
  // Expected objects/order/values/results.
};
```

**Typed evidence:**

```ts
type Evidence = {
  actionId: string;
  sourceStepId: string;
  kind: "replace-with-kind";
  version: 1;
};
```

**Structural readiness:**

**Validation and error identity:**

## Frontend machine

| Concern | Contract |
| --- | --- |
| States and transitions |  |
| Enabled entities |  |
| Duplicate/order/count rules |  |
| Answer slots and focus |  |
| Local teaching correctness |  |
| Evidence output |  |
| Wrong feedback |  |

## Backend evaluation

| Concern | Contract |
| --- | --- |
| Private comparison |  |
| `wrongActionIds` |  |
| `wrongObjectIds` |  |
| `wrongSlotIds` |  |
| Accepted result |  |

## Diagram effects and SolutionBoard isolation

| Surface | Draft preview | Accepted canonical effect | Persistent/replay identity |
| --- | --- | --- | --- |
| Diagram |  |  |  |

**SolutionBoard isolation:** This capability does not author or interpret proof prose. Describe how tests prove an authorized backend context passes through unchanged and Assessment receives none.

## Mode and redaction

| Mode | Public input | Private truth | Board/coach | Validation |
| --- | --- | --- | --- | --- |
| Learn |  |  |  |  |
| Guided Practice |  |  |  |  |
| Assessment |  | Redacted | Redacted |  |

## Recovery and persistence

| Event | Required result |
| --- | --- |
| BACK |  |
| CLEAR |  |
| Rejected evaluation |  |
| Accepted commit |  |
| Checkpoint/refresh |  |
| Repeated submission |  |

## Registry and authoring

**Registry validator:**

**Generic authoring API/mapping:**

**Target-independent fixture:**

## Implementation seams

| Layer | Files or modules | Planned change |
| --- | --- | --- |
| Shared |  |  |
| Frontend |  |  |
| Backend |  |  |
| Authoring |  |  |
| Tests |  |  |

## Verification plan

- Shared contract and command tests.
- Frontend machine and registry tests.
- Backend evaluation and effect parity tests.
- Authoring and v2 bundle validation.
- Mode redaction, recovery, desktop, and narrow-width browser checks.

## Decisions requiring approval

- 

## Verification evidence

Complete after implementation. Record commands, fixture IDs, runtime model/schema observations, action paths, modes, browser states, and deferred checks.
