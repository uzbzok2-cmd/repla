// IELTS official raw score to band score conversion tables

const LISTENING_TABLE: Record<number, number> = {
  39: 9.0, 38: 8.5, 37: 8.5, 36: 8.0, 35: 8.0, 34: 7.5, 33: 7.5, 32: 7.0,
  31: 7.0, 30: 6.5, 29: 6.5, 28: 6.0, 27: 6.0, 26: 6.0, 25: 5.5, 24: 5.5,
  23: 5.5, 22: 5.0, 21: 5.0, 20: 5.0, 19: 4.5, 18: 4.5, 17: 4.0, 16: 4.0,
  15: 4.0, 14: 3.5, 13: 3.5, 12: 3.5, 11: 3.0, 10: 3.0, 9: 2.5, 8: 2.5,
  7: 2.0, 6: 2.0, 5: 1.5, 4: 1.0, 3: 1.0, 2: 1.0, 1: 1.0, 0: 0,
};

const READING_ACADEMIC_TABLE: Record<number, number> = {
  39: 9.0, 38: 8.5, 37: 8.0, 36: 7.5, 35: 7.0, 34: 6.5, 33: 6.5, 32: 6.0,
  31: 6.0, 30: 5.5, 29: 5.5, 28: 5.5, 27: 5.0, 26: 5.0, 25: 5.0, 24: 4.5,
  23: 4.5, 22: 4.5, 21: 4.0, 20: 4.0, 19: 3.5, 18: 3.5, 17: 3.0, 16: 3.0,
  15: 3.0, 14: 2.5, 13: 2.5, 12: 2.5, 11: 2.0, 10: 2.0, 9: 2.0, 8: 2.0,
  7: 1.5, 6: 1.5, 5: 1.5, 4: 1.0, 3: 1.0, 2: 1.0, 1: 1.0, 0: 0,
};

export function rawToListeningBand(correct: number): number {
  const clamped = Math.min(40, Math.max(0, correct));
  if (clamped === 40) return 9.0;
  return LISTENING_TABLE[clamped] ?? 0;
}

export function rawToReadingBand(correct: number): number {
  const clamped = Math.min(40, Math.max(0, correct));
  if (clamped === 40) return 9.0;
  return READING_ACADEMIC_TABLE[clamped] ?? 0;
}

export function roundToBand(score: number): number {
  const floored = Math.floor(score * 2) / 2;
  return Math.max(1.0, Math.min(9.0, floored));
}

export function calcOverall(l: number, r: number, w: number, s: number): number {
  const avg = (l + r + w + s) / 4;
  return roundToBand(avg);
}

export function bandEmoji(band: number): string {
  if (band >= 8.0) return "🏆";
  if (band >= 7.0) return "🥇";
  if (band >= 6.0) return "🥈";
  if (band >= 5.0) return "🥉";
  return "📚";
}

export function bandDescription(band: number): string {
  if (band >= 9.0) return "Expert foydalanuvchi";
  if (band >= 8.0) return "Very Good — A'lo";
  if (band >= 7.0) return "Good — Yaxshi";
  if (band >= 6.0) return "Competent — O'rtadan yuqori";
  if (band >= 5.5) return "Modest — O'rtacha";
  if (band >= 5.0) return "Modest — Qoniqarli";
  if (band >= 4.0) return "Limited — Cheklangan";
  return "Extremely Limited — Juda cheklangan";
}
