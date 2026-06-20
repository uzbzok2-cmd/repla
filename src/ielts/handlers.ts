import TelegramBot, { type Message, type ReplyKeyboardMarkup } from "node-telegram-bot-api";
import {
  getActiveExam, createUserExam, getUserExam, updateUserExamStatus, setPaymentPhoto,
  getPendingIeltsPayments, getListeningParts, getReadingPassages, getQuestions,
  getWritingTasks, getSpeakingQuestions, saveAnswer, countCorrectAnswers,
  saveWritingSubmission, getWritingSubmissions, saveSpeakingSubmission,
  getSpeakingSubmissions, saveScores, getScores, activateExam, listExams,
  insertReadingPassage, insertSpeakingQuestion, insertWritingTask, insertQuestion,
  getUserExamStats, getUserExamById,
} from "./db.js";
import {
  getIeltsSession, setIeltsSession, clearIeltsSession,
  getAdminAction, setAdminAction, clearAdminAction,
  setIeltsPaymentPending, getIeltsPaymentPending, clearIeltsPaymentPending,
  setSectionTimer, clearSectionTimer,
} from "./state.js";
import { evaluateWriting, evaluateSpeaking, transcribeForSpeaking } from "./evaluator.js";
import { rawToListeningBand, rawToReadingBand, calcOverall, bandEmoji, bandDescription, roundToBand } from "./scoring.js";
import { getAdminChatId } from "../subscription.js";
import { createExamToken, getWebAppUrl } from "../webapp.js";
import type { IeltsSection } from "./types.js";
import { transcribeAudio } from "../ai.js";

const IELTS_PRICE  = "28 000 so'm";
const IELTS_CARD   = "9860 3501 4197 4070";
const ADMIN_USER   = "drector_uz";

// Section durations in minutes
const SECTION_TIMES: Record<IeltsSection, number> = {
  listening: 40,
  reading:   60,
  writing:   60,
  speaking:  15,
};

function isIeltsAdmin(msg: Message): boolean {
  return msg.from?.username === ADMIN_USER;
}

function fmtTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function mainKb(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "🇷🇺 Ruscha" }, { text: "🇬🇧 Inglizcha" }, { text: "🇹🇷 Turkcha" }],
      [{ text: "📊 Obuna holati" }, { text: "💳 Obuna olish" }],
      [{ text: "📝 IELTS Mock Exam" }],
      [{ text: "🔗 Do'st taklif" }, { text: "📈 Statistika" }],
      [{ text: "ℹ️ Yordam" }],
    ],
    resize_keyboard: true,
  };
}

function examKb(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "⏱ Vaqt qoldi?" }, { text: "🏳 Testdan chiqish" }]],
    resize_keyboard: true,
  };
}

// ── IELTS entry point (called from text "📝 IELTS Mock Exam") ─────────
export async function handleIeltsEntry(bot: TelegramBot, chatId: number): Promise<void> {
  const exam = await getActiveExam();
  if (!exam) {
    await bot.sendMessage(chatId,
      "⚠️ Hozircha faol IELTS imtihoni mavjud emas.\nTez orada qo'shiladi — kuting!",
      { reply_markup: mainKb() }
    );
    return;
  }

  const existing = await getUserExam(chatId);
  if (existing && existing.status === "payment_pending_approval") {
    await bot.sendMessage(chatId,
      "⏳ <b>To'lovingiz admin tomonidan tekshirilmoqda.</b>\n\nOdatda 5–15 daqiqa ichida tasdiqlanadi.\nSabr qiling!",
      { parse_mode: "HTML", reply_markup: mainKb() }
    );
    return;
  }
  if (existing && !["pending_payment", "payment_pending_approval", "expired", "completed"].includes(existing.status)) {
    await resumeExam(bot, chatId, existing.id);
    return;
  }
  if (existing && existing.status === "completed") {
    const scores = await getScores(existing.id);
    if (scores) {
      await sendResults(bot, chatId, scores.listening_score!, scores.reading_score!, scores.writing_score!, scores.speaking_score!);
      return;
    }
  }

  await bot.sendMessage(
    chatId,
    `╔══════════════════════════╗\n` +
    `   🎓 IELTS MOCK EXAM\n` +
    `╚══════════════════════════╝\n\n` +
    `📋 <b>${exam.title}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎧 <b>Listening</b> — 40 savol (40 daqiqa)\n` +
    `📖 <b>Reading</b>   — 40 savol (60 daqiqa)\n` +
    `✍️ <b>Writing</b>   — 2 ta vazifa (60 daqiqa)\n` +
    `🗣 <b>Speaking</b>  — 3 qism (15 daqiqa)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 Narxi: <b>${IELTS_PRICE}</b> (bir martalik)\n` +
    `📅 Natijalar darhol chiqariladi\n\n` +
    `👇 To'lov qilish uchun quyidagi tugmani bosing:`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "💳 To'lov qilish", callback_data: "ielts:pay" },
          { text: "ℹ️ Batafsil", callback_data: "ielts:info" },
        ]],
      },
    }
  );
}

