import type {GenerationCompanion} from './GenerationCompanionStore';
import { TutorSessionKernelCore } from './kernel/TutorSessionKernelCore';
import type { StartSessionInput } from './kernel/TutorSessionStoreCore';
import type { PendingSessionEvent } from './kernel/sessionKernelTypes';
import { makeV10SessionCodec, type V10RegistryProvider } from './RuntimeStateRebuilderV10';
import type { TutorRuntimeStateV10, V10FoldContext } from './TutorRuntimeStateReducerV10';
import type { ResumeV9Options } from './TutorSessionKernelV9';
import { stableVisualJson } from './WorkspaceVisualReducer';
/** V10 assembles the existing transactional kernel and store. */
export class TutorSessionKernelV10 {
  private constructor(private readonly core:TutorSessionKernelCore<TutorRuntimeStateV10,V10FoldContext>) {}
  static start(input:StartSessionInput & {sessionStarted:StartSessionInput["sessionStarted"] & Record<string,unknown>},provider:V10RegistryProvider) { return new TutorSessionKernelV10(TutorSessionKernelCore.start(makeV10SessionCodec(provider),input)); }
  static resume(sessionId:string,provider:V10RegistryProvider,options?:ResumeV9Options) {
    const kernel=new TutorSessionKernelV10(TutorSessionKernelCore.resume(makeV10SessionCodec(provider),sessionId,options));
    if(options?.expectedPresenterPin && stableVisualJson(options.expectedPresenterPin)!==stableVisualJson(kernel.state.pinned_plan.presenter_generation_pin)) throw new Error('PRESENTER_PIN_MISMATCH');
    return kernel;
  }
  get sessionId() { return this.core.sessionId; }
  get state() { return this.core.state; }
  get revision() { return this.core.revision; }
  append(revision:number,events:PendingSessionEvent[],companion?:GenerationCompanion) { return this.core.append(revision,events,companion); }
  rebuild() { return this.core.rebuild(); }
  assertReplayParity() { return this.core.assertReplayParity(); }
}
