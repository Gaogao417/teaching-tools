# Frontend Agent Style Contract

This file defines how Codex/Claude should implement UI changes inside `web/frontend`.

## Scope

- Applies to all React and Vite frontend work under `web/frontend`.
- Applies when creating new UI, editing existing UI, or refactoring markup.
- This file is a local implementation contract for agents. Product and architecture truth still lives in the repo-root `docs/`.

## Source Of Truth

Frontend styling must come from these files first:

- `frontend/src/styles.css`
- `frontend/src/styles/`

Agents must treat these files as the primary styling system for:

- design tokens
- spacing
- colors
- typography
- layout primitives
- reusable surface, button, grid, and state classes

## Required Workflow Before Writing JSX

Before adding or changing frontend markup, the agent must:

1. Read the relevant existing component.
2. Inspect the existing classes already used nearby.
3. Check the shared style files for reusable classes or tokens.
4. Reuse existing class combinations before creating any new style rule.

The default assumption is: the style system already exists and should be composed, not reinvented.

## Hard Rules

- Reuse existing classes and CSS variables before adding anything new.
- Prefer composing existing utility-like and shared semantic classes such as `panel`, `btn`, `btn-primary`, `btn-secondary`, `btn-ghost`, `text-muted`, `metric-grid`, `action-row`, and existing layout shells.
- Prefer existing tokens like `--space-*`, `--radius-*`, `--color-*`, `--text-*`, `--border-*`, `--fill-*`, and `--shadow-*`.
- Keep styling centralized in the existing shared stylesheet files.
- If new styling is required, add it to one of the existing shared stylesheet files.
- New CSS must be reusable and named to fit the existing convention.
- New JSX should primarily express appearance through class composition, not one-off styling logic.

## Not Allowed

- Do not use inline styles such as `style={{ ... }}` unless there is no reasonable CSS-based alternative and the value is truly runtime-only.
- Do not add ad hoc `<style>` blocks.
- Do not create new CSS files for a single component or page when the shared style files can be extended instead.
- Do not invent a separate visual system with new spacing, radius, color, or shadow values when equivalent tokens already exist.
- Do not hardcode colors, spacing, or radii in components when a shared token can be used.
- Do not add page-specific classes when a more reusable layout or surface class would solve the same problem.

## Allowed Extensions

When existing styles are not enough, extend the shared style system in this order:

1. Reuse an existing token or class as-is.
2. Add or refine a shared CSS variable in `styles.css` if the missing value is a real design token.
3. Add a reusable layout, surface, or state class in `styles.css` or `styles/pages.css`.
4. Add feature-specific shared styles in `styles/practice.css` only when the behavior is truly practice-runtime-specific.

Every new style rule should be written so future screens can reuse it.

## Decision Heuristics

- If a class is useful across screens, prefer `styles.css`.
- If a class is mainly for app/page shells, panels, lists, or navigation layouts, prefer `styles/pages.css`.
- If a class is specific to the runtime practice workspace, feedback effects, or exercise scene, prefer `styles/practice.css`.

## Definition Of Done For Frontend Changes

A frontend change is not complete unless all of the following are true:

- Existing shared classes were checked first.
- Existing design tokens were reused where possible.
- Any new CSS was added to an existing shared stylesheet.
- No unnecessary inline styles or one-off CSS files were introduced.
- The resulting markup still matches the current visual language of the app.

## Review Checklist

When reviewing frontend work, the agent should verify:

- Are existing `styles/*.css` classes being reused?
- Are shared tokens used instead of hardcoded values?
- Could any newly added class be generalized further?
- Was any styling added inside component code that should live in shared CSS instead?
- Does the final UI still feel like the same product?
