import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionContract, ExercisePlan } from "../../../../../shared/actionRuntime";
import { useTeacherSpeech, type TeacherSpeech } from "../useTeacherSpeech";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// vi.hoisted makes the mock function available at hoist time so the static
// import of useTeacherSpeech (which imports the api client) sees the mock.
const { synthesizeActionSpeech } = vi.hoisted(() => ({ synthesizeActionSpeech: vi.fn() }));
vi.mock("../../../api/client", () => ({ api: { synthesizeActionSpeech } }));

class FakeAudio {
  src = "";
  preload = "";
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}
let fakeAudio: FakeAudio;
let OriginalAudio: typeof Audio;

beforeEach(() => {
  synthesizeActionSpeech.mockReset();
  synthesizeActionSpeech.mockResolvedValue({ audioUrl: "https://example/voice.mp3", model: "m", voice: "v" });
  fakeAudio = new FakeAudio();
  OriginalAudio = globalThis.Audio;
  // A real constructor (not an arrow fn) that returns the shared instance, so
  // `new Audio()` yields the same fake whose play/pause we assert against.
  const instance = fakeAudio;
  function FakeAudioCtor(this: unknown) { return instance; }
  globalThis.Audio = FakeAudioCtor as unknown as typeof Audio;
});
afterEach(() => {
  globalThis.Audio = OriginalAudio;
});

function plan(mode: ExercisePlan["mode"], action: ActionContract): ExercisePlan {
  return {
    planVersion: 4, exerciseId: "e", revision: 0, mode,
    metadata: { taskId: "t", title: "t", promptLatex: "p", skillTags: [] },
    world: { revision: 0 },
    coach: { profileId: "c", displayName: "老师", avatarId: "school", tone: "supportive" },
    actions: [action], currentActionId: action.actionId, completedActionIds: [],
  };
}

const learnAction: ActionContract = {
  actionId: "a1", sourceStepId: "s", kind: "enter-text", version: 1, title: "a1", instruction: "第一步",
  input: {}, capabilities: [], answerSlots: [], validationPolicy: "local-teaching", submitOnComplete: false,
} as unknown as ActionContract;

const nextAction: ActionContract = {
  actionId: "a2", sourceStepId: "s2", kind: "enter-text", version: 1, title: "a2", instruction: "第二步",
  input: {}, capabilities: [], answerSlots: [], validationPolicy: "local-teaching", submitOnComplete: false,
} as unknown as ActionContract;

let latest: TeacherSpeech;
function Harness({ p, a }: { p: ExercisePlan; a: ActionContract }) {
  latest = useTeacherSpeech(p, a);
  return null;
}

function mount(p: ExercisePlan, a: ActionContract) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Harness p={p} a={a} />));
  return { root, container };
}

describe("useTeacherSpeech", () => {
  it("synthesizes the teacher copy once per action switch and autoplays in Learn", async () => {
    const { root, container } = mount(plan("learn", learnAction), learnAction);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(synthesizeActionSpeech).toHaveBeenCalledTimes(1);
    expect(synthesizeActionSpeech).toHaveBeenCalledWith(expect.objectContaining({ text: "第一步" }));
    expect(fakeAudio.play).toHaveBeenCalledTimes(1); // Learn auto-plays
    synthesizeActionSpeech.mockClear();
    fakeAudio.play.mockClear();

    // Re-rendering the SAME action must not synthesize or play again.
    act(() => root.render(<Harness p={plan("learn", learnAction)} a={learnAction} />));
    await act(async () => { await Promise.resolve(); });
    expect(synthesizeActionSpeech).not.toHaveBeenCalled();
    expect(fakeAudio.play).not.toHaveBeenCalled();

    // Switching to a new action synthesizes the new copy.
    act(() => root.render(<Harness p={plan("learn", nextAction)} a={nextAction} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(synthesizeActionSpeech).toHaveBeenCalledWith(expect.objectContaining({ text: "第二步" }));
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("synthesizes but does not force autoplay in Guided Practice", async () => {
    const { container, root } = mount(plan("guided-practice", learnAction), learnAction);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(synthesizeActionSpeech).toHaveBeenCalledTimes(1);
    expect(fakeAudio.play).not.toHaveBeenCalled(); // no forced autoplay
    expect(latest.speechUrl).toBe("https://example/voice.mp3"); // replay available
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("does not auto-read teaching text in Assessment", async () => {
    const { container, root } = mount(plan("assessment", learnAction), learnAction);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(synthesizeActionSpeech).not.toHaveBeenCalled();
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("replay works after a voice has loaded", async () => {
    const { container, root } = mount(plan("guided-practice", learnAction), learnAction);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fakeAudio.play.mockClear();
    act(() => latest.replay());
    expect(fakeAudio.play).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("a coach reply via speak() supersedes pending entry synthesis and plays", async () => {
    let resolveSynthesis: (value: unknown) => void = () => undefined;
    synthesizeActionSpeech.mockReturnValueOnce(new Promise((resolve) => { resolveSynthesis = resolve; }));
    const { container, root } = mount(plan("learn", learnAction), learnAction);
    await act(async () => { await Promise.resolve(); });
    // While entry synthesis is still pending, a coach reply arrives and wins.
    fakeAudio.play.mockClear();
    act(() => latest.speak("https://example/coach-reply.mp3"));
    expect(fakeAudio.src).toBe("https://example/coach-reply.mp3");
    expect(fakeAudio.play).toHaveBeenCalledTimes(1);
    // The stale entry synthesis resolving later must NOT override the coach reply.
    fakeAudio.play.mockClear();
    await act(async () => { resolveSynthesis({ audioUrl: "https://example/stale.mp3", model: "m", voice: "v" }); await Promise.resolve(); });
    expect(fakeAudio.src).toBe("https://example/coach-reply.mp3");
    expect(fakeAudio.play).not.toHaveBeenCalled();
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("survives a TTS failure without throwing or blocking", async () => {
    synthesizeActionSpeech.mockRejectedValueOnce(new Error("network"));
    const { container, root } = mount(plan("learn", learnAction), learnAction);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(latest.speechUrl).toBeUndefined(); // degraded silently; replay unavailable
    act(() => root.unmount());
    document.body.removeChild(container);
  });
});
