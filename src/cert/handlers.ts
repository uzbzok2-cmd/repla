import TelegramBot, { type Message, type ReplyKeyboardMarkup } from "node-telegram-bot-api";
import { createExamToken, getWebAppUrl } from "../webapp.js";
import {
  createCertUserExam, getLatestCertUserExam, getCertUserExamById,
  updateCertStatus, setCertPaymentPhoto, getPendingCertPayments,
  assignPassages, getAssignedPassages, getQuestionsForPassage,
  assignGrammarQuestions, getAssignedGrammarQuestions,
  assignListeningTexts, getAssignedListeningTexts,
  getListeningBank,
  pickRandomWritingPrompt, insertWritingPrompt,
  getSpeakingQuestions,
  saveCertAnswer, countCertCorrect, countCertTotal,
  saveCertWriting, getCertWriting,
  saveCertSpeaking, getCertSpeaking,
  saveCertScores, getCertScores,
  getAllCertUserExams, getCertStats,
  pool,
} from "./db.js";
import {
  getCertSession, setCertSession, clearCertSession,
  setCertPaymentPending, getCertPaymentPending, clearCertPaymentPending,
  setReadyToStart, getReadyToStart, clearReadyToStart,
  setCertTimer, clearCertTimer,
  getCertAdminAction, setCertAdminAction, clearCertAdminAction,
} from "./state.js";
import { evaluateRussianWriting, evaluateRussianSpeaking, transcribeRussian } from "./evaluator.js";
import { generateCertificate, generateCertNumber, formatExamDate } from "./certificate.js";
import { getProfile } from "../registration.js";
import { getAdminChatId } from "../subscription.js";
import type { CertLevel, CertSection, CertQuestion, CertListeningText } from "./types.js";

const CERT_PRICE = "28 000 so'm";
const CERT_CARD  = "9860 3501 4197 4070";
const ADMIN_USER = "drector_uz";

const PASS_THRESHOLD: Record<CertLevel, number> = { B2: 60, C1: 70 };

const SECTION_MINS: Record<string, number> = {
  reading: 60, listening: 40, grammar: 45, writing: 60, speaking: 15,
};

function isCertAdmin(msg: Message): boolean {
  return msg.from?.username === ADMIN_USER;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function mainKb(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🇷🇺 Ruscha" }, { text: "🇬🇧 Inglizcha" }, { text: "🇹🇷 Turkcha" }],
      [{ text: "📊 Obuna holati" }, { text: "💳 Obuna olish" }],
      [{ text: "📝 IELTS Mock Exam" }, { text: "🎓 Rus tili sertifikati" }],
      [{ text: "🔗 Do'st taklif" }, { text: "📈 Statistika" }],
      [{ text: "ℹ️ Yordam" }],
    ],
    resize_keyboard: true,
  };
}

function examKb(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "⏱ Vaqt qoldi?" }, { text: "🏳 Imtihondan chiqish" }]],
    resize_keyboard: true,
  };
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > start) end = nl;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

// ══════════════════════════════════════════════════════════════
// ENTRY POINT
// ══════════════════════════════════════════════════════════════
export async function handleCertEntry(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    `╔══════════════════════════════╗\n` +
    `   🎓 RUS TILI SERTIFIKATI\n` +
    `╚══════════════════════════════╝\n\n` +
    `CEFR xalqaro standartiga mos rus tili sertifikat imtihonlari:\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📘 <b>B2 — Upper-Intermediate</b>\n` +
    `┣ 📖 Чтение (Reading) — 60 min\n` +
    `┣ 🎧 Аудирование (Listening) — 40 min\n` +
    `┣ 📝 Лексика и грамматика — 45 min\n` +
    `┣ ✍️ Письмо (Writing) — 60 min\n` +
    `┗ 🗣 Говорение (Speaking) — 15 min\n\n` +
    `📗 <b>C1 — Advanced</b>\n` +
    `┣ Barcha bo'limlar — yuqori daraja\n` +
    `┗ O'tish bali: 70%\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 Narxi: <b>${CERT_PRICE}</b> (bir martalik)\n` +
    `📜 O'tsangiz: sertifikat beriladi\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👇 Qaysi darajani tanlaysiz?`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📘 B2 sertifikati", callback_data: "cert:choose:B2" },
            { text: "📗 C1 sertifikati", callback_data: "cert:choose:C1" },
          ],
          [{ text: "📋 Mening natijalarim", callback_data: "cert:myresults" }],
        ],
      },
    }
  );
}

// ══════════════════════════════════════════════════════════════
// LEVEL CHOSEN
// ══════════════════════════════════════════════════════════════
export async function handleCertLevelChosen(
  bot: TelegramBot, chatId: number, level: CertLevel, firstName: string, username?: string
): Promise<void> {
  const profile = await getProfile(chatId);
  const phone = profile?.phone_number ?? null;

  const existing = await getLatestCertUserExam(chatId, level);

  if (existing?.status === "payment_pending_approval") {
    await bot.sendMessage(chatId,
      `⏳ <b>${level} to'lovingiz admin tomonidan tekshirilmoqda.</b>\nOdatda 5–15 daqiqa ichida tasdiqlanadi.`,
      { parse_mode: "HTML", reply_markup: mainKb() }
    );
    return;
  }

  if (existing?.status === "ready") {
    const ready = getReadyToStart(chatId);
    if (ready) {
      await sendReadyNotification(bot, chatId, level, existing.id);
      return;
    }
    await sendReadyNotification(bot, chatId, level, existing.id);
    return;
  }

  const activeStatuses = ["reading", "listening", "grammar", "writing", "speaking"];
  if (existing && activeStatuses.includes(existing.status)) {
    await resumeCertExam(bot, chatId, existing);
    return;
  }

  if (existing?.status === "in_progress") {
    await bot.sendMessage(chatId,
      `⚠️ <b>Siz allaqachon ${level} imtihoniga kirdingiz.</b>\n\n` +
      `Imtihon 1 martalik hisoblanadi. Yana topshirish uchun qayta to'lov qiling:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: `💳 Yana ${level} sotib olish`, callback_data: `cert:pay:${level}` },
          ]],
        },
      }
    );
    return;
  }

  if (existing?.status === "completed") {
    const scores = await getCertScores(existing.id);
    if (scores) {
      await sendCertResults(bot, chatId, existing.id, level, scores.reading_score!, scores.listening_score!, scores.grammar_score!, scores.writing_score!, scores.speaking_score!);
      return;
    }
  }

  const levelName = level === "B2" ? "B2 Upper-Intermediate" : "C1 Advanced";

  await bot.sendMessage(
    chatId,
    `📘 <b>RUS TILI ${level} SERTIFIKATI</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📖 Чтение — 3 matn, 30 savol (60 min)\n` +
    `🎧 Аудирование — 4 qism, savollar (40 min)\n` +
    `📝 Лексика и грамматика — 30 savol (45 min)\n` +
    `✍️ Письмо — 1 inshо (60 min)\n` +
    `🗣 Говорение — 3 qism, ovozli (15 min)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🎯 O'tish bali: <b>${PASS_THRESHOLD[level]}%</b>\n` +
    `⚠️ Har to'lov faqat <b>1 urinish</b> uchun amal qiladi\n` +
    `📜 O'tsangiz, sertifikat beriladi\n\n` +
    `💰 Narxi: <b>${CERT_PRICE}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👇 To'lov qilish uchun bosing:`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: `💳 ${level} uchun to'lov qilish`, callback_data: `cert:pay:${level}` },
        ]],
      },
    }
  );
}

