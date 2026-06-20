import TelegramBot, {
  type ReplyKeyboardMarkup,
  type Message,
  type InlineKeyboardMarkup,
} from "node-telegram-bot-api";
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
  setAdminChatId,
  getAdminChatId,
  resetFree,
  LANGUAGES,
  CARD_NUMBER,
  PRICE_UZS,
  ADMIN_USERNAME,
  type PendingPayment,
} from "./subscription.js";

// ── Keyboards ────────────────────────────────────────────────────────
const RUSSIAN_BUTTON = "🇷🇺 Ruscha o'rganish";
const ENGLISH_BUTTON = "🇬🇧 Inglizcha o'rganish";
const TURKISH_BUTTON = "🇹🇷 Turkcha o'rganish";

const MODE_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: RUSSIAN_BUTTON }, { text: ENGLISH_BUTTON }],
    [{ text: TURKISH_BUTTON }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

function langInlineKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      LANGUAGES.map((l) => ({ text: `${l.flag} ${l.label}`, callback_data: `pay_lang:${l.key}` })),
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
  if (mode === "russian") {
    return `🇷🇺 Ruscha o'rganish rejimi tanlandi!\n\nO'qituvchingiz: Natasha\n\nNima qilishingiz mumkin:\n🎤 Ovozli xabar yuboring — ruscha yoki o'zbekcha\n✍️ Matn yozing — ruscha yoki o'zbekcha\n🎯 Mavzu bering: "ovqat", "sport", "sayohat"\n\nBoshlang 🎤`;
  }
  if (mode === "english") {
    return `🇬🇧 Inglizcha o'rganish rejimi tanlandi!\n\nO'qituvchingiz: Emma\n\nNima qilishingiz mumkin:\n🎤 Ovozli xabar yuboring — inglizcha yoki o'zbekcha\n✍️ Matn yozing — inglizcha yoki o'zbekcha\n🎯 Mavzu bering: "food", "sport", "travel"\n\nBoshlang 🎤`;
  }
  return `🇹🇷 Turkcha o'rganish rejimi tanlandi!\n\nO'qituvchingiz: Aysha\n\nNima qilishingiz mumkin:\n🎤 Ovozli xabar yuboring — turkcha yoki o'zbekcha\n✍️ Matn yozing — turkcha yoki o'zbekcha\n🎯 Mavzu bering: "yemek", "spor", "seyahat"\n\nBoshlang 🎤`;
}

async function promptPayment(bot: TelegramBot, chatId: number, lang: LearningMode): Promise<void> {
  await bot.sendMessage(
    chatId,
    `❌ ${langLabel(lang)} uchun bepul xabarlaringiz tugadi!\n\n` +
      `📚 Davom etish uchun haftalik obuna kerak:\n` +
      `💰 Narxi: ${PRICE_UZS} / til / hafta\n\n` +
      `Qaysi til uchun obuna olmoqchisiz?`,
    { reply_markup: langInlineKeyboard() }
  );
}

async function sendPaymentInstructions(
  bot: TelegramBot,
  chatId: number,
  lang: LearningMode
): Promise<void> {
  setFlow(chatId, { state: "waiting_receipt", language: lang });
  await bot.sendMessage(
    chatId,
    `💳 <b>${langLabel(lang)} — haftalik obuna</b>\n\n` +
      `Quyidagi karta raqamiga <b>${PRICE_UZS}</b> o'tkazing:\n\n` +
      `<code>${CARD_NUMBER}</code>\n\n` +
      `✅ To'lov qilgandan so'ng <b>to'lov chekini (skrinshotini) shu yerga yuboring</b>.\n\n` +
      `⏳ Admin tekshirib, 7 kunlik dostupingizni ochadi!`,
    { parse_mode: "HTML" }
  );
}

