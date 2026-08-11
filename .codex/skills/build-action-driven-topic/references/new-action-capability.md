# New Action capability handoff

Read this only when the approved TopicBlueprint contains `ExtendRuntime`.

1. Invoke `$build-action-runtime-capability` for the missing learner operation or persistent effect.
2. Give it the approved Topic action row as request context, but require a reusable capability boundary independent of the requesting Topic.
3. Require its artifact at `docs/actions/<kind>/action-capability-spec.md` to reach `verified`.
4. Record the resulting registered `kind@version` in the TopicBlueprint and replace `ExtendRuntime ...` with `Reuse kind@version`.
5. Return the TopicBlueprint to `draft` if the new capability changes the approved learner interaction, evidence, diagram effect, SolutionBoard visibility boundary, submit boundary, or mode behavior.

Do not implement the Action inline as a Topic-specific branch. The dedicated skill owns the shared contract, frontend machine, registry, backend evaluator, canonical diagram commands, authoring seam, mode redaction, recovery, and capability-level verification. SolutionBoard prose remains question-owned context and is never part of an Action capability.
