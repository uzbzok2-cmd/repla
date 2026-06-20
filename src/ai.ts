import Groq from "groq-sdk";
import { createReadStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";

const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });

export async function transcribeAudio(fileUrl: string): Promise<string> {
  const tmpInput = join(tmpdir(), `voice_${Date.now()}.ogg`);
  try {
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    await writeFile(tmpInput, Buffer.from(response.data));

    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(tmpInput),
      model: "whisper-large-v3",
      response_format: "text",
    });

    return typeof transcription === "string"
      ? transcription
      : (transcription as { text: string }).text ?? "";
  } finally {
    await unlink(tmpInput).catch(() => {});
  }
}

export async function getTutorReply(
  history: { role: "user" | "assistant"; content: string }[],
  systemPrompt: string
): Promise<string> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map(
      (m) => ({ role: m.role, content: m.content } as Groq.Chat.ChatCompletionMessageParam)
    ),
  ];

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    max_tokens: 300,
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content ?? "Xatolik yuz berdi. Qaytadan urinib ko'ring!";
}

export async function textToSpeech(
  text: string,
  mode: "russian" | "english" = "russian"
): Promise<Buffer> {
  const lang = mode === "english" ? "en" : "ru";
  const targetText = mode === "english" ? extractEnglishPart(text) : extractRussianPart(text);
  const chunks = splitIntoChunks(targetText, 180);
  const audioParts: Buffer[] = [];

  for (const chunk of chunks) {
    const encoded = encodeURIComponent(chunk);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&client=gtx&ttsspeed=0.9`;

    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://translate.google.com/",
      },
      timeout: 10000,
    });
    audioParts.push(Buffer.from(response.data));
  }

  return Buffer.concat(audioParts);
}

function extractEnglishPart(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const hasRussian = /[\u0400-\u04FF]/.test(line);
    if (!hasRussian && line.trim().length > 3) {
      const cleaned = line.replace(/[❌✅→\-•]/g, "").replace(/\s+/g, " ").trim();
      if (cleaned.length > 3) result.push(cleaned);
    }
  }
  return result.length > 0
    ? result.join(". ")
    : text.replace(/[❌✅→]/g, "").trim();
}

function extractRussianPart(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    if (/[\u0400-\u04FF]/.test(line)) {
      const cleaned = line.replace(/[❌✅→]/g, "").replace(/\s+/g, " ").trim();
      if (cleaned.length > 0) result.push(cleaned);
    }
  }
  return result.length > 0
    ? result.join(". ")
    : text.replace(/[❌✅→]/g, "").trim();
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > maxLength) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLength)];
}
