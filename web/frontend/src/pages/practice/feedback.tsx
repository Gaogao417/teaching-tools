import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FeedbackEffectKey } from "../../../../shared/contracts";

const AUDIO_BY_KIND: Record<FeedbackEffectKey, string> = {
  correct: "/audio/practice-correct.wav",
  wrong: "/audio/practice-wrong.wav",
  finish: "/audio/practice-finish.wav",
};

export function usePracticeFeedback() {
  const [effectKind, setEffectKind] = useState<"" | FeedbackEffectKey>("");
  const timeoutRef = useRef<number | null>(null);
  const audioRef = useRef<Record<FeedbackEffectKey, HTMLAudioElement | null>>({
    correct: null,
    wrong: null,
    finish: null,
  });
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    const unlock = () => {
      const nextAudio = {
        correct: new Audio(AUDIO_BY_KIND.correct),
        wrong: new Audio(AUDIO_BY_KIND.wrong),
        finish: new Audio(AUDIO_BY_KIND.finish),
      };
      Object.values(nextAudio).forEach((audio) => {
        audio.preload = "auto";
        audio.load();
      });
      audioRef.current = nextAudio;
      setAudioReady(true);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const prefersReducedMotion = useMemo(
    () => (typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false),
    [],
  );

  const triggerFeedback = (kind: FeedbackEffectKey) => {
    setEffectKind(kind);
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => setEffectKind(""), kind === "finish" ? 1200 : 760);

    if (!audioReady) return;
    const audio = audioRef.current[kind];
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  };

  return { effectKind, triggerFeedback, prefersReducedMotion };
}

export function PracticeEffectsLayer({
  effectKind,
  reducedMotion,
}: {
  effectKind: "" | FeedbackEffectKey;
  reducedMotion: boolean;
}) {
  const particles = effectKind === "finish" ? 18 : effectKind === "correct" ? 10 : 0;
  return (
    <div className={`practice-effects-layer ${effectKind ? `is-${effectKind}` : ""}`} aria-hidden="true">
      {effectKind && <div className={`practice-fx-flash ${effectKind}`} />}
      {effectKind && !reducedMotion && <div className={`practice-fx-ring ${effectKind}`} />}
      {!reducedMotion &&
        Array.from({ length: particles }, (_, index) => (
          <span
            key={`${effectKind}-${index}`}
            className={`practice-fx-particle ${effectKind}`}
            style={
              {
                "--angle": `${(360 / particles) * index}deg`,
                "--distance": effectKind === "finish" ? "220px" : "132px",
                "--delay": `${(index % 4) * 20}ms`,
              } as CSSProperties
            }
          />
        ))}
      {!reducedMotion &&
        effectKind === "finish" &&
        Array.from({ length: 24 }, (_, index) => (
          <span
            key={`confetti-${index}`}
            className="practice-fx-confetti"
            style={
              {
                "--x": `${4 + (index * 91) / 24}%`,
                "--drift": `${-120 + ((index * 37) % 240)}px`,
                "--spin": `${180 + (index % 7) * 60}deg`,
                "--delay": `${(index % 6) * 28}ms`,
              } as CSSProperties
            }
          />
        ))}
    </div>
  );
}
