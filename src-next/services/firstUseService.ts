import { invokeCommand } from "./client";

export type GuideMethod = "system" | "process";

export interface GuideProgress {
  dismissed: boolean;
  method: GuideMethod | null;
}

export interface FirstUseStatus {
  confirmed: boolean;
  noticeVersion: number;
  confirmationPhrase: string;
  guide: GuideProgress;
}

export function getFirstUseStatus(): Promise<FirstUseStatus | null> {
  return invokeCommand("get_first_use_status");
}

export function confirmFirstUse(version: number, phrase: string): Promise<FirstUseStatus> {
  return invokeCommand("confirm_first_use", { version, phrase });
}

export function exitFirstUse(): Promise<void> {
  return invokeCommand("exit_first_use");
}

export function saveGuideProgress(guide: GuideProgress): Promise<void> {
  return invokeCommand("save_guide_progress", { guide });
}