// ══════════════════════════════════════════════════════════════
// PAYMENT FLOW
// ══════════════════════════════════════════════════════════════
export async function handleCertPay(
  bot: TelegramBot, chatId: number, level: CertLevel,
  firstName: string, username?: string
): Promise<void> {
  const profile = await getProfile(chatId);
  const phone = profile?.phone_number ?? "Noma'lum";

  let ue = await getLatestCertUserExam(chatId, level);
  if (!ue || ["completed", "expired", "in_progress"].includes(ue.status)) {
    ue = await createCertUserExam(chatId, level, profile?.phone_number ?? null);
  }

  setCertPaymentPending(chatId, level, firstName, username, phone);

  await bot.sendMessage(
    chatId,
    `🎓 <b>RUS TILI ${level} SERTIFIKATI — TO'LOV</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 Narxi: <b>${CERT_PRICE}</b> (bir martalik)\n` +
    `📞 Telefon raqamingiz: <code>${phone}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💳 <b>Quyidagi karta raqamiga to'lov qiling:</b>\n\n` +
    `<code>${CERT_CARD}</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📸 To'lovdan so'ng <b>chek rasmini (skrinshotini) shu yerga yuboring</b>\n\n` +
    `⚡ <b>5–15 daqiqa</b> ichida admin tasdiqlaydi.\n` +
    `Tasdiqlanganidan so'ng siz imtihon boshlanishini o'zingiz tanlaysiz!`,
    { parse_mode: "HTML", reply_markup: mainKb() }
  );
}

export async function handleCertPaymentPhoto(bot: TelegramBot, msg: Message, photoFileId: string): Promise<void> {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name ?? "User";
  const username  = msg.from?.username;
  const pending   = getCertPaymentPending(chatId);
  if (!pending) return;

  const level = pending.level as CertLevel;
  let ue = await getLatestCertUserExam(chatId, level);
  if (!ue) return;

  await setCertPaymentPhoto(ue.id, photoFileId);
  clearCertPaymentPending(chatId);

  const profile = await getProfile(chatId);
  const phone = profile?.phone_number ?? pending.phone ?? "Noma'lum";
  const age = profile?.age ?? "—";
  const gender = profile?.gender ?? "—";
  const fullName = profile?.full_name ?? firstName;

  await bot.sendMessage(
    chatId,
    `✅ <b>Chekingiz qabul qilindi!</b>\n\n` +
    `⏳ Admin tekshirib tasdiqlagandan so'ng sizga xabar yuboriladi.\n` +
    `Odatda <b>5–15 daqiqa</b> ichida.\n\n` +
    `📌 Tasdiqlanganidan so'ng imtihon boshlanishini <b>o'zingiz tanlaysiz</b>!`,
    { parse_mode: "HTML", reply_markup: mainKb() }
  );

  const adminId = getAdminChatId();
  if (adminId) {
    const name = username ? `@${username}` : firstName;
    const caption =
      `💳 <b>YANGI ${level} SERTIFIKAT TO'LOV SO'ROVI!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Ism: <b>${fullName}</b>\n` +
      `📱 Telegram: ${name}\n` +
      `🆔 ID: <code>${chatId}</code>\n` +
      `📞 Tel: <code>${phone}</code>\n` +
      `🎂 Yosh: ${age}\n` +
      `👤 Jins: ${gender}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎓 Daraja: <b>${level}</b>\n` +
      `💰 Summa: ${CERT_PRICE}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━`;
    bot.sendPhoto(adminId, photoFileId, {
      caption,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Tasdiqlash", callback_data: `cert_cb_confirm:${chatId}:${level}` },
          { text: "❌ Rad etish",  callback_data: `cert_cb_reject:${chatId}:${level}` },
        ]],
      },
    }).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════
// ADMIN: CONFIRM / REJECT
// ══════════════════════════════════════════════════════════════
async function confirmCertPayment(bot: TelegramBot, adminChatId: number, userId: number, level: CertLevel): Promise<void> {
  const ue = await getLatestCertUserExam(userId, level);
  if (!ue) { await bot.sendMessage(adminChatId, "❌ Foydalanuvchi topilmadi."); return; }

  await updateCertStatus(ue.id, "ready");
  setReadyToStart(userId, ue.id, level);

  await bot.sendMessage(adminChatId,
    `✅ <b>${level} to'lov tasdiqlandi!</b>\n👤 ID: <code>${userId}</code>`,
    { parse_mode: "HTML" }
  );

  await sendReadyNotification(bot, userId, level, ue.id);
}

async function sendReadyNotification(bot: TelegramBot, chatId: number, level: CertLevel, userExamId: number): Promise<void> {
  const levelName = level === "B2" ? "B2 Upper-Intermediate" : "C1 Advanced";
  const token = createExamToken({ userId: chatId, examType: "cert", userExamId, level });
  const webAppUrl = getWebAppUrl(token);
  const sent = await bot.sendMessage(
    chatId,
    `╔══════════════════════════════╗\n` +
    `   ✅ IMTIHON TAYYOR!\n` +
    `╚══════════════════════════════╝\n\n` +
    `🎓 <b>Rus tili ${levelName} sertifikat imtihoni</b> ochildi!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ Imtihon faqat <b>1 marta</b> topshiriladi.\n` +
    `⏱ Vaqt Web App ichida hisoblanadi.\n` +
    `🌐 Savollar chiroyli interfeyda ko'rinadi.\n` +
    `✅ Variantli savollarda belgi qo'yib javob bering.\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Boshlashga tayyor bo'lsangiz, quyidagi tugmani bosing:`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: `🚀 ${level} imtihonini boshlash`, web_app: { url: webAppUrl } },
        ]],
      },
    }
  );
  // Store message_id so it can be deleted when exam timer starts
  const { updateExamSession } = await import("../webapp.js");
  updateExamSession(token, { notificationMsgId: sent.message_id });
}

