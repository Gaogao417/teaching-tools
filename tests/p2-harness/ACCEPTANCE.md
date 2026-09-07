# Harness acceptance — 2026-09-07

Product baseline: `976c7a6c692fa2d882e9ae3c9cd6d7665ee3401c`.

Final `node tests/p2-harness/run.mjs`: exit 0; all 9 stages pass, no skips or missing required cases. Backend 49 node:test cases, frontend 21 Vitest cases, independent context 5 assertions (75 total), backend build and frontend typecheck pass. Evidence: `evidence/summary.json` and per-stage logs.

Sensitivity check: extract product revision `59b8432` into a temporary directory, overlay this harness only, share installed dependencies without modifying them. Run the same frontend handshake assertions: 3 assertion failures. Load the old ContextBuilder source via tsx for the same context assertions: 4 assertion failures and 1 authorized positive control passes. No failure due to missing modules is counted. These targeted controls validate A1/A2/B5/B6 sensitivity, not every B regression.

Harness accepted as a deterministic boundary regression entry point. P2/S2/G7 acceptance remains separate; see README scope limits. No product fixes are included in this commit.
