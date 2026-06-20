export interface CertificateData {
  fullName: string;
  level: "B2" | "C1";
  readingScore: number;
  listeningScore: number;
  grammarScore: number;
  writingScore: number;
  speakingScore: number;
  overallScore: number;
  passed: boolean;
  examDate: string;
  certNumber: string;
}

export function generateCertificate(data: CertificateData): string {
  const stars = data.passed ? "⭐⭐⭐⭐⭐" : "📚📚📚";
  const status = data.passed ? "✅ O'TGAN / PASSED" : "❌ O'TMAGAN / NOT PASSED";
  const levelFull = data.level === "B2"
    ? "Upper-Intermediate (B2)"
    : "Advanced (C1)";

  return (
    `🏛 ════════════════════════════════ 🏛\n` +
    `\n` +
    `         📜  S E R T I F I K A T\n` +
    `    CERTIFICATE OF ACHIEVEMENT\n` +
    `\n` +
    `🏛 ════════════════════════════════ 🏛\n` +
    `\n` +
    `${stars}\n` +
    `\n` +
    `👤 <b>Talaba / Candidate:</b>\n` +
    `   <b>${data.fullName}</b>\n` +
    `\n` +
    `📋 <b>Imtihon / Examination:</b>\n` +
    `   Rus tili CEFR Sertifikati\n` +
    `   Russian Language CEFR Certificate\n` +
    `\n` +
    `🎯 <b>Daraja / Level:</b>\n` +
    `   <b>${data.level} — ${levelFull}</b>\n` +
    `\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊  <b>NATIJALAR / RESULTS</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `\n` +
    `📖 Чтение (Reading):        <b>${data.readingScore.toFixed(0)}%</b>\n` +
    `🎧 Аудирование (Listening): <b>${data.listeningScore.toFixed(0)}%</b>\n` +
    `📝 Лексика и грамматика:    <b>${data.grammarScore.toFixed(0)}%</b>\n` +
    `✍️  Письмо (Writing):        <b>${data.writingScore.toFixed(0)}%</b>\n` +
    `🗣  Говорение (Speaking):    <b>${data.speakingScore.toFixed(0)}%</b>\n` +
    `\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏆 <b>UMUMIY BALL / OVERALL: ${data.overallScore.toFixed(1)}%</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `\n` +
    `<b>${status}</b>\n` +
    `\n` +
    `📅 Sana / Date: ${data.examDate}\n` +
    `🔖 Sertifikat №: ${data.certNumber}\n` +
    `\n` +
    `🏛 ════════════════════════════════ 🏛\n` +
    `\n` +
    `<i>Ushbu sertifikat CEFR ${data.level} darajasiga\n` +
    `mos keluvchi rus tili sinovlari asosida berildi.\n` +
    `Powered by AI Language Assessment System</i>`
  );
}

export function generateCertNumber(userId: number, level: string, userExamId: number): string {
  const year = new Date().getFullYear();
  const pad = (n: number, len: number) => n.toString().padStart(len, "0");
  return `RU-${level}-${year}-${pad(userExamId, 5)}`;
}

export function formatExamDate(): string {
  const now = new Date();
  const months = [
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
  ];
  return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}