async function resumeExam(bot: TelegramBot, chatId: number, userExamId: number): Promise<void> {
  const ue = await getUserExamById(userExamId);
  if (!ue) return;
  const session = getIeltsSession(chatId);

  await bot.sendMessage(chatId,
    `▶️ <b>Testingiz davom etmoqda!</b>\n\nBo'lim: <b>${ue.status.toUpperCase()}</b>`,
    { parse_mode: "HTML", reply_markup: examKb() }
  );

  if (!session) {
    if (ue.status === "listening") await startListening(bot, chatId, userExamId, ue.exam_id);
    else if (ue.status === "reading") await startReading(bot, chatId, userExamId, ue.exam_id);
    else if (ue.status === "writing") await startWriting(bot, chatId, userExamId, ue.exam_id);
    else if (ue.status === "speaking") await startSpeaking(bot, chatId, userExamId, ue.exam_id);
  }
}

// ── START EXAM (called after payment confirmed) ───────────────────────
export async function startExam(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  await updateUserExamStatus(userExamId, "listening");
  await bot.sendMessage(
    chatId,
    `🎉 <b>To'lovingiz tasdiqlandi!</b>\n\n` +
    `✅ IELTS Mock Exam boshlanmoqda...\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 <b>KO'RSATMALAR:</b>\n` +
    `• Har bir bo'limda vaqt belgilangan\n` +
    `• Vaqt tugagach javoblar qabul qilinmaydi\n` +
    `• Barcha 4 bo'limni ketma-ket bajaring\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🎧 <b>BIRINCHI BO'LIM: LISTENING</b> boshlandi!\n` +
    `⏱ Vaqt: <b>40 daqiqa</b>`,
    { parse_mode: "HTML", reply_markup: examKb() }
  );
  await new Promise(r => setTimeout(r, 1500));
  await startListening(bot, chatId, userExamId, examId);
}

// ═══════════════════════════════════════════════════════════════════════
// LISTENING
// ═══════════════════════════════════════════════════════════════════════
async function startListening(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_TIMES.listening * 60 * 1000;
  await updateUserExamStatus(userExamId, "listening", deadlineMs);

  setIeltsSession(chatId, {
    userExamId, examId, section: "listening", partNumber: 1,
    questionIndex: 0, pendingAnswers: {}, sectionDeadlineMs: deadlineMs,
  });

  setSectionTimer(chatId, {
    section: "listening",
    deadlineMs,
    timerId: setTimeout(async () => {
      await finishListening(bot, chatId, userExamId, examId);
    }, SECTION_TIMES.listening * 60 * 1000),
  });

  await sendListeningPart(bot, chatId, userExamId, examId, 1);
}

