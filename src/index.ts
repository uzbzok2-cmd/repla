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
import { setBotForExam } from "./webapp.js";
import { setupExamRoutes } from "./examapi.js";

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
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

app.get("/", (_req, res) => res.send("Tutor Bot + IELTS + Rus Sertifikati running!"));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

setupExamRoutes(app);

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

  const bot = new TelegramBot(TOKEN, { polling: false });
  setBotForExam(bot);

  // Clean stop on shutdown
  const shutdown = async () => {
    console.log("Stopping bot polling...");
    try { await bot.stopPolling(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT",  shutdown);

  bot.on("polling_error", async (err: Error & { code?: string }) => {
    if (err.code === "ETELEGRAM" && err.message.includes("409")) {
      console.warn("409 conflict — waiting 5s and retrying...");
      try { await bot.stopPolling(); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 5000));
      try { await bot.startPolling(); console.log("✅ Polling qayta boshlandi"); } catch { /* ignore */ }
    } else {
      console.error("Polling error:", err);
    }
  });
  bot.on("error", (err) => console.error("Bot error:", err));

  // Wait for any old process to release Telegram lock
  await new Promise(r => setTimeout(r, 3000));
  try {
    await bot.deleteWebhook({ drop_pending_updates: true });
    console.log("✅ Webhook tozalandi");
  } catch (err) {
    console.warn("Webhook ogohlantirish:", err);
  }
  await new Promise(r => setTimeout(r, 1000));
  await bot.startPolling();
  console.log("✅ Polling boshlandi");

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