// ══════════════════════════════════════════════════════════════
// START EXAM
// ══════════════════════════════════════════════════════════════
export async function startCertExam(bot: TelegramBot, chatId: number, level: CertLevel, userExamId: number): Promise<void> {
  clearReadyToStart(chatId);

  await bot.sendMessage(
    chatId,
    `🎓 <b>RUS TILI ${level} IMTIHONI BOSHLANDI!</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 <b>TARTIB:</b>\n` +
    `1️⃣ 📖 Чтение (Reading) — 60 min\n` +
    `2️⃣ 🎧 Аудирование (Listening) — 40 min\n` +
    `3️⃣ 📝 Лексика и грамматика — 45 min\n` +
    `4️⃣ ✍️ Письмо (Writing) — 60 min\n` +
    `5️⃣ 🗣 Говорение (Speaking) — 15 min\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⚠️ Javoblarni keyin o'zgartirib bo'lmaydi.\n` +
    `⏱ Vaqt tugaganda bo'lim avtomatik yakunlanadi.\n\n` +
    `📖 <b>BIRINCHI BO'LIM: ЧТЕНИЕ boshlandi!</b>`,
    { parse_mode: "HTML", reply_markup: examKb() }
  );

  await new Promise(r => setTimeout(r, 1500));
  await startReading(bot, chatId, level, userExamId);
}

// ══════════════════════════════════════════════════════════════
// READING
// ══════════════════════════════════════════════════════════════
async function startReading(bot: TelegramBot, chatId: number, level: CertLevel, userExamId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_MINS.reading * 60 * 1000;
  await updateCertStatus(userExamId, "reading");

  const passages = await assignPassages(userExamId, level);

  setCertSession(chatId, {
    userExamId, level, section: "reading",
    sectionDeadlineMs: deadlineMs,
    assignedPassageIds: passages.map(p => p.id),
    currentPassageIndex: 0,
    assignedQuestionIds: [],
    assignedListeningPartId: null,
    currentListeningPart: 0,
    writingPromptId: null,
    writingPromptText: "",
    speakingPartNumber: 1,
    speakingCollecting: false,
  });

  setCertTimer(chatId, {
    deadlineMs,
    timerId: setTimeout(() => finishReading(bot, chatId, userExamId, level), SECTION_MINS.reading * 60 * 1000),
  });

  await bot.sendMessage(
    chatId,
    `📖 <b>ЧТЕНИЕ (READING) BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>60 daqiqa</b>\n` +
    `📋 3 ta matn, har birida savollar\n\n` +
    `Ko'rsatma:\n` +
    `• Har savol uchun: <code>1. A</code> yoki <code>1. TRUE</code>\n` +
    `• Bir xabarda bir nechta javob: <code>1. A\n2. FALSE\n3. CERN</code>`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1000));
  await sendReadingPassage(bot, chatId, userExamId, 0);
}

async function sendReadingPassage(bot: TelegramBot, chatId: number, userExamId: number, index: number): Promise<void> {
  const sess = getCertSession(chatId);
  if (!sess) return;

  const passages = await getAssignedPassages(userExamId);
  const passage  = passages[index];
  if (!passage) return;

  const passageText = `📖 <b>MATN ${index + 1} — "${passage.title}"</b>\n\n${passage.text}`;
  if (passageText.length > 4000) {
    await bot.sendMessage(chatId, `📖 <b>MATN ${index + 1}: "${passage.title}"</b>`, { parse_mode: "HTML" });
    for (const chunk of splitText(passage.text, 3800)) {
      await bot.sendMessage(chatId, chunk);
    }
  } else {
    await bot.sendMessage(chatId, passageText, { parse_mode: "HTML" });
  }

  await new Promise(r => setTimeout(r, 400));

  const questions = await getQuestionsForPassage(passage.id);
  let qText = `\n📝 <b>MATN ${index + 1} SAVOLLARI:</b>\n\n`;
  let qNum = index * 10 + 1;
  for (const q of questions) {
    qText += `<b>${qNum}.</b> ${q.question_text}`;
    if (q.question_type === "true_false") qText += `\n   (TRUE / FALSE)`;
    if (q.options) {
      const opts = q.options as unknown as string[];
      opts.forEach(o => { qText += `\n   ${o}`; });
    }
    qText += "\n\n";
    qNum++;
  }
  qText += `✏️ <b>Javob berish:</b>\n<code>${(index * 10 + 1)}. A\n${(index * 10 + 2)}. TRUE\n${(index * 10 + 3)}. CERN</code>`;

  await bot.sendMessage(chatId, qText, { parse_mode: "HTML" });

  sess.currentPassageIndex = index;
  setCertSession(chatId, sess);
}

async function processReadingAnswers(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const sess = getCertSession(chatId);
  if (!sess || sess.section !== "reading") return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b>", { parse_mode: "HTML" });
    return;
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const parsed: Record<number, string> = {};
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*[.)\-:]\s*(.+)$/);
    if (m) parsed[parseInt(m[1]!, 10)] = m[2]!.trim().toUpperCase();
  }

  if (Object.keys(parsed).length === 0) {
    await bot.sendMessage(chatId, "❓ Format noto'g'ri.\nMisol:\n<code>1. A\n2. TRUE\n3. CERN</code>", { parse_mode: "HTML" });
    return;
  }

  const passages = await getAssignedPassages(sess.userExamId);
  const passage  = passages[sess.currentPassageIndex];
  if (!passage) return;

  const questions = await getQuestionsForPassage(passage.id);
  let qNum = sess.currentPassageIndex * 10 + 1;
  for (const q of questions) {
    const ans = parsed[qNum];
    if (ans !== undefined) {
      const correct = ans.toLowerCase().trim() === q.correct_answer.toLowerCase().trim();
      await saveCertAnswer(sess.userExamId, q.id, "reading", ans, correct);
    }
    qNum++;
  }

  const total = await countCertTotal(sess.userExamId, "reading");
  await bot.sendMessage(chatId,
    `✅ <b>Matn ${sess.currentPassageIndex + 1} javoblari qabul qilindi!</b>\n📊 Jami javob: ${total}/30`,
    { parse_mode: "HTML" }
  );

  if (sess.currentPassageIndex < passages.length - 1) {
    sess.currentPassageIndex++;
    setCertSession(chatId, sess);
    await new Promise(r => setTimeout(r, 800));
    await sendReadingPassage(bot, chatId, sess.userExamId, sess.currentPassageIndex);
  } else {
    clearCertTimer(chatId);
    await finishReading(bot, chatId, sess.userExamId, sess.level);
  }
}

async function finishReading(bot: TelegramBot, chatId: number, userExamId: number, level: CertLevel): Promise<void> {
  clearCertTimer(chatId);
  const correct = await countCertCorrect(userExamId, "reading");
  const total   = await countCertTotal(userExamId, "reading");
  const pct     = total > 0 ? Math.round((correct / Math.max(total, 30)) * 100) : Math.round((correct / 30) * 100);

  await bot.sendMessage(chatId,
    `✅ <b>ЧТЕНИЕ yakunlandi!</b>\n\n` +
    `📊 To'g'ri: <b>${correct}/30</b>\n` +
    `🎯 Ball: <b>${pct}%</b>\n\n` +
    `🎧 Keyingi: <b>АУДИРОВАНИЕ</b> — 40 min`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1500));
  await startListening(bot, chatId, level, userExamId);
}

