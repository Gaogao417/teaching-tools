import type { VisualExecutionOwner } from "../../../../shared/canonical/visualSchemas";

/** One page instance, not a persisted browser/device identifier. StrictMode and
 * same-page remounts retain it; a full reload creates a different instance. */
let pageInstanceId: string | undefined;
export function presentationClientInstanceId(): string {
  return pageInstanceId ??= `page:${crypto.randomUUID()}`;
}

export function sameExecutionOwner(a: VisualExecutionOwner | undefined, b: VisualExecutionOwner | undefined): boolean {
  return a !== undefined && b !== undefined && a.client_instance_id === b.client_instance_id && a.epoch === b.epoch;
}

export interface CapturedPresentationOwner {
  sessionId: string;
  owner: VisualExecutionOwner;
}

/** Local authorization observation only. Claim/CAS/barriers remain server facts.
 * Every async continuation must validate its captured owner, including a 200. */
export class PresentationExecutionOwner {
  private current?: CapturedPresentationOwner;
  constructor(readonly clientInstanceId: string, private readonly onRevoked: () => void) {}

  observe(sessionId: string, owner: VisualExecutionOwner): void {
    const previous = this.current;
    this.current = { sessionId, owner: { ...owner } };
    if (previous && (previous.sessionId !== sessionId || !sameExecutionOwner(previous.owner, owner))) this.onRevoked();
  }

  capture(): CapturedPresentationOwner | undefined {
    if (!this.current || this.current.owner.client_instance_id !== this.clientInstanceId) return undefined;
    return { sessionId: this.current.sessionId, owner: { ...this.current.owner } };
  }

  permits(capture: CapturedPresentationOwner | undefined): boolean {
    return capture !== undefined && this.current?.sessionId === capture.sessionId
      && capture.owner.client_instance_id === this.clientInstanceId && sameExecutionOwner(this.current.owner, capture.owner);
  }

  reset(): void {
    if (this.current) this.onRevoked();
    this.current = undefined;
  }
}

/** Confirm against a read initiated after cleanup settlement, not its delayed
 * acknowledgement. This does not promise continuous revocation notification. */
export async function confirmPresentationAuthority<T extends { session_id: string; presentation_execution_owner?: VisualExecutionOwner; visual_barrier?: unknown }>(
  guard: PresentationExecutionOwner,
  captured: CapturedPresentationOwner,
  read: (sessionId: string) => Promise<T>,
  adopt: (snapshot: T) => boolean,
): Promise<boolean> {
  if (!guard.permits(captured)) return false;
  const snapshot = await read(captured.sessionId);
  if (!guard.permits(captured) || snapshot.session_id !== captured.sessionId) return false;
  // Adopt a newer owner's authority to suppress this page, but never release it.
  if (!adopt(snapshot)) return false;
  return sameExecutionOwner(snapshot.presentation_execution_owner, captured.owner)
    && !snapshot.visual_barrier && guard.permits(captured);
}
