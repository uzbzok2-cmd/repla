import type { IeltsSessionState, IeltsSection } from "./types.js";

// In-memory exam session state (per chatId)
const sessions = new Map<number, IeltsSessionState>();

// Admin state: which admin action is pending
export type AdminAction =
  | { type: "none" }
  | { type: "awaiting_exam_title" }
  | { type: "awaiting_audio"; examId: number; partNumber: number }
  | { type: "awaiting_reading_text"; examId: number; passageNumber: number; title?: string }
  | { type: "confirming_exam"; examId: number };

const adminActions = new Map<number, AdminAction>();

export function getIeltsSession(chatId: number): IeltsSessionState | null {
  return sessions.get(chatId) ?? null;
}

export function setIeltsSession(chatId: number, state: IeltsSessionState): void {
  sessions.set(chatId, state);
}

export function clearIeltsSession(chatId: number): void {
  sessions.delete(chatId);
}

export function getAdminAction(chatId: number): AdminAction {
  return adminActions.get(chatId) ?? { type: "none" };
}

export function setAdminAction(chatId: number, action: AdminAction): void {
  adminActions.set(chatId, action);
}

export function clearAdminAction(chatId: number): void {
  adminActions.set(chatId, { type: "none" });
}

// Payment state for IELTS (separate from tutor payment)
const ieltsPaymentPending = new Map<number, { chatId: number; firstName: string; username?: string }>();

export function setIeltsPaymentPending(chatId: number, firstName: string, username?: string): void {
  ieltsPaymentPending.set(chatId, { chatId, firstName, username });
}

export function getIeltsPaymentPending(chatId: number) {
  return ieltsPaymentPending.get(chatId) ?? null;
}

export function clearIeltsPaymentPending(chatId: number): void {
  ieltsPaymentPending.delete(chatId);
}

export function allIeltsPaymentPending() {
  return [...ieltsPaymentPending.values()];
}

// Track which section results have been collected
export interface SectionTimer {
  section: IeltsSection;
  deadlineMs: number;
  timerId?: ReturnType<typeof setTimeout>;
}

const sectionTimers = new Map<number, SectionTimer>();

export function setSectionTimer(chatId: number, timer: SectionTimer): void {
  const existing = sectionTimers.get(chatId);
  if (existing?.timerId) clearTimeout(existing.timerId);
  sectionTimers.set(chatId, timer);
}

export function clearSectionTimer(chatId: number): void {
  const existing = sectionTimers.get(chatId);
  if (existing?.timerId) clearTimeout(existing.timerId);
  sectionTimers.delete(chatId);
}

export function getSectionTimer(chatId: number): SectionTimer | null {
  return sectionTimers.get(chatId) ?? null;
}
