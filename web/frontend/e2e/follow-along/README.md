# C3 Teach browser harness

Run from `web/frontend`:

```sh
NODE_PATH=../backend/node_modules npx playwright test --config=playwright.follow-along.config.ts
```

`NODE_PATH` resolves the existing backend-installed Zod used by the shared snapshot
parser (the Vite app already has the equivalent alias). No dependency installation
or backend startup is needed. The harness starts its own Vite instance on port 5197;
`FOLLOW_ALONG_UI_PORT` overrides that port. Output goes to
`/private/tmp/c3-follow-along-browser-results` (`FOLLOW_ALONG_UI_OUTPUT` overrides it).

The five Chromium tests cover:

- Six scripted confirm snapshots, natural feedback through Enter and Send, exact
  `utterance/mainline` text, current revision and unique request IDs.
- Confusion, contradictory understanding and skip requests remain original text;
  an unchanged server response cannot be advanced by the frontend.
- Optional control.confirm, assistance questions and the feedback microphone entry.
- Existing answer and workspace exercises do not gain a Teach confirmation bypass.

All `/api/vnext/**` responses are route mocks validated with the existing snapshot
parser. Progression is a preselected response sequence, not a simulated semantic
classifier. This is UI and HTTP payload evidence, not real-model, backend Gate,
real-microphone or ASR-quality evidence. ASR capture/stale/outcome behavior remains
covered by the frontend unit tests. No real registry is accessed or changed.

## Isolated real-service follow-up assessment

The existing backend test helper `createSyntheticFollowAlongRoot` in
`services/planBuild/__tests__/teachFollowAlongTestSupport.ts` copies source assets,
publishes synthetic-approved test artifacts only in a temporary root and supplies
cleanup. An isolated HTTP run could use that root, a temporary SQLite database and
separate ports. Import database-dependent modules only after configuring SQLite.

The current HTTP scripted Gate (`VNextGateModelFactory`) returns `final_answer`;
it does not supply the understanding-confirmation/restatement semantics exercised
by C4. A full Teach service browser test therefore needs C4's test semantic-port
injection at the service bootstrap, or a separately authorized real-model setup.
This harness does not start that service or claim that chain has passed.
