import type { LearningMode } from "./sessions.js";

export const CARD_NUMBER = "9860 3501 4197 4070";
export const PRICE_UZS = "5 000 so'm";
export const ADMIN_USERNAME = "drector_uz";
export const SUBSCRIPTION_DAYS = 7;
export const FREE_LIMIT = 3;

export const LANGUAGES: { key: LearningMode; label: string; flag: string }[] = [
  { key: "russian", label: "Ruscha", flag: "🇷🇺" },
  { key: "english", label: "Inglizcha", flag: "🇬🇧" },
  { key: "turkish", label: "Turkcha", flag: "🇹🇷" },
];

export interface PendingPayment {
  userId: number;
  firstName: string;
  username?: string;
  language: LearningMode;
  photoFileId: string;
  requestedAt: Date;
}

export type PaymentState = "idle" | "selecting_language" | "waiting_receipt";

export interface PaymentFlow {
  state: PaymentState;
  language?: LearningMode;
}

// userId -> { language -> remaining free messages }
const freeMessages = new Map<number, Map<LearningMode, number>>();
// userId -> { language -> expiry Date }
const subscriptions = new Map<number, Map<LearningMode, Date>>();
// userId -> pending payment
const pendingPayments = new Map<number, PendingPayment>();
// userId -> payment flow state
const paymentFlows = new Map<number, PaymentFlow>();
// referredUserId -> referrerId
const referralMap = new Map<number, number>();
// referrerId -> Set of users they got bonus for
const bonusPaid = new Map<number, Set<number>>();
// admin chat ID (saved when admin uses bot)
let adminChatId: number | null = null;

// ── Admin ────────────────────────────────────────────────────────────
export function setAdminChatId(id: number) { adminChatId = id; }
export function getAdminChatId() { return adminChatId; }

// ── Free messages ────────────────────────────────────────────────────
function initFree(userId: number) {
  if (!freeMessages.has(userId)) {
    freeMessages.set(userId, new Map([
      ["russian", FREE_LIMIT],
      ["english", FREE_LIMIT],
      ["turkish", FREE_LIMIT],
    ]));
  }
}

export function getFreeLeft(userId: number, lang: LearningMode): number {
  initFree(userId);
  return freeMessages.get(userId)!.get(lang) ?? 0;
}

export function consumeFree(userId: number, lang: LearningMode): void {
  initFree(userId);
  const map = freeMessages.get(userId)!;
  const n = map.get(lang) ?? 0;
  if (n > 0) map.set(lang, n - 1);
}

export function addFreeBonus(userId: number, perLang: number): void {
  initFree(userId);
  const map = freeMessages.get(userId)!;
  for (const { key } of LANGUAGES) {
    map.set(key, (map.get(key) ?? 0) + perLang);
  }
}

export function resetFree(userId: number): void {
  freeMessages.delete(userId);
}

// ── Subscriptions ────────────────────────────────────────────────────
export function isSubscribed(userId: number, lang: LearningMode): boolean {
  const exp = subscriptions.get(userId)?.get(lang);
  return !!exp && exp > new Date();
}

export function canSend(userId: number, lang: LearningMode): boolean {
  return isSubscribed(userId, lang) || getFreeLeft(userId, lang) > 0;
}

export function grantAccess(userId: number, lang: LearningMode, days = SUBSCRIPTION_DAYS): void {
  if (!subscriptions.has(userId)) subscriptions.set(userId, new Map());
  const exp = new Date();
  exp.setDate(exp.getDate() + days);
  subscriptions.get(userId)!.set(lang, exp);
}

export function getExpiry(userId: number, lang: LearningMode): Date | null {
  return subscriptions.get(userId)?.get(lang) ?? null;
}

// ── Pending payments ─────────────────────────────────────────────────
export function addPending(p: PendingPayment): void { pendingPayments.set(p.userId, p); }
export function getPending(userId: number): PendingPayment | null { return pendingPayments.get(userId) ?? null; }
export function removePending(userId: number): void { pendingPayments.delete(userId); }
export function allPending(): PendingPayment[] { return [...pendingPayments.values()]; }

// ── Payment flow state ───────────────────────────────────────────────
export function getFlow(userId: number): PaymentFlow { return paymentFlows.get(userId) ?? { state: "idle" }; }
export function setFlow(userId: number, flow: PaymentFlow): void { paymentFlows.set(userId, flow); }
export function clearFlow(userId: number): void { paymentFlows.set(userId, { state: "idle" }); }

// ── Referrals ────────────────────────────────────────────────────────
export function registerReferral(userId: number, referrerId: number): boolean {
  if (referralMap.has(userId) || userId === referrerId) return false;
  referralMap.set(userId, referrerId);
  return true;
}

export function getReferrer(userId: number): number | null { return referralMap.get(userId) ?? null; }

export function tryGiveBonus(referrerId: number, newUserId: number): boolean {
  if (!bonusPaid.has(referrerId)) bonusPaid.set(referrerId, new Set());
  const set = bonusPaid.get(referrerId)!;
  if (set.has(newUserId)) return false;
  set.add(newUserId);
  addFreeBonus(referrerId, 3);
  return true;
}

// ── Status text ──────────────────────────────────────────────────────
export function formatStatus(userId: number): string {
  const lines = ["📊 Sizning obuna holatingiz:\n"];
  for (const { key, flag, label } of LANGUAGES) {
    if (isSubscribed(userId, key)) {
      const exp = getExpiry(userId, key)!;
      const days = Math.ceil((exp.getTime() - Date.now()) / 86400000);
      lines.push(`${flag} ${label}: ✅ Faol (${days} kun qoldi)`);
    } else {
      const left = getFreeLeft(userId, key);
      lines.push(left > 0
        ? `${flag} ${label}: 🆓 ${left} ta bepul xabar qoldi`
        : `${flag} ${label}: ❌ Obuna kerak (5 000 so'm/hafta)`
      );
    }
  }
  lines.push("\n/subscribe — obuna olish");
  lines.push("/referral — do'st taklif qilish");
  return lines.join("\n");
}
