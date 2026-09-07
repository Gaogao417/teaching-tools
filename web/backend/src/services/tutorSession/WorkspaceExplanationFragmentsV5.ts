/** Persisted planned content registration. Shared by replay and isolated preflight. */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { presentationPlanV4Schema, workspaceRuntimeStateV2Schema } from "../../../../shared/canonical";
import { WorkspaceRuntimeReducerError, type WorkspaceFold } from "./WorkspaceRuntimeReducerV5";

type Plan = z.infer<typeof presentationPlanV4Schema>;
type Fragment = NonNullable<Plan["explanation_fragments"]>[number];
export function explanationFragmentContentHash(fragment: Fragment): string {
  const sorted = Object.fromEntries(Object.entries(fragment).sort(([a], [b]) => a.localeCompare(b)));
  return `sha256:${createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex")}`;
}

export function registerWorkspaceExplanationFragmentsV5(fold: WorkspaceFold, plan: Pick<Plan,
  "sequence_id" | "explanation_fragments" | "existing_fragment_refs">): WorkspaceFold {
  const fail = (message: string): never => { throw new WorkspaceRuntimeReducerError("WORKSPACE_STREAM_INVARIANT", message); };
  const stored = fold.state.schema === "ai_teaching_workspace_runtime_state/v2"
    ? fold.state.solution_board.explanation_fragments ?? [] : [];
  const ids = new Set(stored.map((f) => f.fragment_id));
  const sources = new Map(fold.context.fragmentSources);
  const added = (plan.explanation_fragments ?? []).map((fragment) => {
    if (ids.has(fragment.fragment_id)) fail(`duplicate immutable fragment ${fragment.fragment_id}`);
    ids.add(fragment.fragment_id);
    sources.set(fragment.fragment_id, { source_sequence_id: plan.sequence_id, content_hash: explanationFragmentContentHash(fragment) });
    return { ...structuredClone(fragment), visible: false };
  });
  for (const ref of plan.existing_fragment_refs ?? []) {
    const source = fold.context.fragmentSources?.get(ref.fragment_id);
    const fragment = stored.find((f) => f.fragment_id === ref.fragment_id);
    if (!source || !fragment || source.source_sequence_id !== ref.source_sequence_id || source.content_hash !== ref.content_hash) {
      fail(`missing or corrupt existing fragment ${ref.fragment_id}`);
    }
    const { visible: _visible, ...content } = fragment!;
    if (!content.origin_generation || explanationFragmentContentHash(content as Fragment) !== ref.content_hash) {
      fail(`corrupt immutable fragment content ${ref.fragment_id}`);
    }
  }
  if (!added.length) return fold;
  const parsed = workspaceRuntimeStateV2Schema.safeParse({ ...fold.state,
    schema: "ai_teaching_workspace_runtime_state/v2",
    solution_board: { ...fold.state.solution_board, explanation_fragments: [...stored, ...added] },
  });
  if (!parsed.success) return fail(`corrupt planned fragment content: ${parsed.error.message}`);
  return { state: parsed.data, context: { ...fold.context, fragmentSources: sources } };
}
