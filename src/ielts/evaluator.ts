import Groq from "groq-sdk";
import type { AiFeedback, SpeakingFeedback } from "./types.js";

const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });

// ── Writing evaluator ─────────────────────────────────────────────────
export async function evaluateWriting(
  taskNumber: number, prompt: string, essay: string
): Promise<AiFeedback> {
  const wordCount = essay.trim().split(/\s+/).length;
  const minWords  = taskNumber === 1 ? 150 : 250;

  const systemPrompt = `You are an expert IELTS examiner. Evaluate the following IELTS Writing Task ${taskNumber} response strictly according to official IELTS band descriptors. Return ONLY valid JSON, no other text.

JSON format:
{
  "task_achievement": <0-9 float>,
  "coherence_cohesion": <0-9 float>,
  "lexical_resource": <0-9 float>,
  "grammatical_range": <0-9 float>,
  "band_score": <overall 0-9, rounded to nearest 0.5>,
  "strengths": [<3 specific strong points>],
  "weaknesses": [<3 specific weak points>],
  "detailed_feedback": "<2-3 sentences of actionable feedback>"
}`;

  const userMessage = `Task ${taskNumber} prompt: ${prompt}

Candidate's response (${wordCount} words, minimum ${minWords} required):
${essay}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]) as AiFeedback;
  } catch {
    const baseScore = wordCount < minWords ? 4.0 : 5.0;
    return {
      task_achievement: baseScore,
      coherence_cohesion: baseScore,
      lexical_resource: baseScore,
      grammatical_range: baseScore,
      band_score: baseScore,
      strengths: ["Attempt made", "Content provided", "Some structure visible"],
      weaknesses: ["Needs improvement", "Review band descriptors", "Practice more"],
      detailed_feedback: "Unable to get detailed AI feedback. Score estimated based on word count and structure.",
    };
  }
}

// ── Speaking evaluator ────────────────────────────────────────────────
export async function evaluateSpeaking(
  partNumber: number, questions: string[], transcript: string
): Promise<SpeakingFeedback> {
  const systemPrompt = `You are an expert IELTS examiner. Evaluate the following IELTS Speaking Part ${partNumber} response strictly according to official IELTS band descriptors. Return ONLY valid JSON, no other text.

JSON format:
{
  "fluency_coherence": <0-9 float>,
  "pronunciation": <0-9 float>,
  "lexical_resource": <0-9 float>,
  "grammatical_range": <0-9 float>,
  "band_score": <overall 0-9, rounded to nearest 0.5>,
  "strengths": [<3 specific strong points>],
  "weaknesses": [<3 specific weak points>],
  "detailed_feedback": "<2-3 sentences of actionable feedback>"
}`;

  const userMessage = `Speaking Part ${partNumber}
Questions asked: ${questions.join(" | ")}
Candidate's transcript: ${transcript}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 700,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]) as SpeakingFeedback;
  } catch {
    return {
      fluency_coherence: 5.0,
      pronunciation: 5.0,
      lexical_resource: 5.0,
      grammatical_range: 5.0,
      band_score: 5.0,
      strengths: ["Attempt made", "Communication visible", "Some vocabulary used"],
      weaknesses: ["Fluency can improve", "Pronunciation practice needed", "Grammar accuracy"],
      detailed_feedback: "Unable to get detailed AI feedback. Score estimated at Band 5.0.",
    };
  }
}

// ── Transcribe audio ──────────────────────────────────────────────────
export async function transcribeForSpeaking(audioUrl: string): Promise<string> {
  try {
    const response = await fetch(audioUrl);
    const buffer   = Buffer.from(await response.arrayBuffer());
    const file     = new File([buffer], "audio.ogg", { type: "audio/ogg" });

    const transcription = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
      language: "en",
    });
    return transcription.text;
  } catch {
    return "[Could not transcribe audio]";
  }
}
