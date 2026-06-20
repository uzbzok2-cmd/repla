import TelegramBot, { type ReplyKeyboardMarkup, type Message } from "node-telegram-bot-api";
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

const RUSSIAN_BUTTON = "🇷🇺 Ruscha o'rganish";
const ENGLISH_BUTTON = "🇬🇧 Inglizcha o'rganish";
const TURKISH_BUTTON = "🇹🇷 Turkcha o'rganish";

const MODE_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [[{ text: RUSSIAN_BUTTON }, { text: ENGLISH_BUTTON }], [{ text: TURKISH_BUTTON }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

const WELCOME_MESSAGE = `👋 Salom! Men sizning til o'qituvchingizman!

Qaysi tilni o'rganmoqchisiz?`;

function getModeWelcome(mode: LearningMode): string {
  if (mode === "russian") {
    return `🇷🇺 Ruscha o'rganish rejimi tanlandi!

O'qituvchingiz: Natasha

Nima qilishingiz mumkin:
🎤 Ovozli xabar yuboring — ruscha yoki o'zbekcha
✍️ Matn yozing — ruscha yoki o'zbekcha
🎯 Mavzu bering: "ovqat", "sport", "sayohat"

Xatolaringizni o'zbekcha tushuntiraman va ovozli javob beraman!
Boshlang 🎤`;
  }
  if (mode === "english") {
    return `🇬🇧 Inglizcha o'rganish rejimi tanlandi!

O'qituvchingiz: Emma

Nima qilishingiz mumkin:
🎤 Ovozli xabar yuboring — inglizcha yoki o'zbekcha
✍️ Matn yozing — inglizcha yoki o'zbekcha
🎯 Mavzu bering: "food", "sport", "travel"

Har bir inglizcha javob ostida o'zbekcha tarjima va qiyin so'zlar bo'ladi!
Boshlang 🎤`;
  }
  return `🇹🇷 Turkcha o'rganish rejimi tanlandi!

O'qituvchingiz: Aysha

Nima qilishingiz mumkin:
🎤 Ovozli xabar yuboring — turkcha yoki o'zbekcha
✍️ Matn yozing — turkcha yoki o'zbekcha
🎯 Mavzu bering: "yemek", "spor", "seyahat"

Turk va o'zbek tillari yaqin — tez o'rganasiz!
Har bir javob ostida o'zbekcha tarjima bo'ladi.
Boshlang 🎤`;
}

export function registerHandlers(bot: TelegramBot): void {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    clearSession(chatId);
    resetStats(chatId);
    await bot.sendMessage(chatId, WELCOME_MESSAGE, { reply_markup: MODE_KEYBOARD });
  });

  bot.onText(/\/mode/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "🔄 Rejimni tanlang:", { reply_markup: MODE_KEYBOARD });
  });

  bot.onText(/\/clear/, async (msg) => {
    clearSession(msg.chat.id);
    await bot.sendMessage(msg.chat.id, "🗑 Suhbat tarixi tozalandi! Davom eting 🎤", {
      reply_markup: MODE_KEYBOARD,
    });
  });

  bot.onText(/\/stats/, async (msg) => {
    await bot.sendMessage(msg.chat.id, formatStats(msg.chat.id), { reply_markup: MODE_KEYBOARD });
  });

  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id, WELCOME_MESSAGE, { reply_markup: MODE_KEYBOARD });
  });

  bot.on("voice", async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.voice?.file_id;
    if (!fileId) return;

    const mode = getMode(chatId);
    if (!mode) {
      await bot.sendMessage(chatId, "Iltimos, avval rejimni tanlang 👇", {
        reply_markup: MODE_KEYBOARD,
      });
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
    } catch (err) {
      console.error("Error handling voice message:", err);
      const errorText = "Xatolik yuz berdi 😅 Qaytadan urinib ko'ring!";
      if (processingMsg) {
        await bot
          .editMessageText(errorText, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
          })
          .catch(() => bot.sendMessage(chatId, errorText));
      } else {
        await bot.sendMessage(chatId, errorText);
      }
    }
  });

  bot.on("text", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ?? "";
    if (text.startsWith("/")) return;

    if (text === RUSSIAN_BUTTON || text === ENGLISH_BUTTON || text === TURKISH_BUTTON) {
      const mode: LearningMode =
        text === RUSSIAN_BUTTON ? "russian" :
        text === ENGLISH_BUTTON ? "english" :
        "turkish";
      setMode(chatId, mode);
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

    try {
      recordTextMessage(chatId);
      addMessage(chatId, "user", text);
      const reply = await getTutorReply(getSession(chatId), getSystemPrompt(chatId));
      addMessage(chatId, "assistant", reply);

      const hasCorrection = reply.includes("❌") || reply.includes("✅");
      if (hasCorrection) recordCorrection(chatId);

      await bot.sendMessage(chatId, reply, { reply_markup: MODE_KEYBOARD });

      const audioBuffer = await textToSpeech(reply, mode);
      await bot.sendVoice(chatId, audioBuffer);
    } catch (err) {
      console.error("Error handling text message:", err);
      await bot.sendMessage(chatId, "Xatolik yuz berdi 😅 Qaytadan urinib ko'ring!", {
        reply_markup: MODE_KEYBOARD,
      });
    }
  });
}
