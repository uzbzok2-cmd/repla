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

// ── Button texts ─────────────────────────────────────────────────────
const BTN_RUSSIAN   = "🇷🇺 Ruscha";
const BTN_ENGLISH   = "🇬🇧 Inglizcha";
const BTN_TURKISH   = "🇹🇷 Turkcha";
const BTN_STATUS    = "📊 Obuna holati";
const BTN_SUBSCRIBE = "💳 Obuna olish";
const BTN_REFERRAL  = "🔗 Do'st taklif";
const BTN_STATS     = "📈 Statistika";
const BTN_HELP      = "ℹ️ Yordam";

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
  await bot.sendMessage(
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
    `📸 To'lov qilgandan so'ng <b>chek rasmini (skrinshotini) shu yerga yuboring</b>\n\n` +
    `⚡ Odatda <b>5–15 daqiqa</b> ichida tasdiqlanadi\n` +
    `✅ Admin tasdiqlashi bilan dostupingiz darhol ochiladi!`,
    { parse_mode: "HTML" }
  );
}

async function showHelpMessage(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    `╔══════════════════════╗\n` +
    `   ℹ️ <b>BOT HAQIDA</b>\n` +
    `╚══════════════════════╝\n\n` +
    `🌍 <b>Qo'llab-quvvatlanadigan tillar:</b>\n` +
    `🇷🇺 Ruscha — Natasha\n` +
    `🇬🇧 Inglizcha — Emma\n` +
    `🇹🇷 Turkcha — Aysha\n\n` +
    `🆓 <b>Bepul sinov:</b> har til uchun 3 ta xabar\n` +
    `💳 <b>Obuna:</b> ${PRICE_UZS} / til / hafta\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>Obuna holati</b> — tugma\n` +
    `💳 <b>Obuna olish</b> — tugma\n` +
    `🔗 <b>Do'st taklif</b> — do'st taklif qilish\n` +
    `📈 <b>Statistika</b> — o'rganish statistikasi\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `❓ Savol bo'lsa: @${ADMIN_USERNAME}`,
    { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
  );
}

