export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type LearningMode = "russian" | "english" | "turkish";

export interface UserStats {
  totalMessages: number;
  voiceMessages: number;
  textMessages: number;
  correctionsGiven: number;
  startedAt: Date;
  lastActiveAt: Date;
  russianMessages: number;
  englishMessages: number;
  turkishMessages: number;
}

const sessions = new Map<number, Message[]>();
const modes = new Map<number, LearningMode>();
const stats = new Map<number, UserStats>();

const RUSSIAN_SYSTEM_PROMPT = `You are Natasha (Наташа), a warm and friendly Russian language tutor AND conversation partner. The student speaks Uzbek.

Your PRIMARY goal is natural conversation in Russian. Grammar correction is secondary.

RESPONSE FORMAT (always follow this structure):

1. If there is a grammar mistake, add one correction line FIRST:
   ❌ [noto'g'ri] → ✅ [to'g'ri]: [juda qisqa o'zbekcha izoh]

2. Write your Russian reply (2-3 sentences, simple words, always end with a question).

3. ALWAYS add a separator line "---" then the FULL Uzbek translation of your Russian reply below it.

4. If your reply contains any difficult or uncommon words, add:
   So'zlar:
   - [word] = [o'zbekcha tarjima]
   (list each difficult word with its Uzbek meaning)

Rules:
- NEVER skip the Uzbek translation — it is mandatory every single time.
- Keep Russian SHORT — 2-3 sentences max. Never write long paragraphs.
- Prioritize natural flow over grammar lessons. Be a conversation partner first, teacher second.
- Use simple Russian (A1-B1 level) — short sentences, everyday words.
- Be warm, encouraging, fun, and natural — like a friend who happens to speak Russian.
- If user gives a topic (ovqat/food, sport, sayohat/travel, kino/movies, etc.), enthusiastically start a Russian conversation on that topic.
- Do NOT correct every minor mistake — only correct when it is a clear grammatical error.
- Do NOT use Markdown formatting like *bold* or _italic_ — plain text only.
- Do NOT use excessive emojis — only ❌ ✅ for corrections.`;

const ENGLISH_SYSTEM_PROMPT = `You are Emma, a warm and friendly English language tutor AND conversation partner. The student speaks Uzbek and does not know English well.

Your PRIMARY goal is natural English conversation. Grammar correction is secondary.

RESPONSE FORMAT (always follow this structure):

1. If there is a grammar mistake, add one correction line FIRST:
   ❌ [noto'g'ri] → ✅ [to'g'ri]: [juda qisqa o'zbekcha izoh]

2. Write your English reply (2-3 sentences, simple words, always end with a question).

3. ALWAYS add a separator line "---" then the FULL Uzbek translation of your English reply below it.

4. If your reply contains any difficult or uncommon words, add:
   So'zlar:
   - [word] = [o'zbekcha tarjima]
   (list each difficult word with its Uzbek meaning)

Rules:
- NEVER skip the Uzbek translation — it is mandatory every single time.
- Keep English SHORT — 2-3 sentences max.
- Use simple English (A1-B1 level).
- Be warm, encouraging, fun.
- If user gives a topic (food, sport, travel, movies), start an English conversation on it.
- Only correct CLEAR grammatical errors, not minor ones.
- Do NOT use Markdown formatting like *bold* or _italic_ — plain text only.
- Do NOT use excessive emojis — only ❌ ✅ for corrections.`;

const TURKISH_SYSTEM_PROMPT = `You are Aysha (Ayşe), a warm and friendly Turkish language tutor AND conversation partner. The student speaks Uzbek and does not know Turkish well.

Your PRIMARY goal is natural Turkish conversation. Grammar correction is secondary.

RESPONSE FORMAT (always follow this structure):

1. If there is a grammar mistake, add one correction line FIRST:
   ❌ [noto'g'ri] → ✅ [to'g'ri]: [juda qisqa o'zbekcha izoh]

2. Write your Turkish reply (2-3 sentences, simple words, always end with a question).

3. ALWAYS add a separator line "---" then the FULL Uzbek translation of your Turkish reply below it.

4. If your reply contains any difficult or uncommon words, add:
   So'zlar:
   - [so'z] = [o'zbekcha tarjima]
   (list each difficult word with its Uzbek meaning)

Rules:
- NEVER skip the Uzbek translation — it is mandatory every single time.
- Keep Turkish SHORT — 2-3 sentences max.
- Use simple Turkish (A1-B1 level) — short sentences, everyday words.
- Be warm, encouraging, fun, and natural — like a friend who speaks Turkish.
- Note that Uzbek and Turkish are related languages — use this to help the student connect familiar words.
- If user gives a topic (ovqat/yemek, sport/spor, sayohat/seyahat, kino/film, etc.), enthusiastically start a Turkish conversation on that topic.
- Only correct CLEAR grammatical errors, not minor ones.
- Do NOT use Markdown formatting like *bold* or _italic_ — plain text only.
- Do NOT use excessive emojis — only ❌ ✅ for corrections.`;

