import { TaskId } from "../../../shared/contracts";

const STUDENT_KEY = "trig-web-student-name";

export function getStudentName() {
  return localStorage.getItem(STUDENT_KEY) || "";
}

export function setStudentName(name: string) {
  localStorage.setItem(STUDENT_KEY, name);
}

export function getSessionKey(taskId: TaskId) {
  return `trig-web-session-${taskId}`;
}

export function getStoredSessionId(taskId: TaskId) {
  return localStorage.getItem(getSessionKey(taskId)) || "";
}

export function setStoredSessionId(taskId: TaskId, sessionId: string) {
  localStorage.setItem(getSessionKey(taskId), sessionId);
}

export function clearStoredSessionId(taskId: TaskId) {
  localStorage.removeItem(getSessionKey(taskId));
}

const VOICE_MODEL_KEY = "trig-web-voice-model";

export type VoiceModelOption = "omni" | "cosyvoice";

export function getVoiceModel(): VoiceModelOption {
  return localStorage.getItem(VOICE_MODEL_KEY) === "cosyvoice" ? "cosyvoice" : "omni";
}

export function setVoiceModel(model: VoiceModelOption) {
  localStorage.setItem(VOICE_MODEL_KEY, model);
}