// ══════════════════════════════════════════════════════════════
// LISTENING
// ══════════════════════════════════════════════════════════════
async function startListening(bot: TelegramBot, chatId: number, level: CertLevel, userExamId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_MINS.listening * 60 * 1000;
  await updateCertStatus(userExamId, "listening");

  const assigned = await assignListeningTexts(userExamId, level);
  const sess = getCertSession(chatId);
  if (!sess) return;

  sess.section = "listening";
  sess.sectionDeadlineMs = deadlineMs;
  sess.currentListeningPart = 0;
  setCertSession(chatId, sess);

  setCertTimer(chatId, {
    deadlineMs,
    timerId: setTimeout(() => finishListening(bot, chatId, userExamId, level), SECTION_MINS.listening * 60 * 1000),
  });

  await bot.sendMessage(chatId,
    `🎧 <b>АУДИРОВАНИЕ (LISTENING) BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>40 daqiqa</b>\n` +
    `📋 4 qism\n\n` +
    `Ko'rsatma: Har bir matnni diqqat bilan o'qing va savollarga javob bering.\n` +
    `(Admin audio yuklagan bo'lsa, audio yuklanadi)`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 800));
  await sendListeningPart(bot, chatId, userExamId, level, 0, assigned);
}

async function sendListeningPart(
  bot: TelegramBot, chatId: number, userExamId: number,
  level: CertLevel, partIndex: number, assigned: CertListeningText[]
): Promise<void> {
  const lt = assigned[partIndex];
  if (!lt) return;

  const sess = getCertSession(chatId);
  if (sess) { sess.currentListeningPart = partIndex; setCertSession(chatId, sess); }

  if (lt.audio_file_id) {
    await bot.sendAudio(chatId, lt.audio_file_id, { caption: `🎧 Qism ${partIndex + 1} — Diqqat bilan eshiting!` });
    await new Promise(r => setTimeout(r, 2000));
  } else {
    await bot.sendMessage(chatId,
      `🎧 <b>QISM ${partIndex + 1}</b>\n━━━━━━━━━━━━━\n\n` +
      `<i>${lt.transcript}</i>`,
      { parse_mode: "HTML" }
    );
    await new Promise(r => setTimeout(r, 600));
  }

  const questions = await getQuestionsForListeningPart(level, lt.part_number);
  let qText = `\n📝 <b>QISM ${partIndex + 1} SAVOLLARI:</b>\n\n`;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    qText += `<b>${partIndex * 3 + i + 1}.</b> ${q.question_text}`;
    if (q.options) {
      const opts = q.options as unknown as string[];
      opts.forEach(o => { qText += `\n   ${o}`; });
    }
    qText += "\n\n";
  }
  qText += `✏️ Javob bering: <code>${partIndex * 3 + 1}. B</code>`;
  await bot.sendMessage(chatId, qText, { parse_mode: "HTML" });
}

async function getQuestionsForListeningPart(level: CertLevel, partNumber: number): Promise<CertQuestion[]> {
  const r = await pool.query<CertQuestion>(
    "SELECT * FROM cert_question_bank WHERE level = $1 AND section = 'listening' AND part_number = $2 ORDER BY id LIMIT 3",
    [level, partNumber]
  );
  return r.rows;
}

async function processListeningAnswers(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const sess = getCertSession(chatId);
  if (!sess || sess.section !== "listening") return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b>", { parse_mode: "HTML" });
    return;
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const parsed: Record<number, string> = {};
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*[.)\-:]\s*(.+)$/);
    if (m) parsed[parseInt(m[1]!, 10)] = m[2]!.trim().toUpperCase();
  }

  if (Object.keys(parsed).length === 0) {
    await bot.sendMessage(chatId, "❓ Format: <code>1. B\n2. A</code>", { parse_mode: "HTML" });
    return;
  }

  const assigned = await getAssignedListeningTexts(sess.userExamId);
  const lt = assigned[sess.currentListeningPart];
  if (!lt) return;

  const questions = await getQuestionsForListeningPart(sess.level, lt.part_number);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const num = sess.currentListeningPart * 3 + i + 1;
    const ans = parsed[num];
    if (ans !== undefined) {
      const correct = ans.toLowerCase().trim() === q.correct_answer.toLowerCase().trim();
      await saveCertAnswer(sess.userExamId, q.id, "listening", ans, correct);
    }
  }

  const totalAnswered = await countCertTotal(sess.userExamId, "listening");
  await bot.sendMessage(chatId,
    `✅ <b>Qism ${sess.currentListeningPart + 1} javoblari qabul qilindi!</b>\n📊 Jami: ${totalAnswered}/${assigned.length * 3}`,
    { parse_mode: "HTML" }
  );

  if (sess.currentListeningPart < assigned.length - 1) {
    sess.currentListeningPart++;
    setCertSession(chatId, sess);
    await new Promise(r => setTimeout(r, 800));
    await sendListeningPart(bot, chatId, sess.userExamId, sess.level, sess.currentListeningPart, assigned);
  } else {
    clearCertTimer(chatId);
    await finishListening(bot, chatId, sess.userExamId, sess.level);
  }
}

async function finishListening(bot: TelegramBot, chatId: number, userExamId: number, level: CertLevel): Promise<void> {
  clearCertTimer(chatId);
  const correct = await countCertCorrect(userExamId, "listening");
  const total   = await countCertTotal(userExamId, "listening");
  const pct     = Math.round((correct / Math.max(total, 12)) * 100);

  await bot.sendMessage(chatId,
    `✅ <b>АУДИРОВАНИЕ yakunlandi!</b>\n\n` +
    `📊 To'g'ri: <b>${correct}/${Math.max(total, 12)}</b>\n` +
    `🎯 Ball: <b>${pct}%</b>\n\n` +
    `📝 Keyingi: <b>ЛЕКСИКА И ГРАММАТИКА</b> — 45 min`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1500));
  await startGrammar(bot, chatId, level, userExamId);
}

