# Experience specification rules

Use this reference only while creating or revising the topic experience specification.

## Source handling

- Read the final or resolved explanation TeX rather than an earlier generated draft.
- Use only ready banks and enabled questions for exercise examples.
- Record exact repository paths, stable question IDs, and asset paths.
- Treat the explanation's step sequence as authoritative. Translate it into learner actions; do not critique, merge, reorder, or replace its pedagogy unless the user explicitly asks.
- Do not create a new learning-problem analysis or learning-objective section. A title or scope sentence may identify the source topic without introducing new teaching claims.

## User flow diagram

Produce the user flow before page structure. Use Mermaid and include the meaningful branches, not only the successful happy path.

Cover as applicable:

- entering the topic and selecting an example;
- advancing through explanation-derived actions;
- incomplete submission;
- correct submission and state retention;
- wrong submission and local correction;
- moving from Learn to Practice;
- completing a practice group and opening Review;
- refresh, exit, and session recovery;
- unavailable or invalid source assets.

Keep the diagram about learner-visible behavior. Do not place implementation modules or API calls in it.

## Page structure

Describe Learn, Practice, and Review separately while identifying shared regions. State:

- where the full stem appears;
- where the persistent mathematical object appears;
- where the current action is performed;
- where explanation steps, hints, and mistake reminders appear;
- what changes or becomes hidden between Learn and Practice;
- what Review shows from immutable results;
- how the structure reflows on narrow screens.

Reuse the repository shell and visual system by default. Define information hierarchy and placement, not a new theme.

## Interaction rules

Write one row for every explanation-derived learner action:

| Source step | Visible object | Learner action | Completion condition | Correct result retained | Wrong correction | Next state | Source asset |
| --- | --- | --- | --- | --- | --- | --- | --- |

Use concrete actions such as selecting a segment, marking a value, constructing a line, pairing corresponding objects, or entering an expression. Do not reduce a mathematical action to a generic method label.

Allow interactions beyond the framework's current primitive list. The specification describes the intended experience, not a pre-negotiated implementation compromise.

## Page states

Include only relevant states, but actively check:

- initial and loading;
- active but incomplete;
- ready to submit;
- correct feedback;
- wrong feedback with prior correct work preserved;
- step complete;
- example or group complete;
- empty or missing content;
- invalid or missing asset;
- network or request failure;
- expired, recoverable, or conflicting session;
- desktop, narrow-screen, touch, and keyboard behavior.

For each state, specify trigger, visible result, available action, retained data, and exit condition.

## Review handoff

End with a short list of real decisions for the user. Do not manufacture questions whose answers follow directly from the explanation. Keep `status: draft` until the user explicitly approves the complete specification.
