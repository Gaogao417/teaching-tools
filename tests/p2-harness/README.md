# P2 boundary acceptance harness

Run from any directory with Node/npm and the repository dependencies installed:

```sh
node /path/to/teaching-tools/tests/p2-harness/run.mjs
```

For golden sessions, set `TUTOR_E2E_CANONICAL_ROOT` to the approved canonical-authoring root. Existing test helpers retain their local default. Missing assets are a failure, never a skip.

The runner builds backend first (no stale dist acceptance), typechecks frontend, runs every selected suite even after another fails, and exits nonzero on failures, timeouts, missing required case names, skipped/todo tests or empty frontend runs. Each invocation creates a unique temporary evidence directory with raw logs, revision and summary.json. Provider secrets are removed from child environments; provider configuration tests use synthetic credentials and intercepted fetch.

| Requirement | Executed evidence |
|---|---|
| A1 rejected control | independent handshake: 403/409; existing hook suite also covers 5xx |
| A2 pending outcome | independent deferred outcome assertion + accepted/rejected hook cases |
| B1 question/history input | v9GenerationSession, real golden/kernel and captured model payload |
| B2 concurrent owner / CAS / lost acknowledgement / cancellation | generationCoordinator, real SQLite/kernel and controlled pipeline |
| B3 presenter pin | v9GenerationSession, changed pin refusal and matching pin control |
| B4 explicit generation retry | v9GenerationSession, fresh budget and preserved failure record |
| B5 context budgets | independent context assertions plus production regression suite |
| B6 answer boundary | independent private conclusion rejection and authorized positive control |
| B7 provider isolation | presentationGenerationPipeline, missing/dual synthetic credentials |
| Pending polling | useTutorLearning.generation suite |

The independent tests assert desired behavior: no expected-failure annotation, skip, or assertion that a bug should exist. They were checked against 59b8432: all three handshake cases and four context negative cases fail by assertions; the authorized context control passes. On 976c7a6 they pass. Other B cases are the actual rework regression suites, not new independent proofs of every implementation detail.

## Additional S2 rework coverage

The runner now includes R1's second distinct question, R2's actual child-process exit and expired-lease takeover, late-owner fencing, pending explicit recovery, background database scanning, and R3 epoch rollback. Dynamic board tests cover execution/rebuild and a real v9 session's planned → applied → outcome chain. v7 tests cover publication, anchored import and materialization in a temporary root.

## Scope limits

This gate remains deterministic boundary regression. Model/media ports are controlled; it does not establish real microphone, ASR or live provider quality. The v7 publication test uses conspicuously synthetic test approval, never changes production assets, and cannot replace human review of the real candidate. Browser/provider and real approved-asset evidence must be recorded separately for the applicable project milestone.

The original harness was committed separately from product fixes. These runner additions exercise the subsequent S2 repairs without treating test-only assets as approved production content.