// ══════════════════════════════════════════════════════════════
// GRAMMAR
// ══════════════════════════════════════════════════════════════
async function startGrammar(bot: TelegramBot, chatId: number, level: CertLevel, userExamId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_MINS.grammar * 60 * 1000;
  await updateCertStatus(userExamId, "grammar");

  const questions = await assignGrammarQuestions(userExamId, level);
  const sess = getCertSession(chatId);
  if (!sess) return;

  sess.section = "grammar";
  sess.sectionDeadlineMs = deadlineMs;
  sess.assignedQuestionIds = questions.map(q => q.id);
  setCertSession(chatId, sess);

  setCertTimer(chatId, {
    deadlineMs,
    timerId: setTimeout(() => finishGrammar(bot, chatId, userExamId, level), SECTION_MINS.grammar * 60 * 1000),
  });

  await bot.sendMessage(chatId,
    `📝 <b>ЛЕКСИКА И ГРАММАТИКА BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>45 daqiqa</b>\n` +
    `📋 30 ta savol\n\n` +
    `Ko'rsatma: Har bir savolga javob harfini yozing.\n` +
    `Barcha javoblarni bir xabarda yuboring:`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 600));

  const BATCH = 15;
  for (let batch = 0; batch < 2; batch++) {
    let qText = `📝 <b>SAVOLLAR ${batch * BATCH + 1}–${Math.min((batch + 1) * BATCH, questions.length)}:</b>\n\n`;
    for (let i = batch * BATCH; i < Math.min((batch + 1) * BATCH, questions.length); i++) {
      const q = questions[i]!;
      qText += `<b>${i + 1}.</b> ${q.question_text}\n`;
      if (q.options) {
        const opts = q.options as unknown as string[];
        opts.forEach(o => { qText += `   ${o}\n`; });
      }
      qText += "\n";
    }
    if (qText.length > 4000) {
      const chunks = splitText(qText, 3800);
      for (const chunk of chunks) await bot.sendMessage(chatId, chunk, { parse_mode: "HTML" });
    } else {
      await bot.sendMessage(chatId, qText, { parse_mode: "HTML" });
    }
    await new Promise(r => setTimeout(r, 400));
  }

  await bot.sendMessage(chatId,
    `✏️ <b>Barcha javoblarni shu formatda yuboring:</b>\n\n` +
    `<code>1. A\n2. B\n3. C\n...\n30. D</code>`,
    { parse_mode: "HTML" }
  );
}

async function processGrammarAnswers(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const sess = getCertSession(chatId);
  if (!sess || sess.section !== "grammar") return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b>", { parse_mode: "HTML" });
    return;
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const parsed: Record<number, string> = {};
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*[.)\-:]\s*(.+)$/);
    if (m) parsed[parseInt(m[1]!, 10)] = m[2]!.trim().toUpperCase();
  }

  if (Object.keys(parsed).length === 0) {
    await bot.sendMessage(chatId, "❓ Format: <code>1. A\n2. B\n3. C</code>", { parse_mode: "HTML" });
    return;
  }

  const questions = await getAssignedGrammarQuestions(sess.userExamId);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const ans = parsed[i + 1];
    if (ans !== undefined) {
      const correct = ans.toLowerCase().trim() === q.correct_answer.toLowerCase().trim();
      await saveCertAnswer(sess.userExamId, q.id, "grammar", ans, correct);
    }
  }

  const correct = await countCertCorrect(sess.userExamId, "grammar");
  const total   = await countCertTotal(sess.userExamId, "grammar");
  const pct     = Math.round((correct / 30) * 100);

  await bot.sendMessage(chatId,
    `✅ <b>Grammatika javoblari qabul qilindi!</b>\n\n` +
    `📊 To'g'ri: <b>${correct}/${total}</b>\n` +
    `🎯 Ball: <b>${pct}%</b>`,
    { parse_mode: "HTML" }
  );

  clearCertTimer(chatId);
  await new Promise(r => setTimeout(r, 1000));
  await finishGrammar(bot, chatId, sess.userExamId, sess.level);
}

async function finishGrammar(bot: TelegramBot, chatId: number, userExamId: number, level: CertLevel): Promise<void> {
  clearCertTimer(chatId);
  const correct = await countCertCorrect(userExamId, "grammar");
  const pct     = Math.round((correct / 30) * 100);

  await bot.sendMessage(chatId,
    `✅ <b>ГРАММАТИКА yakunlandi!</b>\n\n` +
    `📊 To'g'ri: <b>${correct}/30</b>\n` +
    `🎯 Ball: <b>${pct}%</b>\n\n` +
    `✍️ Keyingi: <b>ПИСЬМО (WRITING)</b> — 60 min`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1500));
  await startWriting(bot, chatId, level, userExamId);
}

// ══════════════════════════════════════════════════════════════
// WRITING
// ══════════════════════════════════════════════════════════════
async function startWriting(bot: TelegramBot, chatId: number, level: CertLevel, userExamId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_MINS.writing * 60 * 1000;
  await updateCertStatus(userExamId, "writing");

  const prompt = await pickRandomWritingPrompt(userExamId, level);
  const sess = getCertSession(chatId);
  if (!sess) return;

  sess.section = "writing";
  sess.sectionDeadlineMs = deadlineMs;
  sess.writingPromptId = prompt.id;
  sess.writingPromptText = prompt.prompt;
  setCertSession(chatId, sess);

  setCertTimer(chatId, {
    deadlineMs,
    timerId: setTimeout(() => finishWriting(bot, chatId, userExamId, level), SECTION_MINS.writing * 60 * 1000),
  });

  const minWords = level === "B2" ? 150 : 220;
  await bot.sendMessage(chatId,
    `✍️ <b>ПИСЬМО (WRITING) BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>60 daqiqa</b>\n` +
    `📋 Kamida <b>${minWords} so'z</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<b>VAZIFA:</b>\n\n` +
    `${prompt.prompt}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✏️ <b>Inshongizni to'liq matn sifatida shu yerga yuboring.</b>`,
    { parse_mode: "HTML" }
  );
}

async function processWriting(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const sess = getCertSession(chatId);
  if (!sess || sess.section !== "writing") return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b>", { parse_mode: "HTML" });
    return;
  }

  const wordCount = text.trim().split(/\s+/).length;
  const minWords = sess.level === "B2" ? 100 : 150;

  if (wordCount < minWords) {
    await bot.sendMessage(chatId,
      `⚠️ Matn juda qisqa (<b>${wordCount} so'z</b>).\nKamida <b>${sess.level === "B2" ? 150 : 220} so'z</b> yozing.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const msg = await bot.sendMessage(chatId, "⏳ <b>AI inshongizni baholamoqda...</b> (bir necha daqiqa)", { parse_mode: "HTML" });

  const feedback = await evaluateRussianWriting(sess.level, sess.writingPromptText, text);
  await saveCertWriting(sess.userExamId, sess.writingPromptId!, text, feedback.band_score, feedback);

  await bot.editMessageText(
    `✅ <b>ИНСHO NATIJASI:</b>\n\n` +
    `🎯 Ball: <b>${feedback.band_score.toFixed(0)}%</b>\n\n` +
    `📊 <b>Mezonlar:</b>\n` +
    `• Mazmun: ${feedback.task_achievement?.toFixed(0)}%\n` +
    `• Mantiq: ${feedback.coherence_cohesion?.toFixed(0)}%\n` +
    `• Lug'at: ${feedback.lexical_resource?.toFixed(0)}%\n` +
    `• Grammatika: ${feedback.grammatical_range?.toFixed(0)}%\n\n` +
    `✅ <b>Kuchli:</b>\n${feedback.strengths.map(s => `• ${s}`).join("\n")}\n\n` +
    `❌ <b>Zaif:</b>\n${feedback.weaknesses.map(w => `• ${w}`).join("\n")}\n\n` +
    `💬 ${feedback.detailed_feedback}\n\n` +
    `📝 So'z soni: ${wordCount}`,
    { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }
  );

  clearCertTimer(chatId);
  await new Promise(r => setTimeout(r, 1500));
  await finishWriting(bot, chatId, sess.userExamId, sess.level);
}

