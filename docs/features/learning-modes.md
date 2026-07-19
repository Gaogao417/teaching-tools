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
| `/practice/:taskId` | session restore/start, timer, runtime draft, action submission, immediate feedback | full worked solution, result analysis |
| `/review/:taskId?sessionId=...` | completed result snapshots, history selection, action replay, next-step recommendation | live session mutation, draft state |

The mode switch is navigation, not a component-local display toggle. A route transition therefore disposes mode-local state naturally.

## Runtime boundary

The shared exercise runtime continues to own the persistent mathematical object and the permitted learner actions. The three modes are projections around that runtime:

- Learn reads `LearningProjectionSpec`, reuses the engine-projected sample runtime, and advances through read-only teaching actions.
- Practice renders `ExerciseRuntimeSpec`, keeps the workspace visible, and records submitted runtime actions.
- Review reads an immutable `ResultSnapshot` containing engine-authored diagnosis, expected/actual structured answers, scene replay data, and per-problem attempts.

Guide narration stays in the guide. Direct manipulation stays in the workspace. Review does not reconstruct correctness in the frontend; it presents evaluations persisted by the runtime.

## Progressive disclosure

- Learn reveals step titles up front and expands one current teaching action at a time.
- Practice shows the current goal and compact step titles. Hints are learner-requested.
- Review shows score, one core diagnosis, and the next action first. Weak-problem replay, submissions, trends, and history appear only after the learner opens deep review.

## Content switching

The task drawer is the content switcher. Choosing another task navigates to its Learn route. From there the learner explicitly starts or resumes Practice. Review record selection changes only `sessionId` and never starts a session.
