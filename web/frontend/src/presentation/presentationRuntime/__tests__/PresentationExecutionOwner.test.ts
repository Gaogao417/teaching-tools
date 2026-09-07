import { describe, expect, it, vi } from "vitest";
import { confirmPresentationAuthority, PresentationExecutionOwner } from "../PresentationExecutionOwner";

describe("page execution authorization", () => {
  it("revokes a pending handshake on same-session owner change even when its old promise succeeds", async () => {
    const revoked = vi.fn(); const guard = new PresentationExecutionOwner("page-A", revoked);
    guard.observe("session", { client_instance_id: "page-A", epoch: 1 });
    const capture = guard.capture();
    let resolve!: () => void; const response = new Promise<void>(r => { resolve = r; });
    const openMic = vi.fn(); const pending = response.then(() => { if (guard.permits(capture)) openMic(); });
    guard.observe("session", { client_instance_id: "page-B", epoch: 2 });
    resolve(); await pending;
    expect(revoked).toHaveBeenCalledTimes(1); expect(openMic).not.toHaveBeenCalled();
    expect(capture?.owner).toEqual({ client_instance_id: "page-A", epoch: 1 });
    expect(guard.capture()).toBeUndefined();
  });
  it("a new claim does not revive old tokens, while same-page network reconnection preserves authorization", () => {
    const guard = new PresentationExecutionOwner("page-A", vi.fn());
    guard.observe("session", { client_instance_id: "page-A", epoch: 1 }); const old = guard.capture();
    guard.observe("session", { client_instance_id: "page-A", epoch: 1 }); expect(guard.permits(old)).toBe(true);
    guard.observe("session", { client_instance_id: "page-A", epoch: 3 });
    expect(guard.permits(old)).toBe(false); expect(guard.permits(guard.capture())).toBe(true);
  });
});

it("H33: delayed A cleanup 200 cannot open mic after B claimed, even before A observes B", async () => {
  const guard = new PresentationExecutionOwner("page-A", vi.fn());
  const a = { client_instance_id: "page-A", epoch: 1 };
  const b = { client_instance_id: "page-B", epoch: 2 };
  guard.observe("session", a);
  const captured = guard.capture()!;
  let authority = a;
  let resolveCleanup!: () => void;
  const cleanup = new Promise<void>(resolve => { resolveCleanup = resolve; });
  const mic = vi.fn();
  const read = vi.fn(async () => ({ session_id: "session", presentation_execution_owner: authority, visual_barrier: null }));
  const handshake = (async () => {
    await cleanup;
    if (await confirmPresentationAuthority(guard, captured, read, snapshot => {
      guard.observe(snapshot.session_id, snapshot.presentation_execution_owner); return true;
    })) mic();
  })();
  authority = b; // Server claim; A has received no snapshot or notification.
  expect(guard.permits(captured)).toBe(true);
  expect(read).not.toHaveBeenCalled();
  resolveCleanup(); await handshake;
  expect(read).toHaveBeenCalledExactlyOnceWith("session");
  expect(mic).not.toHaveBeenCalled();
  expect(guard.capture()).toBeUndefined();
});

it("authority read failure cannot release capture", async () => {
  const guard = new PresentationExecutionOwner("page-A", vi.fn());
  guard.observe("session", { client_instance_id: "page-A", epoch: 1 });
  const adopt = vi.fn();
  await expect(confirmPresentationAuthority(guard, guard.capture()!, async () => { throw new Error("offline"); }, adopt)).rejects.toThrow("offline");
  expect(adopt).not.toHaveBeenCalled();
});
