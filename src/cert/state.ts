import type { CertSessionState } from "./types.js";

const sessions = new Map<number, CertSessionState>();
const paymentPending = new Map<number, { chatId: number; level: string; firstName: string; username?: string; phone?: string }>();
const readyToStart = new Map<number, { userExamId: number; level: string }>();

export type CertAdminAction =
  | { type: "none" }
  | { type: "awaiting_audio"; userExamId: number; level: string; part: number };

const adminActions = new Map<number, CertAdminAction>();

export function getCertSession(chatId: number): CertSessionState | null {
  return sessions.get(chatId) ?? null;
}
export function setCertSession(chatId: number, s: CertSessionState): void {
  sessions.set(chatId, s);
}
export function clearCertSession(chatId: number): void {
  sessions.delete(chatId);
}

export function setCertPaymentPending(chatId: number, level: string, firstName: string, username?: string, phone?: string): void {
  paymentPending.set(chatId, { chatId, level, firstName, username, phone });
}
export function getCertPaymentPending(chatId: number) {
  return paymentPending.get(chatId) ?? null;
}
export function clearCertPaymentPending(chatId: number): void {
  paymentPending.delete(chatId);
}

export function setReadyToStart(chatId: number, userExamId: number, level: string): void {
  readyToStart.set(chatId, { userExamId, level });
}
export function getReadyToStart(chatId: number) {
  return readyToStart.get(chatId) ?? null;
}
export function clearReadyToStart(chatId: number): void {
  readyToStart.delete(chatId);
}

export function getCertAdminAction(chatId: number): CertAdminAction {
  return adminActions.get(chatId) ?? { type: "none" };
}
export function setCertAdminAction(chatId: number, action: CertAdminAction): void {
  adminActions.set(chatId, action);
}
export function clearCertAdminAction(chatId: number): void {
  adminActions.set(chatId, { type: "none" });
}

export interface SectionTimer {
  timerId?: ReturnType<typeof setTimeout>;
  deadlineMs: number;
}
const sectionTimers = new Map<number, SectionTimer>();

export function setCertTimer(chatId: number, t: SectionTimer): void {
  const ex = sectionTimers.get(chatId);
  if (ex?.timerId) clearTimeout(ex.timerId);
  sectionTimers.set(chatId, t);
}
export function clearCertTimer(chatId: number): void {
  const ex = sectionTimers.get(chatId);
  if (ex?.timerId) clearTimeout(ex.timerId);
  sectionTimers.delete(chatId);
}