async function finishWriting(bot: TelegramBot, chatId: number, userExamId: number, level: CertLevel): Promise<void> {
  clearCertTimer(chatId);

  await bot.sendMessage(chatId,
    `✅ <b>ПИСЬМО yakunlandi!</b>\n\n🗣 Keyingi: <b>ГОВОРЕНИЕ (SPEAKING)</b> — 15 min`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1500));
  await startSpeaking(bot, chatId, level, userExamId);
}

// ══════════════════════════════════════════════════════════════
// SPEAKING
// ══════════════════════════════════════════════════════════════
async function startSpeaking(bot: TelegramBot, chatId: number, level: CertLevel, userExamId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_MINS.speaking * 60 * 1000;
  await updateCertStatus(userExamId, "speaking");

  const sess = getCertSession(chatId);
  if (!sess) return;

  sess.section = "speaking";
  sess.sectionDeadlineMs = deadlineMs;
  sess.speakingPartNumber = 1;
  sess.speakingCollecting = false;
  setCertSession(chatId, sess);

  setCertTimer(chatId, {
    deadlineMs,
    timerId: setTimeout(() => finishSpeaking(bot, chatId, userExamId, level), SECTION_MINS.speaking * 60 * 1000),
  });

  await bot.sendMessage(chatId,
    `🗣 <b>ГОВОРЕНИЕ (SPEAKING) BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>15 daqiqa</b>\n` +
    `📋 3 qism\n\n` +
    `Ko'rsatma:\n` +
    `• Har savolga <b>ovozli xabar</b> yuboring\n` +
    `• <b>Rus tilida</b> javob bering\n` +
    `• AI nutqingizni baholaydi`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1000));
  await sendSpeakingPart(bot, chatId, level, 1);
}

async function sendSpeakingPart(bot: TelegramBot, chatId: number, level: CertLevel, partNumber: number): Promise<void> {
  const questions = await getSpeakingQuestions(level, partNumber);
  const sess = getCertSession(chatId);
  if (sess) { sess.speakingPartNumber = partNumber; sess.speakingCollecting = true; setCertSession(chatId, sess); }

  const partDesc =
    partNumber === 1 ? "O'zingiz haqingizda / Erkin suhbat" :
    partNumber === 2 ? "Kengaytirilgan monolog / Prezentatsiya" :
    "Munozara / Tahliliy suhbat";

  let qText = `🗣 <b>QISM ${partNumber}</b>\n<i>${partDesc}</i>\n\n━━━━━━━━━━━━━━\n\n`;
  for (const q of questions) {
    qText += `❓ ${q.question_text}\n\n`;
  }
  qText += `━━━━━━━━━━━━━━\n🎤 <b>Ovozli xabar yuboring</b>`;

  await bot.sendMessage(chatId, qText, { parse_mode: "HTML" });
}

async function processSpeakingVoice(bot: TelegramBot, chatId: number, fileLink: string): Promise<void> {
  const sess = getCertSession(chatId);
  if (!sess || sess.section !== "speaking" || !sess.speakingCollecting) return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b>", { parse_mode: "HTML" });
    return;
  }

  const msg = await bot.sendMessage(chatId, "🎙 <b>Nutqingiz tahlil qilinmoqda...</b>", { parse_mode: "HTML" });
  const transcript = fileLink ? await transcribeRussian(fileLink) : "[Matn topshirildi]";
  const questions = await getSpeakingQuestions(sess.level, sess.speakingPartNumber);
  const qTexts = questions.map(q => q.question_text);

  const feedback = await evaluateRussianSpeaking(sess.level, sess.speakingPartNumber, qTexts, transcript);
  await saveCertSpeaking(sess.userExamId, sess.speakingPartNumber, transcript, feedback.band_score, feedback);

  await bot.editMessageText(
    `✅ <b>SPEAKING Qism ${sess.speakingPartNumber} NATIJASI:</b>\n\n` +
    `🎯 Ball: <b>${feedback.band_score.toFixed(0)}%</b>\n\n` +
    `📊 <b>Mezonlar:</b>\n` +
    `• Ravonlik: ${feedback.fluency_coherence?.toFixed(0)}%\n` +
    `• Talaffuz: ${feedback.pronunciation?.toFixed(0)}%\n` +
    `• Lug'at: ${feedback.lexical_resource?.toFixed(0)}%\n` +
    `• Grammatika: ${feedback.grammatical_range?.toFixed(0)}%\n\n` +
    `✅ <b>Kuchli:</b>\n${feedback.strengths.map(s => `• ${s}`).join("\n")}\n\n` +
    `❌ <b>Zaif:</b>\n${feedback.weaknesses.map(w => `• ${w}`).join("\n")}\n\n` +
    `📝 <i>${transcript.slice(0, 250)}${transcript.length > 250 ? "..." : ""}</i>`,
    { chat_id: chatId, message_id: msg.message_id, parse_mode: "HTML" }
  );

  sess.speakingCollecting = false;
  setCertSession(chatId, sess);

  if (sess.speakingPartNumber < 3) {
    sess.speakingPartNumber++;
    sess.speakingCollecting = true;
    setCertSession(chatId, sess);
    await new Promise(r => setTimeout(r, 1200));
    await sendSpeakingPart(bot, chatId, sess.level, sess.speakingPartNumber);
  } else {
    clearCertTimer(chatId);
    await finishSpeaking(bot, chatId, sess.userExamId, sess.level);
  }
}

async function finishSpeaking(bot: TelegramBot, chatId: number, userExamId: number, level: CertLevel): Promise<void> {
  clearCertTimer(chatId);
  await bot.sendMessage(chatId, "✅ <b>SPEAKING yakunlandi!</b>\n\n🏁 Natijalar hisoblanmoqda...", { parse_mode: "HTML" });
  await calculateAndShowResults(bot, chatId, userExamId, level);
}

