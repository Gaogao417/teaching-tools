import { CosyVoiceSpeechSynthesizer } from "./adapters/CosyVoiceSpeechSynthesizer";
import { ClaudeCodeTextCoachEngine } from "./adapters/ClaudeCodeTextCoachEngine";
import { NarrationApplication } from "./application/NarrationApplication";
import { CoachTurnApplication } from "./application/CoachTurnApplication";
import { SegmentPolicy } from "./application/SegmentPolicy";

/**
 * Composition root for the coach services. Concrete providers are chosen here
 * (and only here); the rest of the backend depends on ports and the
 * provider-neutral shared contract.
 */
const speechSynthesizer = new CosyVoiceSpeechSynthesizer();

export const narrationApplication = new NarrationApplication(speechSynthesizer);

export const coachTurnApplication = new CoachTurnApplication({
  text: new ClaudeCodeTextCoachEngine(),
  speech: speechSynthesizer,
  policy: new SegmentPolicy(),
});