async function sendListeningPart(bot: TelegramBot, chatId: number, userExamId: number, examId: number, partNumber: number): Promise<void> {
  const parts = await getListeningParts(examId);
  const part  = parts.find(p => p.part_number === partNumber);
  const questions = await getQuestions(examId, "listening", partNumber);

  await bot.sendMessage(
    chatId,
    `🎧 <b>LISTENING — PART ${partNumber}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    (part?.audio_file_id
      ? `▶️ Audio qism yuborilmoqda... Diqqat bilan eshiting!\n`
      : `📄 <i>${part?.transcript ?? "Audio mavjud emas"}</i>\n`),
    { parse_mode: "HTML" }
  );

  if (part?.audio_file_id) {
    await bot.sendAudio(chatId, part.audio_file_id, { caption: `🎧 Part ${partNumber} — Diqqat bilan eshiting!` });
    await new Promise(r => setTimeout(r, 2000));
  }

  // Show questions
  let qText = `📝 <b>PART ${partNumber} SAVOLLAR (${questions[0]?.question_number}–${questions[questions.length - 1]?.question_number}):</b>\n\n`;
  for (const q of questions) {
    qText += `<b>${q.question_number}.</b> ${q.question_text}\n`;
    if (q.options) {
      const opts = q.options as unknown as string[];
      opts.forEach(o => { qText += `   ${o}\n`; });
    }
    qText += "\n";
  }
  qText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  qText += `✏️ <b>Javob berish:</b> Har bir savol uchun raqam va javob yozing\n`;
  qText += `Misol: <code>1. single\n2. 3\n3. Johnson</code>\n\n`;
  qText += `Yoki bitta: <code>1. B</code>`;

  await bot.sendMessage(chatId, qText, { parse_mode: "HTML" });

  const sess = getIeltsSession(chatId);
  if (sess) {
    sess.partNumber = partNumber;
    setIeltsSession(chatId, sess);
  }
}

async function processListeningAnswers(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const sess = getIeltsSession(chatId);
  if (!sess || sess.section !== "listening") return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b> Javoblaringiz qabul qilinmadi.", { parse_mode: "HTML" });
    return;
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const parsed: Record<number, string> = {};
  for (const line of lines) {
    const m = line.match(/^(\d+)\s*[.)\-:]\s*(.+)$/);
    if (m) parsed[parseInt(m[1]!, 10)] = m[2]!.trim();
  }

  if (Object.keys(parsed).length === 0) {
    await bot.sendMessage(chatId,
      "❓ Format noto'g'ri. Misol:\n<code>1. single\n2. 3\n3. Johnson</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  const questions = await getQuestions(sess.examId, "listening", sess.partNumber);
  for (const q of questions) {
    const ans = parsed[q.question_number];
    if (ans !== undefined) {
      const correct = ans.toLowerCase().trim() === q.correct_answer.toLowerCase().trim();
      await saveAnswer(sess.userExamId, q.id, "listening", ans, correct);
    }
  }

  // Check if all 4 parts answered
  const allQs = await getQuestions(sess.examId, "listening");
  const totalAnswered = await countAnsweredQuestions(sess.userExamId, "listening");

  await bot.sendMessage(chatId,
    `✅ <b>Part ${sess.partNumber} javoblari qabul qilindi!</b>\n\n` +
    `📊 Jami javob berilgan: ${totalAnswered}/${allQs.length}`,
    { parse_mode: "HTML" }
  );

  if (sess.partNumber < 4) {
    sess.partNumber++;
    setIeltsSession(chatId, sess);
    await new Promise(r => setTimeout(r, 1000));
    await sendListeningPart(bot, chatId, sess.userExamId, sess.examId, sess.partNumber);
  } else {
    clearSectionTimer(chatId);
    await finishListening(bot, chatId, sess.userExamId, sess.examId);
  }
}

async function countAnsweredQuestions(userExamId: number, section: string): Promise<number> {
  const { pool } = await import("./db.js");
  const r = await pool.query(
    "SELECT COUNT(*) as cnt FROM user_answers WHERE user_exam_id = $1 AND section = $2",
    [userExamId, section]
  );
  return parseInt(r.rows[0]?.cnt ?? "0", 10);
}

async function finishListening(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  clearSectionTimer(chatId);
  const correct = await countCorrectAnswers(userExamId, "listening");
  const band    = rawToListeningBand(correct);

  await bot.sendMessage(
    chatId,
    `✅ <b>LISTENING yakunlandi!</b>\n\n` +
    `📊 To'g'ri javoblar: <b>${correct}/40</b>\n` +
    `🎯 Listening Band: <b>${band}</b> ${bandEmoji(band)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📖 Keyingi bo'lim: <b>READING</b>\n⏱ Vaqt: <b>60 daqiqa</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 2000));
  await startReading(bot, chatId, userExamId, examId);
}

// ═══════════════════════════════════════════════════════════════════════
// READING
// ═══════════════════════════════════════════════════════════════════════
async function startReading(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_TIMES.reading * 60 * 1000;
  await updateUserExamStatus(userExamId, "reading", deadlineMs);

  setIeltsSession(chatId, {
    userExamId, examId, section: "reading", partNumber: 1,
    questionIndex: 0, pendingAnswers: {}, sectionDeadlineMs: deadlineMs,
  });

  setSectionTimer(chatId, {
    section: "reading",
    deadlineMs,
    timerId: setTimeout(async () => {
      await finishReading(bot, chatId, userExamId, examId);
    }, SECTION_TIMES.reading * 60 * 1000),
  });

  await bot.sendMessage(
    chatId,
    `📖 <b>READING BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>60 daqiqa</b>\n` +
    `📋 3 ta matn, jami 40 ta savol\n\n` +
    `Ko'rsatma:\n` +
    `• TRUE/FALSE/NOT GIVEN savollar uchun: <code>1. TRUE</code>\n` +
    `• Multiple choice: <code>7. B</code>\n` +
    `• Fill blank: <code>8. TCP/IP</code>\n\n` +
    `Har bir matn va savollar alohida yuboriladi.`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1500));
  await sendReadingPassage(bot, chatId, userExamId, examId, 1);
}

async function sendReadingPassage(bot: TelegramBot, chatId: number, userExamId: number, examId: number, passageNumber: number): Promise<void> {
  const passages  = await getReadingPassages(examId);
  const passage   = passages.find(p => p.passage_number === passageNumber);
  if (!passage) return;

  const questions = await getQuestions(examId, "reading", passageNumber);

  // Send passage text (may be long, split if needed)
  const passageText = `📖 <b>READING — PASSAGE ${passageNumber}</b>\n<b>"${passage.title}"</b>\n\n${passage.text}`;
  if (passageText.length > 4000) {
    await bot.sendMessage(chatId, `📖 <b>READING — PASSAGE ${passageNumber}: "${passage.title}"</b>`, { parse_mode: "HTML" });
    // Split into chunks
    const chunks = splitText(passage.text, 3500);
    for (const chunk of chunks) await bot.sendMessage(chatId, chunk);
  } else {
    await bot.sendMessage(chatId, passageText, { parse_mode: "HTML" });
  }

  await new Promise(r => setTimeout(r, 500));

  // Send questions
  let qText = `\n📝 <b>PASSAGE ${passageNumber} SAVOLLAR (${questions[0]?.question_number}–${questions[questions.length - 1]?.question_number}):</b>\n\n`;
  for (const q of questions) {
    qText += `<b>${q.question_number}.</b> ${q.question_text}`;
    if (q.question_type === "true_false_ng") qText += `\n   (TRUE / FALSE / NOT GIVEN)`;
    if (q.options) {
      const opts = q.options as unknown as string[];
      opts.forEach(o => { qText += `\n   ${o}`; });
    }
    qText += "\n\n";
  }
  qText += `✏️ Javoblarni yozing: <code>14. TRUE\n15. FALSE\n16. TRUE</code>`;

  await bot.sendMessage(chatId, qText, { parse_mode: "HTML" });

  const sess = getIeltsSession(chatId);
  if (sess) { sess.partNumber = passageNumber; setIeltsSession(chatId, sess); }
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function processReadingAnswers(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const sess = getIeltsSession(chatId);
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
    await bot.sendMessage(chatId, "❓ Format noto'g'ri. Misol:\n<code>1. TRUE\n2. FALSE\n7. B</code>", { parse_mode: "HTML" });
    return;
  }

  const questions = await getQuestions(sess.examId, "reading", sess.partNumber);
  for (const q of questions) {
    const ans = parsed[q.question_number];
    if (ans !== undefined) {
      const correct = ans.toLowerCase() === q.correct_answer.toLowerCase();
      await saveAnswer(sess.userExamId, q.id, "reading", ans, correct);
    }
  }

  const allQs = await getQuestions(sess.examId, "reading");
  const totalAnswered = await countAnsweredQuestions(sess.userExamId, "reading");

  await bot.sendMessage(chatId,
    `✅ <b>Passage ${sess.partNumber} javoblari qabul qilindi!</b>\n📊 Jami: ${totalAnswered}/${allQs.length}`,
    { parse_mode: "HTML" }
  );

  if (sess.partNumber < 3) {
    sess.partNumber++;
    setIeltsSession(chatId, sess);
    await new Promise(r => setTimeout(r, 1000));
    await sendReadingPassage(bot, chatId, sess.userExamId, sess.examId, sess.partNumber);
  } else {
    clearSectionTimer(chatId);
    await finishReading(bot, chatId, sess.userExamId, sess.examId);
  }
}

async function finishReading(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  clearSectionTimer(chatId);
  const correct = await countCorrectAnswers(userExamId, "reading");
  const band    = rawToReadingBand(correct);

  await bot.sendMessage(
    chatId,
    `✅ <b>READING yakunlandi!</b>\n\n` +
    `📊 To'g'ri javoblar: <b>${correct}/40</b>\n` +
    `🎯 Reading Band: <b>${band}</b> ${bandEmoji(band)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✍️ Keyingi bo'lim: <b>WRITING</b>\n⏱ Vaqt: <b>60 daqiqa</b>`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 2000));
  await startWriting(bot, chatId, userExamId, examId);
}

