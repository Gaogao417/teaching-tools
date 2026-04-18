---
name: design-runtime-guard
description: Guard learner-facing design work for the teaching-tools repo. Use when initially designing or reviewing runtime UI, screen structure, guide/workspace ownership, or frontend implementation choices that must respect runtime architecture and the shared style system.
---

# Design Runtime Guard

## Overview

Use this skill before implementing or approving learner-facing UI changes.

This is the repo's design guardrail skill, not a creativity limiter. Be strict about runtime boundaries and shared styling discipline. Be flexible about visual expression and interaction polish once those boundaries are safe.

Read only what you need:
- Read `web/CLAUDE.md` before changing JSX, CSS, or screen structure under `web/frontend`.
- If the task touches practice runtime ownership or learner action flow, also read `exercise-runtime-implementer/references/architecture-checklist.md`.
- Inspect the closest current screen or component and the relevant shared styles before proposing new UI.

## Workflow

1. Classify the change before code.
Choose one:
- `runtime-ui-adjustment`: a local learner-facing change that should fit current primitives
- `screen-redesign`: a broader layout or flow change that still fits current contracts
- `platform-gap`: a request that really needs a new runtime primitive, guide capability, or contract change

2. Protect architecture first.
Confirm:
- the persistent mathematical object stays visible when it should
- guide-step responsibilities stay in the guide
- workspace responsibilities stay in the workspace
- a visual redesign is not being used to smuggle in a new product rule

3. Protect the shared style system.
Before adding markup or CSS:
- inspect nearby components
- inspect `web/frontend/src/styles.css`
- inspect the relevant file in `web/frontend/src/styles/`
- reuse existing classes and tokens before inventing new ones

4. Decide the design latitude.
- If the boundary and style-system checks pass, allow bold interaction and visual exploration.
- If the idea only works by hiding step-local input in exercise-local workspace furniture, reject it.
- If the idea needs a missing runtime capability, say so explicitly instead of approximating it with custom UI.

5. Write a short design note before implementation.
Capture these decisions in your reasoning or summary:
- what must remain stable
- what is safe to redesign
- which shared classes or tokens should be reused
- whether any new shared style is justified
- whether the request is actually a platform gap

## Review Standard

Before finalizing, confirm all of the following:
- The design respects guide/workspace ownership.
- The learner does not lose the core visible object because of a UI flourish.
- Existing shared classes or tokens were checked first.
- Any new style belongs in shared styles, not one-off component styling.
- Any missing runtime capability is named directly, not hidden inside custom frontend behavior.

## Example Requests

- "Review this new runtime screen design before we implement it."
- "We need to redesign the learner UI without breaking guide vs workspace ownership."
- "Check whether this frontend idea is a safe redesign or actually a platform gap."
