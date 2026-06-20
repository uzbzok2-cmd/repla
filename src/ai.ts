import Groq from "groq-sdk";
import { createReadStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";

const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });
const ELEVENLABS_API_KEY = process.env["ELEVENLABS_API_KEY"];
const GOOGLE_TTS_API_KEY = process.env["GOOGLE_TTS_API_KEY"];

const ELEVENLABS_VOICES: Record<string, string> = {
  russian: "XrExE9yKIg1WjnnlVkGX",
  english: "21m00Tcm4TlvDq8ikWAM",
  turkish: "XrExE9yKIg1WjnnlVkGX",
};

const GOOGLE_VOICES: Record<string, { languageCode: string; name: string }> = {
  russian: { languageCode: "ru-RU", name: "ru-RU-Neural2-A" },
  english: { languageCode: "en-US", name: "en-US-Neural2-F" },
  turkish: { languageCode: "tr-TR", name: "tr-TR-Standard-B" },
};

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
  mode: "russian" | "english" | "turkish" = "russian"
): Promise<Buffer> {
  const targetText =
    mode === "english" ? extractEnglishPart(text) :
    mode === "turkish" ? extractTurkishPart(text) :
    extractRussianPart(text);

  // 1-qavatli: ElevenLabs (eng tabiiy)
  if (ELEVENLABS_API_KEY) {
    try {
      return await elevenLabsTTS(targetText, mode);
    } catch (err) {
      console.error("ElevenLabs failed, trying Google Cloud TTS:", err);
    }
  }

  // 2-qavatli: Google Cloud TTS (neural ovoz)
  if (GOOGLE_TTS_API_KEY) {
    try {
      return await googleCloudTTS(targetText, mode);
    } catch (err) {
      console.error("Google Cloud TTS failed, falling back to Google Translate TTS:", err);
    }
  }

  // 3-qavatli: Google Translate TTS (har doim ishlaydi)
  return await googleTranslateTTS(targetText, mode);
}

async function elevenLabsTTS(
  text: string,
  mode: "russian" | "english" | "turkish"
): Promise<Buffer> {
  const voiceId = ELEVENLABS_VOICES[mode];
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text: text.slice(0, 500),
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
    },
    {
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      responseType: "arraybuffer",
      timeout: 20000,
    }
  );
  return Buffer.from(response.data);
}

async function googleCloudTTS(
  text: string,
  mode: "russian" | "english" | "turkish"
): Promise<Buffer> {
  const voice = GOOGLE_VOICES[mode];
  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
    {
      input: { text: text.slice(0, 500) },
      voice,
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.95, pitch: 0 },
    },
    { timeout: 15000 }
  );
  return Buffer.from(response.data.audioContent, "base64");
}

async function googleTranslateTTS(
  text: string,
  mode: "russian" | "english" | "turkish"
): Promise<Buffer> {
  const lang = mode === "english" ? "en" : mode === "turkish" ? "tr" : "ru";
  const chunks = splitIntoChunks(text, 180);
  const audioParts: Buffer[] = [];
  for (const chunk of chunks) {
    const encoded = encodeURIComponent(chunk);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&client=gtx&ttsspeed=0.9`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
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
  return result.length > 0 ? result.join(". ") : text.replace(/[❌✅→]/g, "").trim();
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
  return result.length > 0 ? result.join(". ") : text.replace(/[❌✅→]/g, "").trim();
}

function extractTurkishPart(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let beforeSeparator = true;
  for (const line of lines) {
    if (line.trim() === "---") { beforeSeparator = false; continue; }
    if (beforeSeparator && line.trim().length > 3) {
      const hasRussian = /[\u0400-\u04FF]/.test(line);
      const isUzbek = /[o'g']/i.test(line) && /\b(bu|va|ham|uchun|bilan|men|siz)\b/i.test(line);
      if (!hasRussian && !isUzbek) {
        const cleaned = line.replace(/[❌✅→\-•]/g, "").replace(/\s+/g, " ").trim();
        if (cleaned.length > 3) result.push(cleaned);
      }
    }
  }
  return result.length > 0 ? result.join(". ") : text.replace(/[❌✅→]/g, "").trim();
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
