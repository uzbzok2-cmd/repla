import TelegramBot, {
  type ReplyKeyboardMarkup,
  type Message,
  type InlineKeyboardMarkup,
} from "node-telegram-bot-api";
import {
  handleIeltsEntry,
  handleIeltsPayCallback,
  handleIeltsPaymentPhoto,
  routeIeltsMessage,
} from "./ielts/handlers.js";
import { getIeltsPaymentPending } from "./ielts/state.js";
import {
  getProfile, upsertProfile, updateProfilePhone, touchLastSeen,
  isRegistered, getRegStep, setRegStep, clearRegStep,
} from "./registration.js";
import {
  handleCertEntry, handleCertLevelChosen, handleCertPay,
  handleCertPaymentPhoto, startCertExam,
  handleMyResults, routeCertMessage, registerCertHandlers,
} from "./cert/handlers.js";
import { getCertPaymentPending } from "./cert/state.js";
import { transcribeAudio, getTutorReply, textToSpeech } from "./ai.js";
import {
  getSession,
  addMessage,
  clearSession,
  getSystemPrompt,
  getMode,
  setMode,
  recordVoiceMessage,
  recordTextMessage,
  recordCorrection,
  resetStats,
  formatStats,
  type LearningMode,
} from "./sessions.js";
import {
  canSend,
  isSubscribed,
  consumeFree,
  getFreeLeft,
  grantAccess,
  addPending,
  removePending,
  getPending,
  allPending,
  getFlow,
  setFlow,
  clearFlow,
  registerReferral,
  tryGiveBonus,
  formatStatus,
  formatAdminStats,
  setAdminChatId,
  getAdminChatId,
  resetFree,
  registerUser,
  LANGUAGES,
  CARD_NUMBER,
  PRICE_UZS,
  ADMIN_USERNAME,
  type PendingPayment,
} from "./subscription.js";
import { dbSaveAdminChatId } from "./registration.js";

// ── Button texts ─────────────────────────────────────────────────────
const BTN_RUSSIAN   = "🇷🇺 Ruscha";
const BTN_ENGLISH   = "🇬🇧 Inglizcha";
const BTN_TURKISH   = "🇹🇷 Turkcha";
const BTN_STATUS    = "📊 Obuna holati";
const BTN_SUBSCRIBE = "💳 Obuna olish";
const BTN_REFERRAL  = "🔗 Do'st taklif";
const BTN_STATS     = "📈 Statistika";
const BTN_HELP      = "ℹ️ Yordam";
const BTN_BACK      = "🔙 Bosh menyu";

// ── Message ID tracking for deletion ─────────────────────────────────
const regBotMsg     = new Map<number, number>(); // chatId -> last reg bot msg ID
const paymentInstrMsg = new Map<number, number>(); // chatId -> payment instr msg ID

async function safeDelete(bot: TelegramBot, chatId: number, msgId: number | undefined): Promise<void> {
  if (!msgId) return;
  try { await bot.deleteMessage(chatId, msgId); } catch { /* ignore */ }
}

// ── Keyboards ────────────────────────────────────────────────────────
const BTN_IELTS = "📝 IELTS Mock Exam";
const BTN_CERT  = "🎓 Rus tili sertifikati";

const MAIN_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: BTN_RUSSIAN }, { text: BTN_ENGLISH }, { text: BTN_TURKISH }],
    [{ text: BTN_STATUS }, { text: BTN_SUBSCRIBE }],
    [{ text: BTN_IELTS }, { text: BTN_CERT }],
    [{ text: BTN_REFERRAL }, { text: BTN_STATS }],
    [{ text: BTN_HELP }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

function langInlineKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      LANGUAGES.map((l) => ({
        text: `${l.flag} ${l.label}`,
        callback_data: `pay_lang:${l.key}`,
      })),
    ],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────
function isAdmin(msg: Message): boolean {
  return msg.from?.username === ADMIN_USERNAME;
}

function langLabel(lang: LearningMode): string {
  const found = LANGUAGES.find((l) => l.key === lang);
  return found ? `${found.flag} ${found.label}` : lang;
}

function getModeWelcome(mode: LearningMode): string {
  const tutor =
    mode === "russian" ? "Natasha 🇷🇺" :
    mode === "english" ? "Emma 🇬🇧" : "Aysha 🇹🇷";
  const examples =
    mode === "russian" ? `"ovqat", "sport", "sayohat"` :
    mode === "english" ? `"food", "sport", "travel"` : `"yemek", "spor", "seyahat"`;

  return (
    `✨ <b>${langLabel(mode)} rejimi tanlandi!</b>\n\n` +
    `👩‍🏫 O'qituvchingiz: <b>${tutor}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎤 Ovozli xabar yuboring\n` +
    `✍️ Matn yozing\n` +
    `🎯 Mavzu bering: ${examples}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🚀 Boshlang!`
  );
}

async function showNoAccessMessage(bot: TelegramBot, chatId: number, lang: LearningMode): Promise<void> {
  await bot.sendMessage(
    chatId,
    `🔒 <b>${langLabel(lang)} — Bepul xabarlar tugadi!</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📚 Davom etish uchun haftalik obuna kerak\n` +
    `💰 Narxi: <b>${PRICE_UZS}</b> / hafta\n` +
    `📅 Muddat: <b>7 kun</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👇 Qaysi til uchun obuna olmoqchisiz?`,
    { parse_mode: "HTML", reply_markup: langInlineKeyboard() }
  );
}

