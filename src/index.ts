import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { registerHandlers } from "./handlers.js";
import { registerIeltsHandlers } from "./ielts/handlers.js";
import { initSchema } from "./ielts/db.js";
import { seedSampleExam } from "./ielts/seed.js";
import { initProfileSchema, dbLoadAdminChatId } from "./registration.js";
import { initCertSchema } from "./cert/db.js";
import { seedCertExams } from "./cert/seed.js";
import { registerCertHandlers } from "./cert/handlers.js";
import { setAdminChatId } from "./subscription.js";

const PORT    = Number(process.env["PORT"] ?? 5000);
const TOKEN   = process.env["TELEGRAM_BOT_TOKEN"];
const GROQ_KEY = process.env["GROQ_API_KEY"];

if (!TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN environment variable is required");
  process.exit(1);
}

if (!GROQ_KEY) {
  console.error("ERROR: GROQ_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
app.get("/", (_req, res) => res.send("Tutor Bot + IELTS + Rus Sertifikati running!"));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    await initProfileSchema();
    const savedAdminId = await dbLoadAdminChatId();
    if (savedAdminId) {
      setAdminChatId(savedAdminId);
      console.log(`✅ Admin chat ID loaded from DB: ${savedAdminId}`);
    }
    console.log("✅ User profile schema ready");
  } catch (err) {
    console.error("Profile schema error:", err);
  }

  try {
    await initSchema();
    await seedSampleExam();
    console.log("✅ IELTS schema ready");
  } catch (err) {
    console.error("IELTS DB init error:", err);
  }

  try {
    await initCertSchema();
    await seedCertExams();
    console.log("✅ Cert schema ready");
  } catch (err) {
    console.error("Cert DB init error:", err);
  }

  const bot = new TelegramBot(TOKEN, { polling: true });

  bot.on("polling_error", (err) => console.error("Polling error:", err));
  bot.on("error",         (err) => console.error("Bot error:", err));

  registerHandlers(bot);
  await registerIeltsHandlers(bot);
  await registerCertHandlers(bot);

  console.log("🤖 Tutor Bot + IELTS + Rus Sertifikati started and polling");

  const RENDER_URL = process.env["RENDER_EXTERNAL_URL"];
  if (RENDER_URL) {
    setInterval(async () => {
      try {
        const { default: https } = await import("node:https");
        https.get(`${RENDER_URL}/health`, (res) => {
          console.log(`Self-ping: ${res.statusCode}`);
        }).on("error", (err) => {
          console.error("Self-ping error:", err.message);
        });
      } catch (err) {
        console.error("Self-ping failed:", err);
      }
    }, 14 * 60 * 1000);
    console.log(`Self-ping faollashtirildi: ${RENDER_URL}/health`);
  }
});