// ═══════════════════════════════════════════════════════════════════════
// WRITING
// ═══════════════════════════════════════════════════════════════════════
async function startWriting(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_TIMES.writing * 60 * 1000;
  await updateUserExamStatus(userExamId, "writing", deadlineMs);

  setIeltsSession(chatId, {
    userExamId, examId, section: "writing", partNumber: 1,
    questionIndex: 0, pendingAnswers: {}, sectionDeadlineMs: deadlineMs,
    writingTaskNumber: 1,
  });

  setSectionTimer(chatId, {
    section: "writing",
    deadlineMs,
    timerId: setTimeout(async () => {
      await finishWriting(bot, chatId, userExamId, examId);
    }, SECTION_TIMES.writing * 60 * 1000),
  });

  const tasks = await getWritingTasks(examId);
  const task1 = tasks.find(t => t.task_number === 1);

  await bot.sendMessage(
    chatId,
    `✍️ <b>WRITING BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>60 daqiqa</b>\n` +
    `📋 2 ta vazifa\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<b>TASK 1</b> (≥150 so'z, ~20 daqiqa):\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${task1?.prompt ?? "Task 1 topshirig'i yuklanmadi"}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✏️ Javobingizni to'liq matn sifatida yuboring.`,
    { parse_mode: "HTML" }
  );
}

