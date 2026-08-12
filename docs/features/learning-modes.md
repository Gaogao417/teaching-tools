# Learning Modes

## Product model

The learner experience has two independent axes:

- `taskId` selects what the learner is studying.
- the route selects how the learner is engaging with that content.

```text
task content × Learn | Practice | Review
```

Changing a mode must not silently change the selected task. Selecting a new task returns to Learn so an active timed session is never replaced accidentally.

## Route ownership

| Route | Owns | Must not own |
| --- | --- | --- |
| `/learn/:taskId` | explanation, worked path, sample prompt, readiness snapshot | timer, draft, action submission |
| `/practice/:taskId` | session restore/start, Action timer/attempts, local training guard, immediate feedback, async training sync | backend per-Action math judging, certified score, full result analysis |
| `/review/:taskId?sessionId=...` | completed training/assessment snapshots, history selection, action replay, next-step recommendation | live session mutation, draft state |

The mode switch is navigation, not a component-local display toggle. A route transition therefore disposes mode-local state naturally.

## Runtime boundary

The shared exercise runtime continues to own the persistent mathematical object and the permitted learner actions. The three modes are projections around that runtime:

- Learn reads `LearningProjectionSpec`, reuses the engine-projected sample runtime, and advances through read-only teaching actions.
- Practice reads one complete `ExercisePlan` per item, including reviewed local validation truth, waits for student input,
  validates and advances locally, and asynchronously records Action-level speed/accuracy metrics.
- Assessment/Challenge receives no local truth and submits evidence to the backend private evaluator.
- Review reads an immutable, versioned training or assessment snapshot. Training review shows Action metrics and trends;
  Assessment review may additionally contain engine-authored expected/actual answers and diagnosis.

Guide narration stays in presentation. Direct manipulation, Practice guard and attempt capture stay in the Action Runtime.
Review does not rerun correctness; it presents the versioned result persisted by the corresponding Training or Assessment path.

The detailed boundary is defined by
[ADR-006](../adr/ADR-006-local-practice-training-runtime.md). Its implementation is staged in the
[Action Training / Presentation / Voice migration plan](../execution/action-presentation-voice-migration-plan.md); pinned legacy
Practice sessions may continue their original server-authoritative path during the compatibility window.

## Progressive disclosure

- Learn reveals step titles up front and expands one current teaching action at a time.
- Practice shows the current goal and compact step titles. Hints are learner-requested.
- Review shows score, one core diagnosis, and the next action first. Weak-problem replay, submissions, trends, and history appear only after the learner opens deep review.

## Content switching

The task drawer is the content switcher. Choosing another task navigates to its Learn route. From there the learner explicitly starts or resumes Practice. Review record selection changes only `sessionId` and never starts a session.
