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

export interface UserRecord {
  userId: number;
  firstName: string;
  username?: string;
  joinedAt: Date;
  lastSeen: Date;
}

export type PaymentState = "idle" | "selecting_language" | "waiting_receipt" | "help_mode";

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
// all users registry
const userRegistry = new Map<number, UserRecord>();
// admin chat ID
let adminChatId: number | null = null;

// ── Admin ────────────────────────────────────────────────────────────
export function setAdminChatId(id: number) { adminChatId = id; }
export function getAdminChatId() { return adminChatId; }

// ── User registry ────────────────────────────────────────────────────
export function registerUser(userId: number, firstName: string, username?: string): void {
  if (!userRegistry.has(userId)) {
    userRegistry.set(userId, { userId, firstName, username, joinedAt: new Date(), lastSeen: new Date() });
  } else {
    const u = userRegistry.get(userId)!;
    u.lastSeen = new Date();
    if (username) u.username = username;
  }
}

export function getAllUsers(): UserRecord[] { return [...userRegistry.values()]; }
export function getUserCount(): number { return userRegistry.size; }

export function getSubscribedUsersCount(lang?: LearningMode): number {
  let count = 0;
  for (const [uid] of userRegistry) {
    if (lang) {
      if (isSubscribed(uid, lang)) count++;
    } else {
      if (LANGUAGES.some((l) => isSubscribed(uid, l.key))) count++;
    }
  }
  return count;
}

export function getUnsubscribedCount(): number {
  let count = 0;
  for (const [uid] of userRegistry) {
    if (!LANGUAGES.some((l) => isSubscribed(uid, l.key))) count++;
  }
  return count;
}

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

export function tryGiveBonus(referrerId: number, newUserId: number): boolean {
  if (!bonusPaid.has(referrerId)) bonusPaid.set(referrerId, new Set());
  const set = bonusPaid.get(referrerId)!;
  if (set.has(newUserId)) return false;
  set.add(newUserId);
  addFreeBonus(referrerId, 3);
  return true;
}

// ── Formatted status ─────────────────────────────────────────────────
export function formatStatus(userId: number): string {
  const lines = ["╔══════════════════════╗\n   📊 OBUNA HOLATI\n╚══════════════════════╝\n"];
  for (const { key, flag, label } of LANGUAGES) {
    if (isSubscribed(userId, key)) {
      const exp = getExpiry(userId, key)!;
      const days = Math.ceil((exp.getTime() - Date.now()) / 86400000);
      lines.push(`${flag} ${label}\n   ✅ Faol — ${days} kun qoldi`);
    } else {
      const left = getFreeLeft(userId, key);
      lines.push(left > 0
        ? `${flag} ${label}\n   🆓 ${left} ta bepul xabar qoldi`
        : `${flag} ${label}\n   ❌ Obuna kerak`
      );
    }
  }
  return lines.join("\n\n");
}

// ── Admin full stats ─────────────────────────────────────────────────
export function formatAdminStats(): string {
  const total = getUserCount();
  const subscribed = getSubscribedUsersCount();
  const unsubscribed = getUnsubscribedCount();
  const pending = allPending();

  let text = `╔══════════════════════╗\n🔐 ADMIN PANEL\n╚══════════════════════╝\n\n`;
  text += `👥 <b>FOYDALANUVCHILAR:</b>\n`;
  text += `┣ Jami a'zolar: <b>${total}</b>\n`;
  text += `┣ Faol obunalar: <b>${subscribed}</b>\n`;
  text += `┗ Obunasizlar: <b>${unsubscribed}</b>\n\n`;

  text += `🌍 <b>TILLAR BO'YICHA OBUNALAR:</b>\n`;
  for (const { key, flag, label } of LANGUAGES) {
    const count = getSubscribedUsersCount(key);
    text += `┣ ${flag} ${label}: <b>${count} ta</b>\n`;
  }

  text += `\n⏳ <b>KUTILAYOTGAN TO'LOVLAR: ${pending.length} ta</b>`;
  if (pending.length > 0) {
    text += `\n`;
    for (const p of pending) {
      const name = p.username ? `@${p.username}` : p.firstName;
      text += `\n👤 ${name} (<code>${p.userId}</code>)\n`;
      text += `🌍 ${LANGUAGES.find(l => l.key === p.language)?.flag} ${p.language}\n`;
      text += `✅ /confirm_${p.userId}_${p.language}  ❌ /reject_${p.userId}\n`;
    }
  }

  return text;
}