// ── Handler registration ─────────────────────────────────────────────
export function registerHandlers(bot: TelegramBot): void {
  // ── /start (+ referral support) ──────────────────────────────────
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const param = (match?.[1] ?? "").trim();

    if (isAdmin(msg)) setAdminChatId(chatId);

    clearSession(chatId);
    resetStats(chatId);
    resetFree(chatId);
    clearFlow(chatId);

    if (param.startsWith("ref_")) {
      const referrerId = parseInt(param.slice(4), 10);
      if (!isNaN(referrerId) && referrerId !== userId) {
        const isNew = registerReferral(userId, referrerId);
        if (isNew) {
          const bonusGiven = tryGiveBonus(referrerId, userId);
          if (bonusGiven) {
            bot
              .sendMessage(
                referrerId,
                `🎉 Do'stingiz siz orqali qo'shildi!\n` +
                  `Mukofot: har bir til uchun +3 ta bepul xabar qo'shildi! 🎁`
              )
              .catch(() => {});
          }
        }
      }
    }

    await bot.sendMessage(
      chatId,
      `👋 Salom! Men sizning til o'qituvchingizman!\n\n` +
        `Har bir til uchun <b>${3} ta bepul xabar</b> beriladi.\n` +
        `Undan keyin haftalik obuna (${PRICE_UZS}/til) kerak bo'ladi.\n\n` +
        `Qaysi tilni o'rganmoqchisiz?`,
      { reply_markup: MODE_KEYBOARD, parse_mode: "HTML" }
    );
  });

  // ── /mode ────────────────────────────────────────────────────────
  bot.onText(/\/mode/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "🔄 Rejimni tanlang:", { reply_markup: MODE_KEYBOARD });
  });

  // ── /clear ───────────────────────────────────────────────────────
  bot.onText(/\/clear/, async (msg) => {
    clearSession(msg.chat.id);
    await bot.sendMessage(msg.chat.id, "🗑 Suhbat tarixi tozalandi! Davom eting 🎤", {
      reply_markup: MODE_KEYBOARD,
    });
  });

  // ── /stats ───────────────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    await bot.sendMessage(msg.chat.id, formatStats(msg.chat.id), { reply_markup: MODE_KEYBOARD });
  });

  // ── /status — subscription status ────────────────────────────────
  bot.onText(/\/status/, async (msg) => {
    await bot.sendMessage(msg.chat.id, formatStatus(msg.chat.id), { reply_markup: MODE_KEYBOARD });
  });

  // ── /subscribe — start payment flow ──────────────────────────────
  bot.onText(/\/subscribe/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      `💳 Qaysi til uchun haftalik obuna olmoqchisiz?\n\n💰 Narxi: ${PRICE_UZS} / til / hafta`,
      { reply_markup: langInlineKeyboard() }
    );
  });

  // ── /referral — get invite link ───────────────────────────────────
  bot.onText(/\/referral/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const me = await bot.getMe();
      const link = `https://t.me/${me.username}?start=ref_${chatId}`;
      await bot.sendMessage(
        chatId,
        `🔗 Sizning taklif havolangiz:\n\n${link}\n\n` +
          `Do'stingiz shu havola orqali kirsa:\n` +
          `✅ Do'stingiz: har tilga 3 ta bepul xabar\n` +
          `🎁 Siz: har tilga +3 ta bepul xabar\n\n` +
          `Qancha ko'p taklif, shuncha ko'p bepul xabar!`,
        { reply_markup: MODE_KEYBOARD }
      );
    } catch {
      await bot.sendMessage(chatId, "Havola olishda xatolik. Qaytadan urinib ko'ring.");
    }
  });

  // ── /help ────────────────────────────────────────────────────────
  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      `📋 <b>Bot buyruqlari:</b>\n\n` +
        `/start — botni boshlash\n` +
        `/mode — tilni o'zgartirish\n` +
        `/status — obuna holati\n` +
        `/subscribe — obuna olish\n` +
        `/referral — do'st taklif qilish\n` +
        `/stats — statistika\n` +
        `/clear — suhbat tarixini tozalash\n\n` +
        `💰 Narx: ${PRICE_UZS} / til / hafta\n` +
        `🆓 Bepul: har til uchun 3 ta xabar`,
      { reply_markup: MODE_KEYBOARD, parse_mode: "HTML" }
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // ADMIN PANEL
  // ════════════════════════════════════════════════════════════════════

  // ── /admin ───────────────────────────────────────────────────────
  bot.onText(/\/admin/, async (msg) => {
    if (!isAdmin(msg)) return;
    const chatId = msg.chat.id;
    setAdminChatId(chatId);

    const pending = allPending();
    let text = `🔐 <b>Admin Panel</b> — @${ADMIN_USERNAME}\n\n`;

    if (pending.length === 0) {
      text += "✅ Kutilayotgan to'lovlar yo'q.";
    } else {
      text += `⏳ <b>Kutilayotgan to'lovlar: ${pending.length} ta</b>\n\n`;
      for (const p of pending) {
        const name = p.username ? `@${p.username}` : p.firstName;
        text += `👤 ${name} (ID: <code>${p.userId}</code>)\n`;
        text += `🌍 Til: ${langLabel(p.language)}\n`;
        text += `🕐 ${p.requestedAt.toLocaleString("uz-UZ")}\n`;
        text += `✅ Tasdiqlash: /confirm_${p.userId}_${p.language}\n`;
        text += `❌ Rad etish: /reject_${p.userId}\n\n`;
      }
    }

    await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  });

  // ── /confirm_userId_language ──────────────────────────────────────
  bot.onText(/\/confirm_(\d+)_(\w+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const chatId = msg.chat.id;
    const userId = parseInt(match![1], 10);
    const lang = match![2] as LearningMode;

    const payment = getPending(userId);
    if (!payment) {
      await bot.sendMessage(chatId, `❌ ID ${userId} uchun kutilayotgan to'lov topilmadi.`);
      return;
    }

    grantAccess(userId, lang);
    removePending(userId);
    clearFlow(userId);

    await bot.sendMessage(
      chatId,
      `✅ Tasdiqlandi!\n👤 ID: ${userId}\n🌍 Til: ${langLabel(lang)}\n📅 7 kunlik dostup ochildi.`
    );

    bot
      .sendMessage(
        userId,
        `🎉 <b>To'lovingiz tasdiqlandi!</b>\n\n` +
          `${langLabel(lang)} bo'yicha <b>7 kunlik dostupingiz ochildi!</b>\n\n` +
          `O'qituvchingiz bilan suhbatni boshlang 🎤`,
        { reply_markup: MODE_KEYBOARD, parse_mode: "HTML" }
      )
      .catch(() => {});
  });

  // ── /reject_userId ────────────────────────────────────────────────
  bot.onText(/\/reject_(\d+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const chatId = msg.chat.id;
    const userId = parseInt(match![1], 10);

    removePending(userId);
    clearFlow(userId);

    await bot.sendMessage(chatId, `❌ Rad etildi. ID: ${userId}`);

    bot
      .sendMessage(
        userId,
        `❌ To'lovingiz tasdiqlanmadi.\n\nMuammo bo'lsa @${ADMIN_USERNAME} bilan bog'laning.`,
        { reply_markup: MODE_KEYBOARD }
      )
      .catch(() => {});
  });

  // ── /users — admin: see all pending ──────────────────────────────
  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg)) return;
    const pending = allPending();
    if (pending.length === 0) {
      await bot.sendMessage(msg.chat.id, "Kutilayotgan to'lovlar yo'q.");
      return;
    }
    let text = `📋 Kutilayotgan to'lovlar (${pending.length}):\n\n`;
    for (const p of pending) {
      text += `• ${p.username ? "@" + p.username : p.firstName} — ${langLabel(p.language)}\n  /confirm_${p.userId}_${p.language} | /reject_${p.userId}\n`;
    }
    await bot.sendMessage(msg.chat.id, text);
  });

  // ════════════════════════════════════════════════════════════════════
  // CALLBACK QUERY (inline keyboard buttons)
  // ════════════════════════════════════════════════════════════════════
  bot.on("callback_query", async (query) => {
    const chatId = query.message!.chat.id;
    const data = query.data ?? "";
    await bot.answerCallbackQuery(query.id);

    if (data.startsWith("pay_lang:")) {
      const lang = data.split(":")[1] as LearningMode;
      await sendPaymentInstructions(bot, chatId, lang);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // PHOTO (payment receipt)
  // ════════════════════════════════════════════════════════════════════
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const flow = getFlow(chatId);
    if (flow.state !== "waiting_receipt" || !flow.language) return;

    const photos = msg.photo!;
    const photoFileId = photos[photos.length - 1].file_id;

    const payment: PendingPayment = {
      userId: chatId,
      firstName: msg.from?.first_name ?? "Noma'lum",
      username: msg.from?.username,
      language: flow.language,
      photoFileId,
      requestedAt: new Date(),
    };
    addPending(payment);
    clearFlow(chatId);

    await bot.sendMessage(
      chatId,
      `✅ To'lov chekingiz qabul qilindi!\n\n⏳ Admin tekshirib, tez orada tasdiqlaydi.\nKutib turing...`
    );

    const adminId = getAdminChatId();
    if (adminId) {
      const name = payment.username ? `@${payment.username}` : payment.firstName;
      const caption =
        `💳 <b>Yangi to'lov so'rovi!</b>\n\n` +
        `👤 ${name}\n` +
        `🆔 ID: <code>${chatId}</code>\n` +
        `🌍 Til: ${langLabel(flow.language)}\n` +
        `💰 Summa: ${PRICE_UZS}\n\n` +
        `✅ /confirm_${chatId}_${flow.language}\n` +
        `❌ /reject_${chatId}`;
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

    const mode = getMode(chatId);
    if (!mode) {
      await bot.sendMessage(chatId, "Iltimos, avval rejimni tanlang 👇", {
        reply_markup: MODE_KEYBOARD,
      });
      return;
    }

    if (!canSend(chatId, mode)) {
      await promptPayment(bot, chatId, mode);
      return;
    }

    let processingMsg: Message | null = null;
    try {
      processingMsg = await bot.sendMessage(chatId, "🎧 Tinglayapman...");

      const fileLink = await bot.getFileLink(fileId);
      const userText = await transcribeAudio(fileLink);

      if (!userText || userText.trim().length === 0) {
        await bot.editMessageText("Ovozni tushunmadim 😅 Qaytadan urinib ko'ring!", {
          chat_id: chatId,
          message_id: processingMsg.message_id,
        });
        return;
      }

      recordVoiceMessage(chatId);
      if (!isSubscribed(chatId, mode)) consumeFree(chatId, mode);

      await bot.editMessageText(
        `🎙 Siz dedingiz: "${userText}"\n\nTahlil qilyapman...`,
        { chat_id: chatId, message_id: processingMsg.message_id }
      );

      addMessage(chatId, "user", userText);
      const reply = await getTutorReply(getSession(chatId), getSystemPrompt(chatId));
      addMessage(chatId, "assistant", reply);

      const hasCorrection = reply.includes("❌") || reply.includes("✅");
      if (hasCorrection) recordCorrection(chatId);

      if (hasCorrection) {
        await bot.editMessageText(`🎙 Siz dedingiz: "${userText}"\n\n${reply}`, {
          chat_id: chatId,
          message_id: processingMsg.message_id,
        });
      } else {
        await bot.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
        processingMsg = null;
      }

      const audioBuffer = await textToSpeech(reply, mode);
      await bot.sendVoice(chatId, audioBuffer, {
        caption: hasCorrection ? undefined : reply,
      });

      if (!isSubscribed(chatId, mode)) {
        const left = getFreeLeft(chatId, mode);
        if (left === 1) {
          await bot.sendMessage(
            chatId,
            `⚠️ ${langLabel(mode)} uchun 1 ta bepul xabar qoldi!\n/subscribe orqali obuna oling.`
          );
        }
      }
    } catch (err) {
      console.error("Voice error:", err);
      const errorText = "Xatolik yuz berdi 😅 Qaytadan urinib ko'ring!";
      if (processingMsg) {
        await bot
          .editMessageText(errorText, { chat_id: chatId, message_id: processingMsg.message_id })
          .catch(() => bot.sendMessage(chatId, errorText));
      } else {
        await bot.sendMessage(chatId, errorText);
      }
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // TEXT
  // ════════════════════════════════════════════════════════════════════
  bot.on("text", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ?? "";
    if (text.startsWith("/")) return;

    if (isAdmin(msg)) setAdminChatId(chatId);

    if (text === RUSSIAN_BUTTON || text === ENGLISH_BUTTON || text === TURKISH_BUTTON) {
      const mode: LearningMode =
        text === RUSSIAN_BUTTON ? "russian" :
        text === ENGLISH_BUTTON ? "english" : "turkish";
      setMode(chatId, mode);
      clearFlow(chatId);
      await bot.sendMessage(chatId, getModeWelcome(mode), { reply_markup: MODE_KEYBOARD });
      return;
    }

    const mode = getMode(chatId);
    if (!mode) {
      await bot.sendMessage(chatId, "Iltimos, avval rejimni tanlang 👇", {
        reply_markup: MODE_KEYBOARD,
      });
      return;
    }

    if (!canSend(chatId, mode)) {
      await promptPayment(bot, chatId, mode);
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

      await bot.sendMessage(chatId, reply, { reply_markup: MODE_KEYBOARD });

      const audioBuffer = await textToSpeech(reply, mode);
      await bot.sendVoice(chatId, audioBuffer);

      if (!isSubscribed(chatId, mode)) {
        const left = getFreeLeft(chatId, mode);
        if (left === 1) {
          await bot.sendMessage(
            chatId,
            `⚠️ ${langLabel(mode)} uchun 1 ta bepul xabar qoldi!\n/subscribe orqali obuna oling.`
          );
        }
      }
    } catch (err) {
      console.error("Text error:", err);
      await bot.sendMessage(chatId, "Xatolik yuz berdi 😅 Qaytadan urinib ko'ring!", {
        reply_markup: MODE_KEYBOARD,
      });
    }
  });
}