// ══════════════════════════════════════════════════════════════
// RESULTS + CERTIFICATE
// ══════════════════════════════════════════════════════════════
async function calculateAndShowResults(bot: TelegramBot, chatId: number, userExamId: number, level: CertLevel): Promise<void> {
  const rCorrect  = await countCertCorrect(userExamId, "reading");
  const rTotal    = Math.max(await countCertTotal(userExamId, "reading"), 30);
  const lCorrect  = await countCertCorrect(userExamId, "listening");
  const lTotal    = Math.max(await countCertTotal(userExamId, "listening"), 12);
  const gCorrect  = await countCertCorrect(userExamId, "grammar");
  const gTotal    = Math.max(await countCertTotal(userExamId, "grammar"), 30);
  const writing   = await getCertWriting(userExamId);
  const speaking  = await getCertSpeaking(userExamId);

  const rPct = Math.round((rCorrect / rTotal) * 100);
  const lPct = Math.round((lCorrect / lTotal) * 100);
  const gPct = Math.round((gCorrect / gTotal) * 100);
  const wPct = Math.round(writing?.ai_score ?? 50);
  const sPct = speaking.length > 0
    ? Math.round(speaking.reduce((a, b) => a + (b.ai_score ?? 50), 0) / speaking.length)
    : 50;

  const overall = Math.round((rPct + lPct + gPct + wPct + sPct) / 5);
  const passed  = overall >= PASS_THRESHOLD[level];

  await saveCertScores(userExamId, rPct, lPct, gPct, wPct, sPct, overall, passed);
  await updateCertStatus(userExamId, "completed");
  clearCertSession(chatId);

  await sendCertResults(bot, chatId, userExamId, level, rPct, lPct, gPct, wPct, sPct);
}

export async function sendCertResults(
  bot: TelegramBot, chatId: number, userExamId: number, level: CertLevel,
  r: number, l: number, g: number, w: number, s: number
): Promise<void> {
  const overall  = Math.round((r + l + g + w + s) / 5);
  const passed   = overall >= PASS_THRESHOLD[level];
  const passStr  = passed ? `✅ O'TGAN` : `❌ O'TMAGAN`;
  const passEmoji = passed ? "🏆" : "📚";

  await bot.sendMessage(
    chatId,
    `╔════════════════════════════╗\n` +
    `   🎓 ${level} IMTIHON NATIJASI\n` +
    `╚════════════════════════════╝\n\n` +
    `📖 <b>Чтение:</b>         <b>${r}%</b>\n` +
    `🎧 <b>Аудирование:</b>    <b>${l}%</b>\n` +
    `📝 <b>Грамматика:</b>     <b>${g}%</b>\n` +
    `✍️  <b>Письмо:</b>         <b>${w}%</b>\n` +
    `🗣  <b>Говорение:</b>      <b>${s}%</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${passEmoji} <b>UMUMIY: ${overall}%</b>\n` +
    `🎯 O'tish bali: ${PASS_THRESHOLD[level]}%\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>${passStr}</b>${passed ? " — Tabriklaymiz! 🎉" : " — Qayta urinib ko'ring!"}`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: `🔄 Yana ${level} imtihon sotib olish`, callback_data: `cert:pay:${level}` },
        ]],
      },
    }
  );

  if (passed) {
    await new Promise(r => setTimeout(r, 1000));
    const profile = await getProfile(chatId);
    const certNum  = generateCertNumber(chatId, level, userExamId);
    const certText = generateCertificate({
      fullName: profile?.full_name ?? "Nomavjud",
      level, readingScore: r, listeningScore: l,
      grammarScore: g, writingScore: w, speakingScore: s,
      overallScore: overall, passed,
      examDate: formatExamDate(), certNumber: certNum,
    });
    await bot.sendMessage(chatId, certText, { parse_mode: "HTML" });
  }
}

// ══════════════════════════════════════════════════════════════
// MY RESULTS
// ══════════════════════════════════════════════════════════════
export async function handleMyResults(bot: TelegramBot, chatId: number): Promise<void> {
  const r = await pool.query(
    `SELECT ue.level, ue.status, ue.created_at, es.overall_score, es.passed
     FROM cert_user_exams ue
     LEFT JOIN cert_exam_scores es ON es.user_exam_id = ue.id
     WHERE ue.user_id = $1
     ORDER BY ue.created_at DESC LIMIT 10`,
    [chatId]
  );

  if (r.rows.length === 0) {
    await bot.sendMessage(chatId, "📋 Hozircha imtihon yo'q.\n\n/cert yoki «Rus tili sertifikati» tugmasini bosing.", { reply_markup: mainKb() });
    return;
  }

  let text = `📋 <b>SIZNING IMTIHONLARINGIZ:</b>\n\n`;
  for (const row of r.rows as { level: string; status: string; created_at: Date; overall_score: number | null; passed: boolean | null }[]) {
    const date = new Date(row.created_at).toLocaleDateString("uz-UZ");
    text += `🎓 <b>${row.level}</b> — ${date}\n`;
    if (row.overall_score !== null) {
      text += `   Ball: ${row.overall_score}% — ${row.passed ? "✅ O'TGAN" : "❌ O'tmagan"}\n`;
    } else {
      text += `   Holat: ${row.status}\n`;
    }
    text += "\n";
  }

  await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: mainKb() });
}

// ══════════════════════════════════════════════════════════════
// RESUME
// ══════════════════════════════════════════════════════════════
async function resumeCertExam(bot: TelegramBot, chatId: number, ue: { id: number; level: string; status: string }): Promise<void> {
  const level = ue.level as CertLevel;
  await bot.sendMessage(chatId,
    `▶️ <b>Imtihon davom etmoqda!</b>\nBo'lim: <b>${ue.status.toUpperCase()}</b>`,
    { parse_mode: "HTML", reply_markup: examKb() }
  );
  const sess = getCertSession(chatId);
  if (!sess) {
    if (ue.status === "reading") await startReading(bot, chatId, level, ue.id);
    else if (ue.status === "listening") await startListening(bot, chatId, level, ue.id);
    else if (ue.status === "grammar") await startGrammar(bot, chatId, level, ue.id);
    else if (ue.status === "writing") await startWriting(bot, chatId, level, ue.id);
    else if (ue.status === "speaking") await startSpeaking(bot, chatId, level, ue.id);
  }
}

