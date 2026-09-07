/** Local renderer boundary, never a wire schema or a source of mathematical truth.
 * A validated student-safe projection supplies glyphs; this layer only lays out
 * their already-authorized content and reports actual DOM/animation completion. */
export interface VisualRenderIdentity {
  sessionId: string;
  executionKey: string;
  visualRevision: number;
  targetDigest: string;
  surfaceGeneration: number;
  operation: "installed" | "entrance-complete" | "removed";
}

export interface VisualRenderReceipt extends VisualRenderIdentity {}

export interface VisualRenderExecution extends VisualRenderIdentity {
  abort: AbortSignal;
  /** Only the currently delivered focus action may request entrance animation. */
  pulseIds?: readonly string[];
}

export interface PixelPoint { x: number; y: number }

interface GlyphBase {
  id: string;
  /** Resolved visible owner keys, not locally invented leases. */
  ownerKeys: readonly string[];
  color: string;
  description: string;
}

export type VisualGlyph = GlyphBase & (
  | { kind: "path"; points: readonly PixelPoint[]; closed?: boolean }
  | { kind: "angle"; vertex: PixelPoint; rays: readonly [PixelPoint, PixelPoint]; arcCount: 1 | 2 }
  | { kind: "label"; anchor: PixelPoint; text: string }
);

export interface VisualRenderScene {
  width: number;
  height: number;
  glyphs: readonly VisualGlyph[];
}

export class VisualRenderError extends Error {
  constructor(readonly kind: "layout" | "aborted" | "stale-surface" | "identity" | "residual", message: string) {
    super(message);
    this.name = "VisualRenderError";
  }
}

export function sameVisualRenderIdentity(a: VisualRenderIdentity, b: VisualRenderIdentity): boolean {
  return a.sessionId === b.sessionId && a.executionKey === b.executionKey
    && a.visualRevision === b.visualRevision && a.targetDigest === b.targetDigest
    && a.surfaceGeneration === b.surfaceGeneration && a.operation === b.operation;
}