async function showPaymentInstructions(bot: TelegramBot, chatId: number, lang: LearningMode): Promise<void> {
  setFlow(chatId, { state: "waiting_receipt", language: lang });
  const sent = await bot.sendMessage(
    chatId,
    `🎓 <b>HAFTALIK OBUNA — ${langLabel(lang).toUpperCase()}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 Narxi: <b>${PRICE_UZS}</b>\n` +
    `📅 Muddat: <b>7 kun</b>\n` +
    `♾️ Xabarlar: <b>Cheksiz</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💳 <b>Quyidagi karta raqamiga to'lov qiling:</b>\n\n` +
    `<code>${CARD_NUMBER}</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📸 To'lov qilgandan so'ng <b>chek rasmini</b> yoki <b>PDF hujjatini</b> shu yerga yuboring\n\n` +
    `⚡ Odatda <b>5–15 daqiqa</b> ichida tasdiqlanadi\n` +
    `✅ Admin tasdiqlashi bilan dostupingiz darhol ochiladi!`,
    { parse_mode: "HTML" }
  );
  paymentInstrMsg.set(chatId, sent.message_id);
}

async function showHelpMessage(bot: TelegramBot, chatId: number): Promise<void> {
  setFlow(chatId, { state: "help_mode" });
  const helpKb = {
    keyboard: [[{ text: BTN_BACK }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
  await bot.sendMessage(
    chatId,
    `╔══════════════════════════╗\n` +
    `   🛟 <b>OPERATOR BILAN BOG'LANISH</b>\n` +
    `╚══════════════════════════╝\n\n` +
    `👨‍💼 <b>Hurmatli foydalanuvchi!</b>\n\n` +
    `Quyida savolingizni yozing yoki rasm / video / fayl yuboring — operatorimiz tez orada ko'rib chiqadi va javob beradi.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📞 Bevosita murojaat: <b>@${ADMIN_USERNAME}</b>\n` +
    `⏰ Ish vaqti: <b>09:00 – 22:00</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⬇️ <i>Xabaringizni yuboring:</i>`,
    { parse_mode: "HTML", reply_markup: helpKb }
  );
}

// ── Handler registration ─────────────────────────────────────────────
export function registerHandlers(bot: TelegramBot): void {

  // Bot command menu yashirilgan
  bot.setMyCommands([]).catch(() => {});

  // ── /start (+ referral support) ──────────────────────────────────
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const param  = (match?.[1] ?? "").trim();

    if (isAdmin(msg)) { setAdminChatId(chatId); dbSaveAdminChatId(chatId).catch(() => {}); }
    registerUser(userId, msg.from!.first_name, msg.from?.username);

    clearSession(chatId);
    resetStats(chatId);
    resetFree(chatId);
    clearFlow(chatId);

    // Referral handling
    if (param.startsWith("ref_")) {
      const referrerId = parseInt(param.slice(4), 10);
      if (!isNaN(referrerId) && referrerId !== userId) {
        const isNew = registerReferral(userId, referrerId);
        if (isNew && tryGiveBonus(referrerId, userId)) {
          bot.sendMessage(
            referrerId,
            `🎉 <b>Tabriklaymiz!</b>\n\n` +
            `Do'stingiz siz orqali botga qo'shildi!\n\n` +
            `🎁 <b>Mukofot:</b> har bir til uchun +3 ta bepul xabar qo'shildi!`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }
    }

    // Check if user is registered
    const registered = await isRegistered(userId).catch(() => false);
    if (!registered) {
      clearRegStep(userId);
      setRegStep(userId, { step: "asking_name" });
      const m = await bot.sendMessage(
        chatId,
        `👋 <b>Xush kelibsiz!</b>\n\n` +
        `🤖 Men AI til o'qituvchisi va Rus tili sertifikat bo'timan!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 Avval ro'yxatdan o'tishingiz kerak.\n` +
        `Bu faqat bir marta va faqat 1 daqiqa vaqt oladi.\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `1️⃣ <b>To'liq ismingizni kiriting</b>\n` +
        `(Ism va familiya, masalan: Alisher Karimov)`,
        { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
      );
      regBotMsg.set(userId, m.message_id);
      return;
    }

    await touchLastSeen(userId).catch(() => {});
    await bot.sendMessage(
      chatId,
      `👋 <b>Xush kelibsiz!</b>\n\n` +
      `🤖 Men AI til o'qituvchisiman!\n` +
      `O'zbek tilidagi talabalar uchun 3 ta tilni o'rgataman.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆓 Har bir til uchun <b>3 ta bepul xabar</b>\n` +
      `💳 Undan keyin: <b>${PRICE_UZS} / til / hafta</b>\n` +
      `🎓 Rus tili B2/C1 sertifikati: <b>28 000 so'm</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👇 Qaysi tilni o'rganmoqchisiz?`,
      { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
    );
  });

  // ── /mode ────────────────────────────────────────────────────────
  bot.onText(/\/mode/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "🔄 Tilni tanlang:", { reply_markup: MAIN_KEYBOARD });
  });

  // ── /clear ───────────────────────────────────────────────────────
  bot.onText(/\/clear/, async (msg) => {
    clearSession(msg.chat.id);
    await bot.sendMessage(
      msg.chat.id,
      "🗑 <b>Suhbat tarixi tozalandi!</b>\nDavom eting 🎤",
      { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
    );
  });

  // ── /stats ───────────────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    await bot.sendMessage(msg.chat.id, formatStats(msg.chat.id), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD });
  });

  // ── /status ──────────────────────────────────────────────────────
  bot.onText(/\/status/, async (msg) => {
    await bot.sendMessage(msg.chat.id, formatStatus(msg.chat.id), {
      parse_mode: "HTML",
      reply_markup: MAIN_KEYBOARD,
    });
  });

  // ── /subscribe ───────────────────────────────────────────────────
  bot.onText(/\/subscribe/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      `💳 <b>Haftalik obuna</b>\n\n💰 Narxi: <b>${PRICE_UZS}</b> / til / hafta\n\n👇 Qaysi til uchun obuna olmoqchisiz?`,
      { parse_mode: "HTML", reply_markup: langInlineKeyboard() }
    );
  });

  // ── /referral ────────────────────────────────────────────────────
  bot.onText(/\/referral/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const me = await bot.getMe();
      const link = `https://t.me/${me.username}?start=ref_${chatId}`;
      await bot.sendMessage(
        chatId,
        `🔗 <b>Do'stlarni taklif qiling!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Sizning shaxsiy havolangiz:\n\n` +
        `<code>${link}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎁 <b>Mukofot:</b>\n` +
        `• Do'stingiz qo'shilsa → u ham <b>3 ta bepul xabar</b> oladi (har tilga)\n` +
        `• Siz → har tilga <b>+3 ta bepul xabar</b> olasiz\n\n` +
        `👥 Qancha ko'p taklif, shuncha ko'p bepul xabar!`,
        { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
      );
    } catch {
      await bot.sendMessage(chatId, "Havola olishda xatolik. Qaytadan urinib ko'ring.");
    }
  });

  // ── /help ────────────────────────────────────────────────────────
  bot.onText(/\/help/, async (msg) => {
    await showHelpMessage(bot, msg.chat.id);
  });

  // ════════════════════════════════════════════════════════════════════
  // ADMIN COMMANDS
  // ════════════════════════════════════════════════════════════════════

  bot.onText(/\/admin/, async (msg) => {
    if (!isAdmin(msg)) return;
    setAdminChatId(msg.chat.id);
    dbSaveAdminChatId(msg.chat.id).catch(() => {});
    await bot.sendMessage(msg.chat.id, formatAdminStats(), {
      parse_mode: "HTML",
      reply_markup: MAIN_KEYBOARD,
    });
  });

  bot.onText(/\/confirm_(\d+)_(\w+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const chatId  = msg.chat.id;
    const userId  = parseInt(match![1], 10);
    const lang    = match![2] as LearningMode;

    if (!getPending(userId)) {
      await bot.sendMessage(chatId, `❌ ID ${userId} uchun kutilayotgan to'lov topilmadi.`);
      return;
    }

    grantAccess(userId, lang);
    removePending(userId);
    clearFlow(userId);

    await bot.sendMessage(
      chatId,
      `✅ <b>Tasdiqlandi!</b>\n👤 ID: <code>${userId}</code>\n🌍 Til: ${langLabel(lang)}\n📅 7 kunlik dostup ochildi.`,
      { parse_mode: "HTML" }
    );

    bot.sendMessage(
      userId,
      `🎉 <b>TO'LOVINGIZ TASDIQLANDI!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${langLabel(lang)} bo'yicha\n` +
      `<b>7 kunlik cheksiz dostupingiz ochildi!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🚀 O'qituvchingiz bilan suhbatni boshlang!\n` +
      `🎤 Ovozli yoki ✍️ matnli xabar yuboring`,
      { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
    ).catch(() => {});
  });

  bot.onText(/\/reject_(\d+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const chatId = msg.chat.id;
    const userId = parseInt(match![1], 10);

    removePending(userId);
    clearFlow(userId);

    await bot.sendMessage(chatId, `❌ Rad etildi. ID: <code>${userId}</code>`, { parse_mode: "HTML" });

    bot.sendMessage(
      userId,
      `❌ <b>To'lovingiz tasdiqlanmadi.</b>\n\n` +
      `Muammo bo'lsa @${ADMIN_USERNAME} bilan bog'laning.`,
      { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
    ).catch(() => {});
  });

  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg)) return;
    const pending = allPending();
    if (pending.length === 0) {
      await bot.sendMessage(msg.chat.id, "✅ Kutilayotgan to'lovlar yo'q.");
      return;
    }
    let text = `⏳ <b>Kutilayotgan to'lovlar (${pending.length}):</b>\n\n`;
    for (const p of pending) {
      const name = p.username ? `@${p.username}` : p.firstName;
      text += `• ${name} — ${langLabel(p.language)}\n`;
      text += `  ✅ /confirm_${p.userId}_${p.language}  ❌ /reject_${p.userId}\n\n`;
    }
    await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
  });

  // ════════════════════════════════════════════════════════════════════
  // CALLBACK QUERY (language selection + IELTS buttons)
  // ════════════════════════════════════════════════════════════════════
  bot.on("callback_query", async (query) => {
    const chatId = query.message!.chat.id;
    const data   = query.data ?? "";
    await bot.answerCallbackQuery(query.id);

    if (data.startsWith("pay_lang:")) {
      const lang = data.split(":")[1] as LearningMode;
      await safeDelete(bot, chatId, query.message!.message_id).catch(() => {});
      await showPaymentInstructions(bot, chatId, lang);
    } else if (data === "ielts:pay") {
      await handleIeltsPayCallback(bot, chatId, query.from.first_name, query.from.username);
    } else if (data === "ielts:info") {
      await bot.sendMessage(chatId,
        `ℹ️ <b>IELTS Mock Exam haqida:</b>\n\n` +
        `🎧 <b>Listening</b> — 4 qism, 40 savol, 40 daqiqa\n` +
        `📖 <b>Reading</b> — 3 matn, 40 savol, 60 daqiqa\n` +
        `✍️ <b>Writing</b> — Task 1+2, AI baholash, 60 daqiqa\n` +
        `🗣 <b>Speaking</b> — Part 1,2,3, AI tahlil, 15 daqiqa\n\n` +
        `🏆 Natija: Har bo'lim + Overall Band Score\n` +
        `💰 Narxi: <b>28 000 so'm</b> (bir martalik)\n\n` +
        `Haqiqiy IELTS imtihoniga maksimal darajada o'xshash!`,
        { parse_mode: "HTML" }
      );
    } else if (data.startsWith("cert:choose:")) {
      const level = data.split(":")[2] as "B2" | "C1";
      await handleCertLevelChosen(bot, chatId, level, query.from.first_name, query.from.username);
    } else if (data.startsWith("cert:pay:")) {
      const level = data.split(":")[2] as "B2" | "C1";
      await handleCertPay(bot, chatId, level, query.from.first_name, query.from.username);
    } else if (data.startsWith("cert:start:")) {
      const parts     = data.split(":");
      const level     = parts[2] as "B2" | "C1";
      const userExamId = parseInt(parts[3]!, 10);
      await startCertExam(bot, chatId, level, userExamId);
    } else if (data === "cert:myresults") {
      await handleMyResults(bot, chatId);
    } else if (data.startsWith("reg:gender:")) {
      const gender = data.split(":")[2]!;
      const userId = query.from.id;
      const step   = getRegStep(userId);
      if (step.step === "asking_gender") {
        setRegStep(userId, { step: "asking_phone", fullName: step.fullName, age: step.age, gender });
        await safeDelete(bot, chatId, regBotMsg.get(userId));
        const m = await bot.sendMessage(chatId,
          `✅ <b>Jins: ${gender}</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 Ro'yxatdan o'tish: <b>4/4</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `4️⃣ <b>Telefon raqamingizni ulashing</b>\n\n` +
          `Quyidagi tugmani bosing 👇`,
          {
            parse_mode: "HTML",
            reply_markup: {
              keyboard: [[{ text: "📞 Telefon raqamimni ulashish", request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );
        regBotMsg.set(userId, m.message_id);
      }
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // CONTACT (for registration phone number)
  // ════════════════════════════════════════════════════════════════════
  bot.on("contact", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const step   = getRegStep(userId);

    if (step.step === "asking_phone") {
      const phone = msg.contact?.phone_number ?? "Noma'lum";
      await upsertProfile(userId, step.fullName, phone, step.age, step.gender);
      clearRegStep(userId);

      await safeDelete(bot, chatId, regBotMsg.get(userId));
      regBotMsg.delete(userId);

      const profile = await getProfile(userId);
      await bot.sendMessage(
        chatId,
        `🎉 <b>Ro'yxatdan muvaffaqiyatli o'tdingiz!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Ism: <b>${profile?.full_name}</b>\n` +
        `📞 Telefon: <code>${phone}</code>\n` +
        `🎂 Yosh: <b>${profile?.age}</b>\n` +
        `👤 Jins: <b>${profile?.gender}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ Endi botning barcha imkoniyatlaridan foydalanishingiz mumkin!\n\n` +
        `👇 Rejim tanlang:`,
        { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
      );
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // PHOTO — payment receipt
  // ════════════════════════════════════════════════════════════════════
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const flow   = getFlow(chatId);

    // Help mode: forward photo to admin
    if (flow.state === "help_mode") {
      const adminId = getAdminChatId();
      if (adminId) {
        const name = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "Foydalanuvchi");
        const photos = msg.photo!;
        const fileId = photos[photos.length - 1].file_id;
        bot.sendPhoto(adminId, fileId, {
          caption: `📸 <b>Yordam so'rovi (rasm)</b>\n👤 ${name} | <code>${chatId}</code>`,
          parse_mode: "HTML",
        }).catch(() => {});
      }
      await bot.sendMessage(chatId,
        `✅ <b>Xabaringiz qabul qilindi!</b>\n\n` +
        `⏳ Operatorimiz tez orada ko'rib chiqadi va javob beradi.\n\n` +
        `🙏 Biz bilan bo'lganingiz uchun <b>Rahmat!</b> Iltimos kuting... 💬`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Route to cert payment if user is in cert payment pending state
    const certPending = getCertPaymentPending(chatId);
    if (certPending) {
      const photos = msg.photo!;
      const photoFileId = photos[photos.length - 1].file_id;
      await handleCertPaymentPhoto(bot, msg, photoFileId);
      return;
    }

    // Route to IELTS payment if user is in IELTS payment pending state
    const ieltsPending = getIeltsPaymentPending(chatId);
    if (ieltsPending) {
      const photos = msg.photo!;
      const photoFileId = photos[photos.length - 1].file_id;
      await handleIeltsPaymentPhoto(bot, msg, photoFileId);
      return;
    }

    if (flow.state !== "waiting_receipt" || !flow.language) return;

    const photos     = msg.photo!;
    const photoFileId = photos[photos.length - 1].file_id;

    const payment: PendingPayment = {
      userId:      chatId,
      firstName:   msg.from?.first_name ?? "Noma'lum",
      username:    msg.from?.username,
      language:    flow.language,
      photoFileId,
      requestedAt: new Date(),
    };
    addPending(payment);

    // Delete payment instruction message
    await safeDelete(bot, chatId, paymentInstrMsg.get(chatId));
    paymentInstrMsg.delete(chatId);

    clearFlow(chatId);

    await bot.sendMessage(
      chatId,
      `✅ <b>Chekingiz qabul qilindi!</b>\n\n` +
      `⏳ Admin tekshirib, tez orada tasdiqlaydi.\n` +
      `Odatda <b>5–15 daqiqa</b> ichida javob beriladi.\n\n` +
      `🙏 Sabr qiling, tez orada ${langLabel(flow.language)} dostupingiz ochiladi!`,
      { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
    );

    // Forward receipt photo to admin with caption
    const adminId = getAdminChatId();
    if (adminId) {
      const name    = payment.username ? `@${payment.username}` : payment.firstName;
      const caption =
        `💳 <b>YANGI TO'LOV SO'ROVI!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Foydalanuvchi: ${name}\n` +
        `🆔 ID: <code>${chatId}</code>\n` +
        `🌍 Til: ${langLabel(flow.language)}\n` +
        `💰 Summa: ${PRICE_UZS}\n` +
        `🕐 Vaqt: ${payment.requestedAt.toLocaleString("uz-UZ")}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ Tasdiqlash: /confirm_${chatId}_${flow.language}\n` +
        `❌ Rad etish: /reject_${chatId}`;

      bot.sendPhoto(adminId, photoFileId, { caption, parse_mode: "HTML" }).catch(() => {});
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // DOCUMENT — payment receipt (PDF) or help mode
  // ════════════════════════════════════════════════════════════════════
  bot.on("document", async (msg) => {
    const chatId = msg.chat.id;
    const flow   = getFlow(chatId);
    const fileId = msg.document?.file_id;
    if (!fileId) return;

    // Help mode: forward document to admin
    if (flow.state === "help_mode") {
      const adminId = getAdminChatId();
      if (adminId) {
        const name = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "Foydalanuvchi");
        bot.sendDocument(adminId, fileId, {
          caption: `📎 <b>Yordam so'rovi (fayl)</b>\n👤 ${name} | <code>${chatId}</code>`,
          parse_mode: "HTML",
        }).catch(() => {});
      }
      await bot.sendMessage(chatId,
        `✅ <b>Xabaringiz qabul qilindi!</b>\n\n` +
        `⏳ Operatorimiz tez orada ko'rib chiqadi va javob beradi.\n\n` +
        `🙏 Biz bilan bo'lganingiz uchun <b>Rahmat!</b> Iltimos kuting... 💬`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Route cert/ielts pending payments
    const certPending = getCertPaymentPending(chatId);
    if (certPending) {
      await handleCertPaymentPhoto(bot, msg, fileId);
      return;
    }
    const ieltsPending = getIeltsPaymentPending(chatId);
    if (ieltsPending) {
      await handleIeltsPaymentPhoto(bot, msg, fileId);
      return;
    }

    if (flow.state !== "waiting_receipt" || !flow.language) return;

    const payment: PendingPayment = {
      userId:      chatId,
      firstName:   msg.from?.first_name ?? "Noma'lum",
      username:    msg.from?.username,
      language:    flow.language,
      photoFileId: fileId,
      requestedAt: new Date(),
    };
    addPending(payment);

    await safeDelete(bot, chatId, paymentInstrMsg.get(chatId));
    paymentInstrMsg.delete(chatId);
    clearFlow(chatId);

    await bot.sendMessage(
      chatId,
      `✅ <b>Chekingiz qabul qilindi!</b>\n\n` +
      `⏳ Admin tekshirib, tez orada tasdiqlaydi.\n` +
      `Odatda <b>5–15 daqiqa</b> ichida javob beriladi.\n\n` +
      `🙏 Sabr qiling, tez orada ${langLabel(flow.language)} dostupingiz ochiladi!`,
      { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
    );

    const adminId = getAdminChatId();
    if (adminId) {
      const name    = payment.username ? `@${payment.username}` : payment.firstName;
      const caption =
        `💳 <b>YANGI TO'LOV SO'ROVI (PDF)!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Foydalanuvchi: ${name}\n` +
        `🆔 ID: <code>${chatId}</code>\n` +
        `🌍 Til: ${langLabel(flow.language)}\n` +
        `💰 Summa: ${PRICE_UZS}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ Tasdiqlash: /confirm_${chatId}_${flow.language}\n` +
        `❌ Rad etish: /reject_${chatId}`;
      bot.sendDocument(adminId, fileId, { caption, parse_mode: "HTML" }).catch(() => {});
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // VIDEO — help mode forwarding
  // ════════════════════════════════════════════════════════════════════
  bot.on("video", async (msg) => {
    const chatId = msg.chat.id;
    const flow   = getFlow(chatId);
    if (flow.state !== "help_mode") return;
    const adminId = getAdminChatId();
    if (adminId && msg.video?.file_id) {
      const name = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "Foydalanuvchi");
      bot.sendVideo(adminId, msg.video.file_id, {
        caption: `🎥 <b>Yordam so'rovi (video)</b>\n👤 ${name} | <code>${chatId}</code>`,
        parse_mode: "HTML",
      }).catch(() => {});
    }
    await bot.sendMessage(chatId,
      `✅ <b>Xabaringiz qabul qilindi!</b>\n\n` +
      `⏳ Operatorimiz tez orada ko'rib chiqadi va javob beradi.\n\n` +
      `🙏 Biz bilan bo'lganingiz uchun <b>Rahmat!</b> Iltimos kuting... 💬`,
      { parse_mode: "HTML" }
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // VOICE
  // ════════════════════════════════════════════════════════════════════
  bot.on("voice", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const fileId = msg.voice?.file_id;
    if (!fileId) return;

    if (isAdmin(msg)) { setAdminChatId(chatId); dbSaveAdminChatId(chatId).catch(() => {}); }
    registerUser(userId, msg.from!.first_name, msg.from?.username);

    // Help mode: forward voice to admin
    const flowV = getFlow(chatId);
    if (flowV.state === "help_mode") {
      const adminId = getAdminChatId();
      if (adminId) {
        const name = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "Foydalanuvchi");
        bot.sendVoice(adminId, fileId, {
          caption: `🎤 <b>Yordam so'rovi (ovoz)</b>\n👤 ${name} | <code>${chatId}</code>`,
          parse_mode: "HTML",
        }).catch(() => {});
      }
      await bot.sendMessage(chatId,
        `✅ <b>Xabaringiz qabul qilindi!</b>\n\n` +
        `⏳ Operatorimiz tez orada ko'rib chiqadi va javob beradi.\n\n` +
        `🙏 Biz bilan bo'lganingiz uchun <b>Rahmat!</b> Iltimos kuting... 💬`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Block voice during registration
    const regStepV = getRegStep(userId);
    if (regStepV.step !== "idle") {
      const hints: Record<string, string> = {
        asking_name: "1️⃣ To'liq ismingizni <b>matn</b> bilan kiriting (ism va familiya):",
        asking_age:  "2️⃣ Yoshingizni <b>raqam</b> bilan kiriting (masalan: <code>22</code>):",
        asking_gender: "3️⃣ Quyidagi tugmalardan <b>jins</b>ingizni tanlang:",
        asking_phone: "4️⃣ Telefon raqamingizni ulashish uchun quyidagi tugmani bosing:",
      };
      const hint = hints[regStepV.step] ?? "Ro'yxatdan o'tishni davom eting.";
      await bot.sendMessage(chatId,
        `⚠️ <b>Ro'yxatdan o'tish hali tugamagan.</b>\n\n${hint}`,
        {
          parse_mode: "HTML",
          reply_markup: regStepV.step === "asking_phone"
            ? { keyboard: [[{ text: "📞 Telefon raqamimni ulashish", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
            : regStepV.step === "asking_gender"
              ? { inline_keyboard: [[{ text: "👨 Erkak", callback_data: "reg:gender:Erkak" }, { text: "👩 Ayol", callback_data: "reg:gender:Ayol" }]] }
              : { remove_keyboard: true },
        }
      );
      return;
    }

    // Block if not registered
    const regOkV = await isRegistered(userId).catch(() => true);
    if (!regOkV) {
      clearRegStep(userId);
      setRegStep(userId, { step: "asking_name" });
      await bot.sendMessage(chatId,
        `📋 <b>Avval ro'yxatdan o'ting.</b>\n\n1️⃣ To'liq ismingizni kiriting (ism va familiya):`,
        { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    // Route to cert exam speaking if in cert exam session
    const certHandled = await routeCertMessage(bot, msg);
    if (certHandled) return;

    // Route to IELTS speaking if in IELTS exam session
    const handled = await routeIeltsMessage(bot, msg);
    if (handled) return;

    const mode = getMode(chatId);
    if (!mode) {
      await bot.sendMessage(chatId, "Iltimos, avval rejimni tanlang 👇", { reply_markup: MAIN_KEYBOARD });
      return;
    }

    if (!canSend(chatId, mode)) {
      await showNoAccessMessage(bot, chatId, mode);
      return;
    }

    let processingMsg: Message | null = null;
    try {
      processingMsg = await bot.sendMessage(chatId, "🎧 Tinglayapman...");
      const fileLink = await bot.getFileLink(fileId);
      const userText = await transcribeAudio(fileLink);

      if (!userText?.trim()) {
        await bot.editMessageText("Ovozni tushunmadim 😅 Qaytadan urinib ko'ring!", {
          chat_id: chatId, message_id: processingMsg.message_id,
        });
        return;
      }

      recordVoiceMessage(chatId);
      if (!isSubscribed(chatId, mode)) consumeFree(chatId, mode);

      await bot.editMessageText(
        `🎙 Siz: "<i>${userText}</i>"\n\n⏳ Tahlil qilyapman...`,
        { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: "HTML" }
      );

      addMessage(chatId, "user", userText);
      const reply = await getTutorReply(getSession(chatId), getSystemPrompt(chatId));
      addMessage(chatId, "assistant", reply);

      const hasCorrection = reply.includes("❌") || reply.includes("✅");
      if (hasCorrection) recordCorrection(chatId);

      if (hasCorrection) {
        await bot.editMessageText(`🎙 Siz: "<i>${userText}</i>"\n\n${reply}`, {
          chat_id: chatId, message_id: processingMsg.message_id, parse_mode: "HTML",
        });
      } else {
        await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
        processingMsg = null;
      }

      const audioBuffer = await textToSpeech(reply, mode);
      await bot.sendVoice(chatId, audioBuffer, { caption: hasCorrection ? undefined : reply });

      if (!isSubscribed(chatId, mode) && getFreeLeft(chatId, mode) === 1) {
        await bot.sendMessage(
          chatId,
          `⚠️ <b>${langLabel(mode)} uchun 1 ta bepul xabar qoldi!</b>\nObuna olish uchun pastdagi tugmani bosing 👇`,
          { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
        );
      }
    } catch (err) {
      console.error("Voice error:", err);
      const errText = "Xatolik yuz berdi 😅 Qaytadan urinib ko'ring!";
      if (processingMsg) {
        await bot.editMessageText(errText, { chat_id: chatId, message_id: processingMsg.message_id })
          .catch(() => bot.sendMessage(chatId, errText));
      } else {
        await bot.sendMessage(chatId, errText);
      }
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // TEXT
  // ════════════════════════════════════════════════════════════════════
  bot.on("text", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const text   = msg.text ?? "";
    if (text.startsWith("/")) return;

    if (isAdmin(msg)) { setAdminChatId(chatId); dbSaveAdminChatId(chatId).catch(() => {}); }
    registerUser(userId, msg.from!.first_name, msg.from?.username);

    // ── Registration flow ─────────────────────────────────────────
    const regStep = getRegStep(userId);
    if (regStep.step !== "idle") {
      // Reject any text that looks like a keyboard button (contains emoji at start)
      const isButtonText = /^[🇷🇺🇬🇧🇹🇷📊💳🔗📈ℹ️📝🎓⏱🏳]/u.test(text.trim());

      if (regStep.step === "asking_name") {
        const fullName = text.trim();
        const isValidName = /^[\p{L}\s'-]+$/u.test(fullName) && fullName.split(/\s+/).length >= 2 && fullName.length >= 4 && !isButtonText;
        if (!isValidName) {
          await safeDelete(bot, chatId, regBotMsg.get(userId));
          const m = await bot.sendMessage(chatId,
            `❗ <b>Iltimos, to'liq ismingizni kiriting.</b>\n\n` +
            `Ism va familiya harflar bilan yozilishi kerak.\n` +
            `Masalan: <b>Alisher Karimov</b>`,
            { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
          );
          regBotMsg.set(userId, m.message_id);
          return;
        }
        setRegStep(userId, { step: "asking_age", fullName });
        await safeDelete(bot, chatId, regBotMsg.get(userId));
        const m = await bot.sendMessage(chatId,
          `✅ <b>Ajoyib, ${fullName}!</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 Ro'yxatdan o'tish: <b>2/4</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `2️⃣ <b>Yoshingizni kiriting</b>\n` +
          `(faqat raqam, masalan: <code>22</code>)`,
          { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
        );
        regBotMsg.set(userId, m.message_id);
        return;
      }

      if (regStep.step === "asking_age") {
        const age = parseInt(text.trim(), 10);
        if (isNaN(age) || age < 10 || age > 80 || isButtonText) {
          await safeDelete(bot, chatId, regBotMsg.get(userId));
          const m = await bot.sendMessage(chatId,
            `❗ <b>Yoshingizni raqam bilan kiriting.</b>\n` +
            `Masalan: <code>20</code>  (10–80 oralig'ida)`,
            { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
          );
          regBotMsg.set(userId, m.message_id);
          return;
        }
        setRegStep(userId, { step: "asking_gender", fullName: regStep.fullName, age });
        await safeDelete(bot, chatId, regBotMsg.get(userId));
        const m2 = await bot.sendMessage(chatId,
          `✅ <b>Yosh: ${age}</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 Ro'yxatdan o'tish: <b>3/4</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `3️⃣ <b>Jinsingizni tanlang:</b>`,
          {
            parse_mode: "HTML",
            reply_markup: {
              remove_keyboard: true,
              inline_keyboard: [[
                { text: "👨 Erkak", callback_data: "reg:gender:Erkak" },
                { text: "👩 Ayol",  callback_data: "reg:gender:Ayol"  },
              ]],
            },
          }
        );
        regBotMsg.set(userId, m2.message_id);
        return;
      }

      if (regStep.step === "asking_gender") {
        await safeDelete(bot, chatId, regBotMsg.get(userId));
        const m = await bot.sendMessage(chatId,
          `3️⃣ Iltimos, <b>quyidagi tugmalardan birini tanlang:</b>`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "👨 Erkak", callback_data: "reg:gender:Erkak" },
                { text: "👩 Ayol",  callback_data: "reg:gender:Ayol"  },
              ]],
            },
          }
        );
        regBotMsg.set(userId, m.message_id);
        return;
      }

      if (regStep.step === "asking_phone") {
        await safeDelete(bot, chatId, regBotMsg.get(userId));
        const m = await bot.sendMessage(chatId,
          `4️⃣ <b>Telefon raqamingizni ulashing:</b>\n\n` +
          `Quyidagi <b>«📞 Telefon raqamimni ulashish»</b> tugmasini bosing:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              keyboard: [[{ text: "📞 Telefon raqamimni ulashish", request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );
        regBotMsg.set(userId, m.message_id);
        return;
      }
      return;
    }

    // ── Check registration before accessing features ──────────────
    const registered = await isRegistered(userId).catch(() => true);
    if (!registered) {
      clearRegStep(userId);
      setRegStep(userId, { step: "asking_name" });
      await bot.sendMessage(chatId,
        `📋 <b>Avval ro'yxatdan o'ting.</b>\n\n` +
        `1️⃣ <b>To'liq ismingizni kiriting</b> (ism va familiya):`,
        { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    // ── Cert exam routing (must be before other checks) ──────────
    const certHandled = await routeCertMessage(bot, msg);
    if (certHandled) return;

    // ── IELTS routing (must be before other button checks) ───────
    const ieltsHandled = await routeIeltsMessage(bot, msg);
    if (ieltsHandled) return;

    // ── Bosh menyu (exit help mode) ───────────────────────────────
    if (text === BTN_BACK) {
      clearFlow(chatId);
      await bot.sendMessage(chatId, `🏠 <b>Bosh menyu</b>`, { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD });
      return;
    }

    // ── Help mode: forward any text to admin ──────────────────────
    const flowTxt = getFlow(chatId);
    if (flowTxt.state === "help_mode") {
      const adminId = getAdminChatId();
      if (adminId) {
        const name = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "Foydalanuvchi");
        bot.sendMessage(adminId,
          `💬 <b>Yordam so'rovi</b>\n👤 ${name} | <code>${chatId}</code>\n\n${text}`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
      await bot.sendMessage(chatId,
        `✅ <b>Xabaringiz qabul qilindi!</b>\n\n` +
        `⏳ Operatorimiz tez orada ko'rib chiqadi va javob beradi.\n\n` +
        `🙏 Biz bilan bo'lganingiz uchun <b>Rahmat!</b> Iltimos kuting... 💬`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Button shortcuts ──────────────────────────────────────────
    if (text === BTN_CERT)  { await handleCertEntry(bot, chatId); return; }
    if (text === BTN_IELTS) { await handleIeltsEntry(bot, chatId); return; }
    if (text === BTN_STATUS)    { await bot.sendMessage(chatId, formatStatus(chatId), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }); return; }
    if (text === BTN_SUBSCRIBE) {
      await bot.sendMessage(chatId, `💳 <b>Haftalik obuna</b>\n\n💰 Narxi: <b>${PRICE_UZS}</b> / til / hafta\n\n👇 Qaysi til?`, { parse_mode: "HTML", reply_markup: langInlineKeyboard() });
      return;
    }
    if (text === BTN_STATS) { await bot.sendMessage(chatId, formatStats(chatId), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }); return; }
    if (text === BTN_HELP)  { await showHelpMessage(bot, chatId); return; }
    if (text === BTN_REFERRAL) {
      try {
        const me   = await bot.getMe();
        const link = `https://t.me/${me.username}?start=ref_${chatId}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('🤖 AI til o\'qituvchisi! Ruscha, Inglizcha, Turkcha. 3 ta bepul xabar sovg\'a!')}`;
        await bot.sendMessage(
          chatId,
          `🔗 <b>Do'stlarni taklif qiling!</b>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `Sizning shaxsiy havolangiz:\n<code>${link}</code>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🎁 <b>Mukofot:</b> ikkalangizga +3 ta bepul xabar (har tilga)\n\n` +
          `👇 Yoki quyidagi tugma orqali ulashing:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "📤 Do'stlarga ulashish", url: shareUrl }]],
            },
          }
        );
      } catch { await bot.sendMessage(chatId, "Xatolik. Qaytadan urinib ko'ring."); }
      return;
    }

    // ── Block text when waiting for receipt ───────────────────────
    if (flowTxt.state === "waiting_receipt") {
      await bot.sendMessage(chatId,
        `📸 <b>Iltimos, chekni rasm ko'rinishida yoki Document (PDF) tarzida yuboring!</b>\n\n` +
        `Matn qabul qilinmaydi — faqat rasm yoki PDF fayl yuboring.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Language selection ────────────────────────────────────────
    if (text === BTN_RUSSIAN || text === BTN_ENGLISH || text === BTN_TURKISH) {
      const mode: LearningMode =
        text === BTN_RUSSIAN ? "russian" :
        text === BTN_ENGLISH ? "english" : "turkish";
      setMode(chatId, mode);
      clearFlow(chatId);
      await bot.sendMessage(chatId, getModeWelcome(mode), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD });
      return;
    }

    // ── Legacy full-text language buttons (backward compat) ───────
    if (text === "🇷🇺 Ruscha o'rganish") { setMode(chatId, "russian"); clearFlow(chatId); await bot.sendMessage(chatId, getModeWelcome("russian"), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }); return; }
    if (text === "🇬🇧 Inglizcha o'rganish") { setMode(chatId, "english"); clearFlow(chatId); await bot.sendMessage(chatId, getModeWelcome("english"), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }); return; }
    if (text === "🇹🇷 Turkcha o'rganish") { setMode(chatId, "turkish"); clearFlow(chatId); await bot.sendMessage(chatId, getModeWelcome("turkish"), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }); return; }

    // ── AI conversation ───────────────────────────────────────────
    const mode = getMode(chatId);
    if (!mode) {
      await bot.sendMessage(chatId, "Iltimos, avval rejimni tanlang 👇", { reply_markup: MAIN_KEYBOARD });
      return;
    }

    if (!canSend(chatId, mode)) {
      await showNoAccessMessage(bot, chatId, mode);
      return;
    }

    try {
      recordTextMessage(chatId);
      if (!isSubscribed(chatId, mode)) consumeFree(chatId, mode);

      addMessage(chatId, "user", text);
      const reply = await getTutorReply(getSession(chatId), getSystemPrompt(chatId));
      addMessage(chatId, "assistant", reply);

      const hasCorrection = reply.includes("❌") || reply.includes("✅");
      if (hasCorrection) recordCorrection(chatId);

      await bot.sendMessage(chatId, reply, { reply_markup: MAIN_KEYBOARD });

      const audioBuffer = await textToSpeech(reply, mode);
      await bot.sendVoice(chatId, audioBuffer);

      if (!isSubscribed(chatId, mode) && getFreeLeft(chatId, mode) === 1) {
        await bot.sendMessage(
          chatId,
          `⚠️ <b>${langLabel(mode)} uchun 1 ta bepul xabar qoldi!</b>\nObuna olish uchun tugmani bosing 👇`,
          { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
        );
      }
    } catch (err) {
      console.error("Text error:", err);
      await bot.sendMessage(chatId, "Xatolik yuz berdi 😅 Qaytadan urinib ko'ring!", { reply_markup: MAIN_KEYBOARD });
    }
  });
}