// ══════════════════════════════════════════════════════════════
// REGISTER HANDLERS
// ══════════════════════════════════════════════════════════════
export async function registerCertHandlers(bot: TelegramBot): Promise<void> {

  // ── Inline-button admin confirm/reject (cert_cb_confirm / cert_cb_reject) ──
  bot.on("callback_query", async (query) => {
    const data = query.data ?? "";
    if (!data.startsWith("cert_cb_confirm:") && !data.startsWith("cert_cb_reject:")) return;
    if (!isCertAdmin({ from: query.from, chat: query.message!.chat } as Message)) return;
    const adminChatId = query.message!.chat.id;
    await bot.answerCallbackQuery(query.id);

    if (data.startsWith("cert_cb_confirm:")) {
      const parts  = data.split(":");
      const userId = parseInt(parts[1]!, 10);
      const level  = parts[2]! as CertLevel;
      try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: adminChatId, message_id: query.message!.message_id }); } catch { /* ignore */ }
      await confirmCertPayment(bot, adminChatId, userId, level);
    } else if (data.startsWith("cert_cb_reject:")) {
      const parts  = data.split(":");
      const userId = parseInt(parts[1]!, 10);
      const level  = parts[2]! as CertLevel;
      const ue = await getLatestCertUserExam(userId, level);
      if (ue) await updateCertStatus(ue.id, "pending_payment");
      try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: adminChatId, message_id: query.message!.message_id }); } catch { /* ignore */ }
      await bot.sendMessage(adminChatId, `❌ Rad etildi. ID: <code>${userId}</code> Level: ${level}`, { parse_mode: "HTML" });
      bot.sendMessage(userId,
        `❌ <b>${level} sertifikat to'lovingiz rad etildi.</b>\nMuammo bo'lsa @${ADMIN_USER} bilan bog'laning.`,
        { parse_mode: "HTML", reply_markup: mainKb() }
      ).catch(() => {});
    }
  });

  // Admin: confirm cert payment (command fallback)
  bot.onText(/\/cert_confirm_(\d+)_(\w+)/, async (msg, match) => {
    if (!isCertAdmin(msg)) return;
    const userId = parseInt(match![1]!, 10);
    const level  = match![2]! as CertLevel;
    await confirmCertPayment(bot, msg.chat.id, userId, level);
  });

  // Admin: reject cert payment (command fallback)
  bot.onText(/\/cert_reject_(\d+)_(\w+)/, async (msg, match) => {
    if (!isCertAdmin(msg)) return;
    const userId = parseInt(match![1]!, 10);
    const level  = match![2]! as CertLevel;
    const ue = await getLatestCertUserExam(userId, level);
    if (ue) await updateCertStatus(ue.id, "pending_payment");
    await bot.sendMessage(msg.chat.id, `❌ Rad etildi. ID: <code>${userId}</code> Level: ${level}`, { parse_mode: "HTML" });
    bot.sendMessage(userId,
      `❌ <b>${level} sertifikat to'lovingiz rad etildi.</b>\nMuammo bo'lsa @${ADMIN_USER} bilan bog'laning.`,
      { parse_mode: "HTML", reply_markup: mainKb() }
    ).catch(() => {});
  });

  // Admin: cert stats
  bot.onText(/\/cert_admin/, async (msg) => {
    if (!isCertAdmin(msg)) return;
    const stats   = await getCertStats();
    const pending = await getPendingCertPayments();

    let text =
      `╔══════════════════════════╗\n🎓 SERTIFIKAT ADMIN PANEL\n╚══════════════════════════╝\n\n` +
      `📊 <b>STATISTIKA:</b>\n` +
      `┣ Jami: <b>${stats.total}</b>\n` +
      `┣ B2: <b>${stats.b2}</b>\n` +
      `┣ C1: <b>${stats.c1}</b>\n` +
      `┣ Yakunlangan: <b>${stats.completed}</b>\n` +
      `┗ Kutilayotgan: <b>${stats.pending}</b>\n\n`;

    if (pending.length > 0) {
      text += `⏳ <b>Kutilayotgan to'lovlar:</b>\n`;
      for (const p of pending) {
        text += `\n👤 ID <code>${p.user_id}</code> — ${p.level}\n`;
        text += `✅ /cert_confirm_${p.user_id}_${p.level}  ❌ /cert_reject_${p.user_id}_${p.level}\n`;
      }
    } else {
      text += `✅ Kutilayotgan to'lov yo'q.`;
    }

    await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
  });

  // Admin: pending cert payments
  bot.onText(/\/cert_pending/, async (msg) => {
    if (!isCertAdmin(msg)) return;
    const pending = await getPendingCertPayments();
    if (pending.length === 0) { await bot.sendMessage(msg.chat.id, "✅ Kutilayotgan to'lov yo'q."); return; }
    let text = `⏳ <b>Kutilayotgan sertifikat to'lovlar (${pending.length}):</b>\n\n`;
    for (const p of pending) {
      text += `👤 ID <code>${p.user_id}</code> — ${p.level}\n`;
      text += `✅ /cert_confirm_${p.user_id}_${p.level}  ❌ /cert_reject_${p.user_id}_${p.level}\n\n`;
    }
    await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
  });

  // /cert command
  bot.onText(/\/cert/, async (msg) => {
    await handleCertEntry(bot, msg.chat.id);
  });
}

// ══════════════════════════════════════════════════════════════
// ROUTE CERT MESSAGES (called from main router)
// ══════════════════════════════════════════════════════════════
export async function routeCertMessage(bot: TelegramBot, msg: Message): Promise<boolean> {
  const chatId = msg.chat.id;
  const sess   = getCertSession(chatId);
  const ready  = getReadyToStart(chatId);

  if (msg.text === "⏱ Vaqt qoldi?" && sess) {
    const left = sess.sectionDeadlineMs - Date.now();
    await bot.sendMessage(chatId,
      `⏱ <b>${sess.section.toUpperCase()}</b> — qolgan vaqt: <b>${fmtTime(left)}</b>`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  if (msg.text === "🏳 Imtihondan chiqish" && sess) {
    clearCertSession(chatId);
    clearCertTimer(chatId);
    await bot.sendMessage(chatId, "⚠️ Imtihondan chiqdingiz. Qayta boshlash: /cert", { reply_markup: mainKb() });
    return true;
  }

  if (!sess) return false;

  if (sess.section === "reading" && msg.text && !msg.text.startsWith("/")) {
    await processReadingAnswers(bot, chatId, msg.text);
    return true;
  }
  if (sess.section === "listening" && msg.text && !msg.text.startsWith("/")) {
    await processListeningAnswers(bot, chatId, msg.text);
    return true;
  }
  if (sess.section === "grammar" && msg.text && !msg.text.startsWith("/")) {
    await processGrammarAnswers(bot, chatId, msg.text);
    return true;
  }
  if (sess.section === "writing" && msg.text && !msg.text.startsWith("/")) {
    await processWriting(bot, chatId, msg.text);
    return true;
  }
  if (sess.section === "speaking" && msg.voice && sess.speakingCollecting) {
    const fileLink = await bot.getFileLink(msg.voice.file_id);
    await processSpeakingVoice(bot, chatId, fileLink);
    return true;
  }
  if (sess.section === "speaking" && msg.text && !msg.text.startsWith("/")) {
    await processSpeakingVoice(bot, chatId, "");
    return true;
  }

  return false;
}