async function processWritingSubmission(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const sess = getIeltsSession(chatId);
  if (!sess || sess.section !== "writing") return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b> Javoblaringiz qabul qilinmadi.", { parse_mode: "HTML" });
    return;
  }

  const wordCount = text.trim().split(/\s+/).length;
  const taskNum   = sess.writingTaskNumber ?? 1;
  const minWords  = taskNum === 1 ? 150 : 250;

  if (wordCount < 50) {
    await bot.sendMessage(chatId,
      `⚠️ Matn juda qisqa (${wordCount} so'z). Iltimos kamida ${minWords} so'z yozing.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const processingMsg = await bot.sendMessage(chatId,
    `⏳ <b>Task ${taskNum} AI tomonidan baholanmoqda...</b>\nBu bir necha daqiqa olishi mumkin.`,
    { parse_mode: "HTML" }
  );

  const tasks  = await getWritingTasks(sess.examId);
  const task   = tasks.find(t => t.task_number === taskNum);
  const feedback = await evaluateWriting(taskNum, task?.prompt ?? "", text);

  await saveWritingSubmission(sess.userExamId, taskNum, text, feedback.band_score, feedback);

  await bot.editMessageText(
    `✅ <b>TASK ${taskNum} NATIJASI:</b>\n\n` +
    `🎯 Band Score: <b>${feedback.band_score}</b> ${bandEmoji(feedback.band_score)}\n\n` +
    `📊 <b>Mezonlar:</b>\n` +
    `• Task Achievement: ${feedback.task_achievement?.toFixed(1)}\n` +
    `• Coherence & Cohesion: ${feedback.coherence_cohesion?.toFixed(1)}\n` +
    `• Lexical Resource: ${feedback.lexical_resource?.toFixed(1)}\n` +
    `• Grammatical Range: ${feedback.grammatical_range?.toFixed(1)}\n\n` +
    `✅ <b>Kuchli tomonlar:</b>\n${feedback.strengths.map(s => `• ${s}`).join("\n")}\n\n` +
    `❌ <b>Zaif tomonlar:</b>\n${feedback.weaknesses.map(w => `• ${w}`).join("\n")}\n\n` +
    `💬 <b>Batafsil:</b> ${feedback.detailed_feedback}\n\n` +
    `📝 So'z soni: ${wordCount}`,
    { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: "HTML" }
  );

  if (taskNum === 1) {
    sess.writingTaskNumber = 2;
    setIeltsSession(chatId, sess);
    const task2 = tasks.find(t => t.task_number === 2);

    await bot.sendMessage(
      chatId,
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>TASK 2</b> (≥250 so'z, ~40 daqiqa):\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${task2?.prompt ?? "Task 2 yuklanmadi"}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✏️ Javobingizni to'liq matn sifatida yuboring.`,
      { parse_mode: "HTML" }
    );
  } else {
    clearSectionTimer(chatId);
    await finishWriting(bot, chatId, sess.userExamId, sess.examId);
  }
}

async function finishWriting(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  clearSectionTimer(chatId);
  const subs = await getWritingSubmissions(userExamId);
  const avg  = subs.length > 0 ? subs.reduce((a, b) => a + (b.ai_score ?? 5), 0) / subs.length : 5.0;
  const band = roundToBand(avg);

  await bot.sendMessage(
    chatId,
    `✅ <b>WRITING yakunlandi!</b>\n\n` +
    `🎯 Writing Band: <b>${band}</b> ${bandEmoji(band)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🗣 Keyingi bo'lim: <b>SPEAKING</b>\n⏱ Vaqt: <b>15 daqiqa</b>`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 2000));
  await startSpeaking(bot, chatId, userExamId, examId);
}

// ═══════════════════════════════════════════════════════════════════════
// SPEAKING
// ═══════════════════════════════════════════════════════════════════════
async function startSpeaking(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  const deadlineMs = Date.now() + SECTION_TIMES.speaking * 60 * 1000;
  await updateUserExamStatus(userExamId, "speaking", deadlineMs);

  setIeltsSession(chatId, {
    userExamId, examId, section: "speaking", partNumber: 1,
    questionIndex: 0, pendingAnswers: {}, sectionDeadlineMs: deadlineMs,
    speakingCollecting: false,
  });

  setSectionTimer(chatId, {
    section: "speaking",
    deadlineMs,
    timerId: setTimeout(async () => {
      await finishSpeaking(bot, chatId, userExamId, examId);
    }, SECTION_TIMES.speaking * 60 * 1000),
  });

  await bot.sendMessage(
    chatId,
    `🗣 <b>SPEAKING BO'LIMI BOSHLANDI!</b>\n\n` +
    `⏱ Vaqt: <b>15 daqiqa</b>\n` +
    `📋 3 qism: Part 1, Part 2, Part 3\n\n` +
    `<b>Ko'rsatma:</b>\n` +
    `• Har bir savolga <b>ovozli xabar</b> yuboring\n` +
    `• Inglizcha gapirishga harakat qiling\n` +
    `• AI nutqingizni tahlil qiladi\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "HTML" }
  );

  await new Promise(r => setTimeout(r, 1500));
  await sendSpeakingPart(bot, chatId, userExamId, examId, 1);
}

async function sendSpeakingPart(bot: TelegramBot, chatId: number, userExamId: number, examId: number, partNumber: number): Promise<void> {
  const questions = await getSpeakingQuestions(examId, partNumber);

  const partDesc = partNumber === 1
    ? "Introduction & Interview (4–5 daqiqa)"
    : partNumber === 2
    ? "Individual Long Turn (3–4 daqiqa)"
    : "Two-way Discussion (4–5 daqiqa)";

  let qText = `🗣 <b>SPEAKING — PART ${partNumber}</b>\n<i>${partDesc}</i>\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  for (const q of questions) {
    qText += `❓ <b>Savol ${q.question_number}:</b>\n${q.question_text}\n\n`;
  }
  qText += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  qText += `🎤 <b>Barcha savollarga javob beruvchi ovozli xabar yuboring</b>`;

  await bot.sendMessage(chatId, qText, { parse_mode: "HTML" });

  const sess = getIeltsSession(chatId);
  if (sess) { sess.partNumber = partNumber; sess.speakingCollecting = true; setIeltsSession(chatId, sess); }
}

async function processSpeakingVoice(bot: TelegramBot, chatId: number, fileLink: string): Promise<void> {
  const sess = getIeltsSession(chatId);
  if (!sess || sess.section !== "speaking" || !sess.speakingCollecting) return;

  if (Date.now() > sess.sectionDeadlineMs) {
    await bot.sendMessage(chatId, "⏰ <b>Vaqt tugadi!</b>", { parse_mode: "HTML" });
    return;
  }

  const processingMsg = await bot.sendMessage(chatId, "🎙 Nutqingiz tahlil qilinmoqda...");

  const transcript = await transcribeForSpeaking(fileLink);
  const questions  = await getSpeakingQuestions(sess.examId, sess.partNumber);
  const qTexts     = questions.map(q => q.question_text);

  const feedback = await evaluateSpeaking(sess.partNumber, qTexts, transcript);
  await saveSpeakingSubmission(sess.userExamId, sess.partNumber, transcript, feedback.band_score, feedback);

  await bot.editMessageText(
    `✅ <b>SPEAKING Part ${sess.partNumber} NATIJASI:</b>\n\n` +
    `🎯 Band Score: <b>${feedback.band_score}</b> ${bandEmoji(feedback.band_score)}\n\n` +
    `📊 <b>Mezonlar:</b>\n` +
    `• Fluency & Coherence: ${feedback.fluency_coherence?.toFixed(1)}\n` +
    `• Pronunciation: ${feedback.pronunciation?.toFixed(1)}\n` +
    `• Lexical Resource: ${feedback.lexical_resource?.toFixed(1)}\n` +
    `• Grammatical Range: ${feedback.grammatical_range?.toFixed(1)}\n\n` +
    `✅ <b>Kuchli:</b>\n${feedback.strengths.map(s => `• ${s}`).join("\n")}\n\n` +
    `❌ <b>Zaif:</b>\n${feedback.weaknesses.map(w => `• ${w}`).join("\n")}\n\n` +
    `📝 <b>Transcript:</b> <i>${transcript.slice(0, 300)}${transcript.length > 300 ? "..." : ""}</i>`,
    { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: "HTML" }
  );

  sess.speakingCollecting = false;
  setIeltsSession(chatId, sess);

  if (sess.partNumber < 3) {
    sess.partNumber++;
    sess.speakingCollecting = true;
    setIeltsSession(chatId, sess);
    await new Promise(r => setTimeout(r, 1500));
    await sendSpeakingPart(bot, chatId, sess.userExamId, sess.examId, sess.partNumber);
  } else {
    clearSectionTimer(chatId);
    await finishSpeaking(bot, chatId, sess.userExamId, sess.examId);
  }
}

async function finishSpeaking(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  clearSectionTimer(chatId);
  const subs = await getSpeakingSubmissions(userExamId);
  const avg  = subs.length > 0 ? subs.reduce((a, b) => a + (b.ai_score ?? 5), 0) / subs.length : 5.0;
  const band = roundToBand(avg);

  await bot.sendMessage(chatId,
    `✅ <b>SPEAKING yakunlandi!</b>\n🎯 Speaking Band: <b>${band}</b> ${bandEmoji(band)}\n\n🏁 Natijalar hisoblanmoqda...`,
    { parse_mode: "HTML" }
  );

  await calculateAndShowResults(bot, chatId, userExamId, examId);
}

// ═══════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════
async function calculateAndShowResults(bot: TelegramBot, chatId: number, userExamId: number, examId: number): Promise<void> {
  const lCorrect = await countCorrectAnswers(userExamId, "listening");
  const rCorrect = await countCorrectAnswers(userExamId, "reading");
  const wSubs    = await getWritingSubmissions(userExamId);
  const sSubs    = await getSpeakingSubmissions(userExamId);

  const lBand = rawToListeningBand(lCorrect);
  const rBand = rawToReadingBand(rCorrect);
  const wBand = roundToBand(wSubs.length > 0 ? wSubs.reduce((a, b) => a + (b.ai_score ?? 5), 0) / wSubs.length : 5.0);
  const sBand = roundToBand(sSubs.length > 0 ? sSubs.reduce((a, b) => a + (b.ai_score ?? 5), 0) / sSubs.length : 5.0);

  await saveScores(userExamId, lBand, rBand, wBand, sBand, calcOverall(lBand, rBand, wBand, sBand));
  await updateUserExamStatus(userExamId, "completed");
  clearIeltsSession(chatId);

  await sendResults(bot, chatId, lBand, rBand, wBand, sBand);
}

async function sendResults(bot: TelegramBot, chatId: number, l: number, r: number, w: number, s: number): Promise<void> {
  const overall = calcOverall(l, r, w, s);
  await bot.sendMessage(
    chatId,
    `╔════════════════════════════╗\n` +
    `   🏆 IELTS MOCK EXAM NATIJA\n` +
    `╚════════════════════════════╝\n\n` +
    `🎧 <b>Listening:</b>  ${l.toFixed(1)}  ${bandEmoji(l)}\n` +
    `📖 <b>Reading:</b>    ${r.toFixed(1)}  ${bandEmoji(r)}\n` +
    `✍️ <b>Writing:</b>    ${w.toFixed(1)}  ${bandEmoji(w)}\n` +
    `🗣 <b>Speaking:</b>   ${s.toFixed(1)}  ${bandEmoji(s)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎯 <b>OVERALL BAND SCORE: ${overall.toFixed(1)}</b> ${bandEmoji(overall)}\n` +
    `📊 <i>${bandDescription(overall)}</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `✅ Imtihon muvaffaqiyatli yakunlandi!\n` +
    `📚 Davom eting va natijangizni yaxshilang!`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "🔄 Yana IELTS topshirish", callback_data: "ielts:pay" },
        ]],
      },
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PAYMENT FLOW
// ═══════════════════════════════════════════════════════════════════════
export async function handleIeltsPayCallback(bot: TelegramBot, chatId: number, firstName: string, username?: string): Promise<void> {
  const exam = await getActiveExam();
  if (!exam) return;

  let ue = await getUserExam(chatId);
  if (!ue || ["completed", "expired"].includes(ue.status)) {
    ue = await createUserExam(chatId, exam.id);
  }

  setIeltsPaymentPending(chatId, firstName, username);

  await bot.sendMessage(
    chatId,
    `🎓 <b>IELTS MOCK EXAM — TO'LOV</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 Narxi: <b>${IELTS_PRICE}</b> (bir martalik)\n` +
    `📋 Barcha 4 bo'lim: Listening, Reading, Writing, Speaking\n` +
    `📊 AI tomonidan baholash\n` +
    `🏆 IELTS Band Score natijasi\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💳 <b>Karta raqamiga to'lov qiling:</b>\n\n` +
    `<code>${IELTS_CARD}</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📸 To'lovdan so'ng <b>chek rasmini (skrinshotini) shu yerga yuboring</b>\n\n` +
    `⚡ <b>5–15 daqiqa</b> ichida tasdiqlanadi!`,
    { parse_mode: "HTML" }
  );
}

export async function handleIeltsPaymentPhoto(bot: TelegramBot, msg: Message, photoFileId: string): Promise<void> {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name ?? "User";
  const username  = msg.from?.username;

  const ue = await getUserExam(chatId);
  if (!ue) return;

  await setPaymentPhoto(ue.id, photoFileId);
  clearIeltsPaymentPending(chatId);

  await bot.sendMessage(
    chatId,
    `✅ <b>Chekingiz qabul qilindi!</b>\n\n` +
    `⏳ Admin tekshirib, tez orada tasdiqlanadi.\n` +
    `Odatda <b>5–15 daqiqa</b> ichida IELTS testingiz ochiladi!\n\n` +
    `🙏 Sabr qiling.`,
    { parse_mode: "HTML", reply_markup: mainKb() }
  );

  const adminId = getAdminChatId();
  if (adminId) {
    const name    = username ? `@${username}` : firstName;
    const caption =
      `💳 <b>YANGI IELTS TO'LOV SO'ROVI!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Foydalanuvchi: ${name}\n` +
      `🆔 ID: <code>${chatId}</code>\n` +
      `💰 Summa: ${IELTS_PRICE}\n` +
      `🎓 Xizmat: IELTS Mock Exam\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ Tasdiqlash: /ielts_confirm_${chatId}\n` +
      `❌ Rad etish: /ielts_reject_${chatId}`;
    bot.sendPhoto(adminId, photoFileId, { caption, parse_mode: "HTML" }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN COMMANDS
// ═══════════════════════════════════════════════════════════════════════
export async function registerIeltsHandlers(bot: TelegramBot): Promise<void> {

  // Confirm payment
  bot.onText(/\/ielts_confirm_(\d+)/, async (msg, match) => {
    if (!isIeltsAdmin(msg)) return;
    const userId = parseInt(match![1]!, 10);
    const ue     = await getUserExam(userId);
    if (!ue) { await bot.sendMessage(msg.chat.id, "❌ Foydalanuvchi topilmadi."); return; }

    await updateUserExamStatus(ue.id, "paid");
    await bot.sendMessage(msg.chat.id,
      `✅ <b>IELTS to'lov tasdiqlandi!</b>\n👤 ID: <code>${userId}</code>`,
      { parse_mode: "HTML" }
    );

    const token = createExamToken({ userId, examType: "ielts", userExamId: ue.id, examId: ue.exam_id });
    const webAppUrl = getWebAppUrl(token);

    await bot.sendMessage(userId,
      `╔══════════════════════════════╗\n` +
      `   ✅ IELTS IMTIHON TAYYOR!\n` +
      `╚══════════════════════════════╝\n\n` +
      `🎓 <b>IELTS Mock Exam</b> uchun to'lovingiz tasdiqlandi!\n\n` +
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
            { text: "🚀 IELTS imtihonini boshlash", web_app: { url: webAppUrl } },
          ]],
        },
      }
    );
  });

  // Reject payment
  bot.onText(/\/ielts_reject_(\d+)/, async (msg, match) => {
    if (!isIeltsAdmin(msg)) return;
    const userId = parseInt(match![1]!, 10);
    const ue     = await getUserExam(userId);
    if (ue) { await updateUserExamStatus(ue.id, "pending_payment"); }
    await bot.sendMessage(msg.chat.id, `❌ Rad etildi. ID: <code>${userId}</code>`, { parse_mode: "HTML" });
    bot.sendMessage(userId,
      `❌ <b>IELTS to'lovingiz rad etildi.</b>\nMuammo bo'lsa @${ADMIN_USER} bilan bog'laning.`,
      { parse_mode: "HTML", reply_markup: mainKb() }
    ).catch(() => {});
  });

  // Admin: view IELTS stats
  bot.onText(/\/ielts_admin/, async (msg) => {
    if (!isIeltsAdmin(msg)) return;
    const stats   = await getUserExamStats();
    const pending = await getPendingIeltsPayments();
    const exams   = await listExams();

    let text =
      `╔══════════════════════════╗\n🎓 IELTS ADMIN PANEL\n╚══════════════════════════╝\n\n` +
      `📊 <b>STATISTIKA:</b>\n` +
      `┣ Jami imtihon: <b>${stats.total}</b>\n` +
      `┣ Yakunlangan: <b>${stats.completed}</b>\n` +
      `┗ To'langan: <b>${stats.paid}</b>\n\n` +
      `⏳ <b>Kutilayotgan to'lovlar: ${pending.length}</b>\n`;

    for (const p of pending) {
      text += `\n👤 ID <code>${p.user_id}</code>\n`;
      text += `✅ /ielts_confirm_${p.user_id}  ❌ /ielts_reject_${p.user_id}\n`;
    }

    text += `\n📋 <b>IMTIHONLAR:</b>\n`;
    for (const e of exams) {
      text += `• [${e.is_active ? "✅ FAOL" : "💤"}] ${e.title} (ID: ${e.id})\n`;
      text += `  /ielts_activate_${e.id}\n`;
    }

    await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
  });

  // Admin: activate exam
  bot.onText(/\/ielts_activate_(\d+)/, async (msg, match) => {
    if (!isIeltsAdmin(msg)) return;
    const id = parseInt(match![1]!, 10);
    await activateExam(id);
    await bot.sendMessage(msg.chat.id, `✅ Imtihon ${id} faollashtirildi.`);
  });

  // Admin: add audio to listening part
  bot.onText(/\/ielts_audio_(\d+)_(\d+)/, async (msg, match) => {
    if (!isIeltsAdmin(msg)) return;
    const examId     = parseInt(match![1]!, 10);
    const partNumber = parseInt(match![2]!, 10);
    setAdminAction(msg.chat.id, { type: "awaiting_audio", examId, partNumber });
    await bot.sendMessage(msg.chat.id,
      `🎧 Exam ${examId}, Part ${partNumber} uchun audio fayl yuboring.`
    );
  });

  // Admin: pending payments
  bot.onText(/\/ielts_pending/, async (msg) => {
    if (!isIeltsAdmin(msg)) return;
    const pending = await getPendingIeltsPayments();
    if (pending.length === 0) { await bot.sendMessage(msg.chat.id, "✅ Kutilayotgan to'lovlar yo'q."); return; }
    let text = `⏳ <b>Kutilayotgan IELTS to'lovlar (${pending.length}):</b>\n\n`;
    for (const p of pending) {
      text += `👤 ID <code>${p.user_id}</code>\n`;
      text += `✅ /ielts_confirm_${p.user_id}  ❌ /ielts_reject_${p.user_id}\n\n`;
    }
    await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
  });

  // /ielts command
  bot.onText(/\/ielts/, async (msg) => {
    await handleIeltsEntry(bot, msg.chat.id);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// INCOMING MESSAGE ROUTER (called from main handlers.ts)
// ═══════════════════════════════════════════════════════════════════════
export async function routeIeltsMessage(bot: TelegramBot, msg: Message): Promise<boolean> {
  const chatId    = msg.chat.id;
  const sess      = getIeltsSession(chatId);
  const adminAct  = getAdminAction(chatId);
  const isPending = getIeltsPaymentPending(chatId);

  // Admin audio upload
  if (adminAct.type === "awaiting_audio" && msg.audio) {
    const fileId = msg.audio.file_id;
    const { upsertListeningPart } = await import("./db.js");
    await upsertListeningPart(adminAct.examId, adminAct.partNumber, fileId);
    clearAdminAction(chatId);
    await bot.sendMessage(chatId, `✅ Audio saqlandi! Part ${adminAct.partNumber}, Exam ${adminAct.examId}`);
    return true;
  }

  // Timer query
  if (msg.text === "⏱ Vaqt qoldi?" && sess) {
    const left = sess.sectionDeadlineMs - Date.now();
    await bot.sendMessage(chatId,
      `⏱ <b>${sess.section.toUpperCase()}</b> bo'limi uchun qolgan vaqt: <b>${fmtTime(left)}</b>`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  // Exit exam
  if (msg.text === "🏳 Testdan chiqish" && sess) {
    clearIeltsSession(chatId);
    clearSectionTimer(chatId);
    await bot.sendMessage(chatId,
      "⚠️ Testdan chiqdingiz. Natijalar saqlanmaydi.\n📝 Qayta boshlash: /ielts",
      { reply_markup: mainKb() }
    );
    return true;
  }

  // Active exam session routing
  if (sess) {
    if (sess.section === "listening" && msg.text && !msg.text.startsWith("/")) {
      await processListeningAnswers(bot, chatId, msg.text);
      return true;
    }
    if (sess.section === "reading" && msg.text && !msg.text.startsWith("/")) {
      await processReadingAnswers(bot, chatId, msg.text);
      return true;
    }
    if (sess.section === "writing" && msg.text && !msg.text.startsWith("/")) {
      await processWritingSubmission(bot, chatId, msg.text);
      return true;
    }
    if (sess.section === "speaking" && msg.voice) {
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      await processSpeakingVoice(bot, chatId, fileLink);
      return true;
    }
    if (sess.section === "speaking" && msg.text && !msg.text.startsWith("/")) {
      // Allow text answers for speaking too
      await processSpeakingVoice(bot, chatId, ""); // will get empty transcript
      return true;
    }
  }

  return false;
}
