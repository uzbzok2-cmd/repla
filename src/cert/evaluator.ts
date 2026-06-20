import Groq from "groq-sdk";
import type { AiFeedback, SpeakingFeedback, CertLevel } from "./types.js";

const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });

export async function evaluateRussianWriting(
  level: CertLevel,
  prompt: string,
  essay: string
): Promise<AiFeedback> {
  const wordCount = essay.trim().split(/\s+/).length;
  const minWords = level === "B2" ? 150 : 220;

  const criteria = level === "B2"
    ? "CEFR B2 (Upper-Intermediate) Russian writing criteria: clear structure, appropriate grammar, good range of vocabulary, logical argumentation."
    : "CEFR C1 (Advanced) Russian writing criteria: sophisticated argumentation, advanced grammar structures, wide lexical range, stylistic precision, academic tone.";

  const systemPrompt = `You are an expert Russian language examiner certified for CEFR assessment. Evaluate the following Russian writing task at ${level} level based on ${criteria}. Return ONLY valid JSON, no other text.

JSON format:
{
  "task_achievement": <0-100 float>,
  "coherence_cohesion": <0-100 float>,
  "lexical_resource": <0-100 float>,
  "grammatical_range": <0-100 float>,
  "band_score": <overall 0-100, percentage>,
  "strengths": [<3 specific strong points in Uzbek or Russian>],
  "weaknesses": [<3 specific weak points in Uzbek or Russian>],
  "detailed_feedback": "<2-3 sentences of actionable feedback in Uzbek>"
}`;

  const userMsg = `Task prompt: ${prompt}\n\nCandidate's essay (${wordCount} words, minimum ${minWords} required):\n${essay}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    return JSON.parse(match[0]) as AiFeedback;
  } catch {
    const base = wordCount < minWords ? 40 : 55;
    return {
      task_achievement: base, coherence_cohesion: base,
      lexical_resource: base, grammatical_range: base,
      band_score: base,
      strengths: ["Urinish qilindi", "Mazmun mavjud", "Tuzilma bor"],
      weaknesses: ["Yaxshilanish kerak", "Ko'proq mashq qiling", "Grammatikaga e'tibor bering"],
      detailed_feedback: "AI baho bera olmadi. Ball taxminiy hisoblandi.",
    };
  }
}

export async function evaluateRussianSpeaking(
  level: CertLevel,
  partNumber: number,
  questions: string[],
  transcript: string
): Promise<SpeakingFeedback> {
  const criteria = level === "B2"
    ? "CEFR B2 Russian speaking: clear communication, good range of vocabulary, mostly accurate grammar, able to sustain discourse."
    : "CEFR C1 Russian speaking: fluent, spontaneous, flexible use of language, precise vocabulary, complex structures used accurately.";

  const systemPrompt = `You are an expert Russian language CEFR examiner. Evaluate this ${level} Russian speaking response (Part ${partNumber}) based on ${criteria}. Return ONLY valid JSON, no other text.

JSON format:
{
  "fluency_coherence": <0-100 float>,
  "pronunciation": <0-100 float>,
  "lexical_resource": <0-100 float>,
  "grammatical_range": <0-100 float>,
  "band_score": <overall 0-100 percentage>,
  "strengths": [<3 specific points in Uzbek>],
  "weaknesses": [<3 specific points in Uzbek>],
  "detailed_feedback": "<2-3 sentences in Uzbek>"
}`;

  const userMsg = `Questions (Part ${partNumber}): ${questions.join(" | ")}\nCandidate transcript: ${transcript}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: 700,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    return JSON.parse(match[0]) as SpeakingFeedback;
  } catch {
    return {
      fluency_coherence: 55, pronunciation: 55,
      lexical_resource: 55, grammatical_range: 55,
      band_score: 55,
      strengths: ["Urinish qilindi", "Muloqot mavjud", "So'z boyligi bor"],
      weaknesses: ["Ravonlik kerak", "Talaffuzga e'tibor", "Grammatika aniqligini oshiring"],
      detailed_feedback: "AI baho bera olmadi. Ball taxminiy.",
    };
  }
}

export async function transcribeRussian(audioUrl: string): Promise<string> {
  try {
    const response = await fetch(audioUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = new File([buffer], "audio.ogg", { type: "audio/ogg" });
    const t = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
      language: "ru",
    });
    return t.text;
  } catch {
    return "[Ovoz tanib bo'lmadi]";
  }
}
