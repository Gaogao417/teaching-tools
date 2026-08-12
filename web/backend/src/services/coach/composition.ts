import { CosyVoiceSpeechSynthesizer } from "./adapters/CosyVoiceSpeechSynthesizer";
import { NarrationApplication } from "./application/NarrationApplication";

export const narrationApplication = new NarrationApplication(new CosyVoiceSpeechSynthesizer());
