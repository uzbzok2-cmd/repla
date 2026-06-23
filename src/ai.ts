import Groq from "groq-sdk";
import { createReadStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });
const ELEVENLABS_API_KEY = process.env["ELEVENLABS_API_KEY"];
const HF_TOKEN = process.env["HF_TOKEN"]; // ixtiyoriy — bepul ro'yxatdan o'tish bilan limit oshadi

const ELEVENLABS_VOICES: Record<string, string> = {
  russian: "XrExE9yKIg1WjnnlVkGX",
  english: "21m00Tcm4TlvDq8ikWAM",
  turkish: "XrExE9yKIg1WjnnlVkGX",
};

// Edge TTS (Microsoft, bepul, yuqori sifat)
const EDGE_VOICES: Record<string, string> = {
  russian: "ru-RU-SvetlanaNeural",
  english: "en-US-JennyNeural",
  turkish: "tr-TR-EmelNeural",
};

// Hugging Face MMS TTS (Facebook, to'liq bepul, API kalit ixtiyoriy)
const HF_MMS_MODELS: Record<string, string> = {
  russian: "facebook/mms-tts-rus",
  english: "facebook/mms-tts-eng",
  turkish: "facebook/mms-tts-tur",
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

  // 1-qavatli: ElevenLabs (eng tabiiy, pullik)
  if (ELEVENLABS_API_KEY) {
    try {
      return await elevenLabsTTS(targetText, mode);
    } catch (err) {
      console.error("ElevenLabs failed, trying Edge TTS:", err);
    }
  }

  // 2-qavatli: Microsoft Edge TTS (bepul, yuqori sifat)
  try {
    return await edgeTTS(targetText, mode);
  } catch (err) {
    console.error("Edge TTS failed, trying HuggingFace MMS:", err);
  }

  // 3-qavatli: Hugging Face MMS TTS (to'liq bepul, Facebook)
  try {
    return await huggingFaceMmsTTS(targetText, mode);
  } catch (err) {
    console.error("HuggingFace MMS failed, falling back to Google Translate TTS:", err);
  }

  // 4-qavatli: Google Translate TTS (har doim ishlaydi)
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

async function edgeTTS(
  text: string,
  mode: "russian" | "english" | "turkish"
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  const voice = EDGE_VOICES[mode];
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const cleanText = text.slice(0, 900).replace(/[<>]/g, "");
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    tts.toStream(cleanText).then((streamObj) => {
      streamObj.audio.on("data", (chunk: Buffer) => chunks.push(chunk));
      streamObj.audio.on("end", () => {
        tts.close();
        if (chunks.length === 0) return reject(new Error("Edge TTS: empty audio"));
        resolve(Buffer.concat(chunks));
      });
      streamObj.audio.on("error", (err: Error) => {
        tts.close();
        reject(err);
      });
    }).catch(reject);
  });
}

async function huggingFaceMmsTTS(
  text: string,
  mode: "russian" | "english" | "turkish"
): Promise<Buffer> {
  const model = HF_MMS_MODELS[mode];
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (HF_TOKEN) headers["Authorization"] = `Bearer ${HF_TOKEN}`;
  const response = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    { inputs: text.slice(0, 500) },
    { headers, responseType: "arraybuffer", timeout: 30000 }
  );
  const buf = Buffer.from(response.data);
  if (buf.length < 1000) throw new Error("HF MMS: audio too short, model may be loading");
  return buf;
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

function extractBeforeSeparator(text: string): string {
  const beforeSep = (text.split(/^---$/m)[0] ?? text).trim();
  const lines = beforeSep.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/[❌✅]/.test(trimmed)) continue;
    result.push(trimmed);
  }
  return result.join(" ").trim() || beforeSep.replace(/[❌✅→]/g, "").trim();
}

function extractEnglishPart(text: string): string {
  const base = extractBeforeSeparator(text);
  return base || (text.split("---")[0]?.replace(/[❌✅→]/g, "").trim() ?? text);
}

function extractRussianPart(text: string): string {
  const base = extractBeforeSeparator(text);
  return base || (text.split("---")[0]?.replace(/[❌✅→]/g, "").trim() ?? text);
}

function extractTurkishPart(text: string): string {
  const base = extractBeforeSeparator(text);
  return base || (text.split("---")[0]?.replace(/[❌✅→]/g, "").trim() ?? text);
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
