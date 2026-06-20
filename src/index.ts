import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { registerHandlers } from "./handlers.js";

const PORT = Number(process.env["PORT"] ?? 5000);
const TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
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
app.get("/", (_req, res) => res.send("Tutor Bot is running!"));
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  const bot = new TelegramBot(TOKEN, { polling: true });

  bot.on("polling_error", (err) => console.error("Polling error:", err));
  bot.on("error", (err) => console.error("Bot error:", err));

  registerHandlers(bot);
  console.log("🤖 Tutor Bot started and polling for messages");

  // Render bepul tier uyquya tushmasligi uchun o'z-o'zini har 14 daqiqada ping
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