// ── Handler registration ─────────────────────────────────────────────
export function registerHandlers(bot: TelegramBot): void {

  // Set bot command menu
  bot.setMyCommands([
    { command: "start",     description: "🚀 Botni boshlash" },
    { command: "status",    description: "📊 Obuna holati" },
    { command: "subscribe", description: "💳 Obuna olish" },
    { command: "referral",  description: "🔗 Do'st taklif qilish" },
    { command: "stats",     description: "📈 O'rganish statistikasi" },
    { command: "mode",      description: "🔄 Tilni o'zgartirish" },
    { command: "clear",     description: "🗑 Suhbat tarixini tozalash" },
    { command: "help",      description: "ℹ️ Yordam" },
  ]).catch(() => {});

  // ── /start (+ referral support) ──────────────────────────────────
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const param  = (match?.[1] ?? "").trim();

    if (isAdmin(msg)) setAdminChatId(chatId);
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
      await bot.sendMessage(
        chatId,
        `👋 <b>Xush kelibsiz!</b>\n\n` +
        `🤖 Men AI til o'qituvchisi va Rus tili sertifikat bo'timan!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📋 Avval ro'yxatdan o'tishingiz kerak.\n` +
        `Bu faqat bir marta.\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `1️⃣ <b>To'liq ismingizni kiriting</b>\n` +
        `(Ism va familiya, masalan: Alisher Karimov)`,
        { parse_mode: "HTML" }
      );
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
    await bot.sendMessage(msg.chat.id, formatStats(msg.chat.id), { reply_markup: MAIN_KEYBOARD });
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
        await bot.sendMessage(chatId,
          `✅ <b>Jins: ${gender}</b>\n\n4️⃣ <b>Telefon raqamingizni ulashing:</b>`,
          {
            parse_mode: "HTML",
            reply_markup: {
              keyboard: [[{ text: "📞 Telefon raqamimni ulashish", request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );
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

      const profile = await getProfile(userId);
      await bot.sendMessage(
        chatId,
        `✅ <b>Ro'yxatdan o'tdingiz!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Ism: <b>${profile?.full_name}</b>\n` +
        `📞 Telefon: <code>${phone}</code>\n` +
        `🎂 Yosh: <b>${profile?.age}</b>\n` +
        `👤 Jins: <b>${profile?.gender}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🎉 Xush kelibsiz! Endi botning barcha imkoniyatlaridan foydalanishingiz mumkin.\n\n` +
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

    const flow   = getFlow(chatId);
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
  // VOICE
  // ════════════════════════════════════════════════════════════════════
  bot.on("voice", async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.voice?.file_id;
    if (!fileId) return;

    if (isAdmin(msg)) setAdminChatId(chatId);
    registerUser(msg.from!.id, msg.from!.first_name, msg.from?.username);

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

    if (isAdmin(msg)) setAdminChatId(chatId);
    registerUser(userId, msg.from!.first_name, msg.from?.username);

    // ── Registration flow ─────────────────────────────────────────
    const regStep = getRegStep(userId);
    if (regStep.step !== "idle") {
      if (regStep.step === "asking_name") {
        const fullName = text.trim();
        if (fullName.split(" ").length < 2 || fullName.length < 4) {
          await bot.sendMessage(chatId, "❗ Ism va familiyangizni to'liq kiriting.\nMasalan: <b>Alisher Karimov</b>", { parse_mode: "HTML" });
          return;
        }
        setRegStep(userId, { step: "asking_age", fullName });
        await bot.sendMessage(chatId,
          `✅ <b>Ism qabul qilindi: ${fullName}</b>\n\n2️⃣ <b>Yoshingizni kiriting</b> (raqam bilan, masalan: 22):`,
          { parse_mode: "HTML" }
        );
        return;
      }
      if (regStep.step === "asking_age") {
        const age = parseInt(text.trim(), 10);
        if (isNaN(age) || age < 10 || age > 80) {
          await bot.sendMessage(chatId, "❗ Yoshingizni to'g'ri kiriting (10–80 oralig'ida).");
          return;
        }
        setRegStep(userId, { step: "asking_gender", fullName: regStep.fullName, age });
        await bot.sendMessage(chatId,
          `✅ <b>Yosh: ${age}</b>\n\n3️⃣ <b>Jinsingizni tanlang:</b>`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "👨 Erkak", callback_data: "reg:gender:Erkak" },
                  { text: "👩 Ayol",  callback_data: "reg:gender:Ayol"  },
                ],
              ],
            },
          }
        );
        return;
      }
      if (regStep.step === "asking_phone") {
        await bot.sendMessage(chatId,
          "📞 Telefon raqamingizni ulashish uchun quyidagi tugmani bosing:",
          {
            reply_markup: {
              keyboard: [[{ text: "📞 Telefon raqamimni ulashish", request_contact: true }]],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          }
        );
        return;
      }
      return;
    }

    // ── Check registration before accessing features ──────────────
    const registered = await isRegistered(userId).catch(() => true);
    if (!registered) {
      setRegStep(userId, { step: "asking_name" });
      await bot.sendMessage(chatId,
        `📋 <b>Avval ro'yxatdan o'ting.</b>\n\n1️⃣ To'liq ismingizni kiriting (ism va familiya):`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Cert exam routing (must be before other checks) ──────────
    const certHandled = await routeCertMessage(bot, msg);
    if (certHandled) return;

    // ── IELTS routing (must be before other button checks) ───────
    const ieltsHandled = await routeIeltsMessage(bot, msg);
    if (ieltsHandled) return;

    // ── Button shortcuts ──────────────────────────────────────────
    if (text === BTN_CERT)  { await handleCertEntry(bot, chatId); return; }
    if (text === BTN_IELTS) { await handleIeltsEntry(bot, chatId); return; }
    if (text === BTN_STATUS)    { await bot.sendMessage(chatId, formatStatus(chatId), { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }); return; }
    if (text === BTN_SUBSCRIBE) { await bot.sendMessage(chatId, `💳 <b>Haftalik obuna</b>\n\n💰 Narxi: <b>${PRICE_UZS}</b> / til / hafta\n\n👇 Qaysi til?`, { parse_mode: "HTML", reply_markup: langInlineKeyboard() }); return; }
    if (text === BTN_STATS)     { await bot.sendMessage(chatId, formatStats(chatId), { reply_markup: MAIN_KEYBOARD }); return; }
    if (text === BTN_HELP)      { await showHelpMessage(bot, chatId); return; }
    if (text === BTN_REFERRAL)  {
      try {
        const me   = await bot.getMe();
        const link = `https://t.me/${me.username}?start=ref_${chatId}`;
        await bot.sendMessage(
          chatId,
          `🔗 <b>Shaxsiy taklif havolangiz:</b>\n\n<code>${link}</code>\n\n🎁 Do'st qo'shilsa: ikkalangizga +3 ta bepul xabar (har tilga)`,
          { parse_mode: "HTML", reply_markup: MAIN_KEYBOARD }
        );
      } catch { await bot.sendMessage(chatId, "Xatolik. Qaytadan urinib ko'ring."); }
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
