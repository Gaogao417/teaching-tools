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

## Scope limits

This gate is **boundary regression**, not S2/G7 acceptance. Media/HTTP/model ports are controlled for race determinism; this does not establish actual microphone, ASR, live provider, or full HTTP/browser generation integration. Board preflight's rejection test only proves fail-closed behavior, not dynamic board availability. Approved v7 publication/consumption and actual board execution need separate positive journeys.

Worker concurrency in this runner uses two kernel instances in one process. It does not prove process crash/lease expiry/takeover; current coordinator declines an already-claimed running request, so restart recovery remains an explicit uncovered obligation. Do not mark all lifecycle acceptance complete from a green run.

Product repairs and their original regression tests were committed separately before this harness. This directory contains only the independent assertions, runner, config and documentation.
