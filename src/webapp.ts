import crypto from "crypto";
import type TelegramBot from "node-telegram-bot-api";

export interface ExamWebSession {
  userId: number;
  examType: "ielts" | "cert";
  userExamId: number;
  examId?: number;
  level?: string;
  writingPromptId?: number;
  writingPromptText?: string;
  started?: boolean;
  notificationMsgId?: number;
}

const sessions = new Map<string, ExamWebSession>();

export function createExamToken(session: ExamWebSession): string {
  const token = crypto.randomBytes(16).toString("hex");
  sessions.set(token, { ...session });
  setTimeout(() => sessions.delete(token), 4 * 60 * 60 * 1000);
  return token;
}

export function getExamSession(token: string): ExamWebSession | null {
  return sessions.get(token) ?? null;
}

export function updateExamSession(token: string, updates: Partial<ExamWebSession>): void {
  const s = sessions.get(token);
  if (s) sessions.set(token, { ...s, ...updates });
}

export function deleteExamSession(token: string): void {
  sessions.delete(token);
}

export function getWebAppUrl(token: string): string {
  const raw = process.env["REPLIT_DEV_DOMAIN"]
    ?? (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]
    ?? "localhost:5000";
  const domain = raw.trim();
  const protocol = domain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${domain}/exam?token=${token}`;
}

let _bot: TelegramBot | null = null;
export function setBotForExam(bot: TelegramBot): void { _bot = bot; }
export function getBotForExam(): TelegramBot | null { return _bot; }