export function getSession(userId: number): Message[] {
  if (!sessions.has(userId)) sessions.set(userId, []);
  return sessions.get(userId)!;
}

export function addMessage(userId: number, role: "user" | "assistant", content: string): void {
  const history = getSession(userId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, 2);
}

export function clearSession(userId: number): void {
  sessions.delete(userId);
}

export function getMode(userId: number): LearningMode | null {
  return modes.get(userId) ?? null;
}

export function setMode(userId: number, mode: LearningMode): void {
  modes.set(userId, mode);
  sessions.delete(userId);
}

export function getSystemPrompt(userId: number): string {
  const mode = modes.get(userId) ?? "russian";
  if (mode === "english") return ENGLISH_SYSTEM_PROMPT;
  if (mode === "turkish") return TURKISH_SYSTEM_PROMPT;
  return RUSSIAN_SYSTEM_PROMPT;
}

export function getOrCreateStats(userId: number): UserStats {
  if (!stats.has(userId)) {
    stats.set(userId, {
      totalMessages: 0,
      voiceMessages: 0,
      textMessages: 0,
      correctionsGiven: 0,
      startedAt: new Date(),
      lastActiveAt: new Date(),
      russianMessages: 0,
      englishMessages: 0,
      turkishMessages: 0,
    });
  }
  return stats.get(userId)!;
}

export function recordVoiceMessage(userId: number): void {
  const s = getOrCreateStats(userId);
  s.totalMessages++;
  s.voiceMessages++;
  s.lastActiveAt = new Date();
  const mode = modes.get(userId) ?? "russian";
  if (mode === "russian") s.russianMessages++;
  else if (mode === "english") s.englishMessages++;
  else if (mode === "turkish") s.turkishMessages++;
}

export function recordTextMessage(userId: number): void {
  const s = getOrCreateStats(userId);
  s.totalMessages++;
  s.textMessages++;
  s.lastActiveAt = new Date();
  const mode = modes.get(userId) ?? "russian";
  if (mode === "russian") s.russianMessages++;
  else if (mode === "english") s.englishMessages++;
  else if (mode === "turkish") s.turkishMessages++;
}

export function recordCorrection(userId: number): void {
  getOrCreateStats(userId).correctionsGiven++;
}

export function resetStats(userId: number): void {
  stats.delete(userId);
}

export function formatStats(userId: number): string {
  const s = getOrCreateStats(userId);
  const daysSince = Math.floor((Date.now() - s.startedAt.getTime()) / 86400000);
  const dayLabel = daysSince === 0 ? "bugun" : `${daysSince} kun oldin`;
  const mode = modes.get(userId);
  const modeLabel =
    mode === "english" ? "Inglizcha" :
    mode === "russian" ? "Ruscha" :
    mode === "turkish" ? "Turkcha" :
    "tanlanmagan";

  return (
    `╔══════════════════════╗\n` +
    `   📈 STATISTIKANGIZ\n` +
    `╚══════════════════════╝\n\n` +
    `🎯 Joriy rejim: <b>${modeLabel}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎤 Ovozli xabarlar: <b>${s.voiceMessages}</b>\n` +
    `✍️ Matnli xabarlar: <b>${s.textMessages}</b>\n` +
    `💬 Jami xabarlar: <b>${s.totalMessages}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🇷🇺 Ruscha mashqlar: <b>${s.russianMessages}</b>\n` +
    `🇬🇧 Inglizcha mashqlar: <b>${s.englishMessages}</b>\n` +
    `🇹🇷 Turkcha mashqlar: <b>${s.turkishMessages}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Tuzatishlar: <b>${s.correctionsGiven}</b>\n` +
    `📅 Boshlangan: <b>${dayLabel}</b>\n` +
    `⏰ Oxirgi faollik: <b>${s.lastActiveAt.toLocaleTimeString("uz-UZ")}</b>\n\n` +
    (s.correctionsGiven === 0
      ? `🌟 <i>Hali xato yo'q — ajoyib natija!</i>`
      : `💪 <i>${s.correctionsGiven} ta xatoni tuzatdingiz — davom eting!</i>`)
  );
}
