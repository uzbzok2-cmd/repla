import pg from "pg";
const { Pool } = pg;
import type {
  CertUserExam, CertPassage, CertQuestion, CertListeningText,
  CertWritingPrompt, CertSpeakingQuestion, CertExamScores,
  CertLevel, CertSection, CertStatus, AiFeedback, SpeakingFeedback,
} from "./types.js";

export const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

export async function initCertSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cert_passages (
      id SERIAL PRIMARY KEY,
      level VARCHAR(5) NOT NULL,
      title VARCHAR(255) NOT NULL,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_question_bank (
      id SERIAL PRIMARY KEY,
      level VARCHAR(5) NOT NULL,
      section VARCHAR(30) NOT NULL,
      passage_id INT REFERENCES cert_passages(id) ON DELETE SET NULL,
      part_number INT NOT NULL DEFAULT 1,
      question_text TEXT NOT NULL,
      question_type VARCHAR(50) NOT NULL DEFAULT 'multiple_choice',
      options JSONB,
      correct_answer TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cert_listening_bank (
      id SERIAL PRIMARY KEY,
      level VARCHAR(5) NOT NULL,
      part_number INT NOT NULL,
      transcript TEXT NOT NULL,
      audio_file_id VARCHAR(500)
    );

    CREATE TABLE IF NOT EXISTS cert_writing_prompts (
      id SERIAL PRIMARY KEY,
      level VARCHAR(5) NOT NULL,
      prompt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_speaking_bank (
      id SERIAL PRIMARY KEY,
      level VARCHAR(5) NOT NULL,
      part_number INT NOT NULL,
      question_number INT NOT NULL,
      question_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_user_exams (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      level VARCHAR(5) NOT NULL,
      status VARCHAR(40) DEFAULT 'pending_payment',
      payment_photo_id VARCHAR(500),
      phone_number VARCHAR(50),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cert_exam_assigned_passages (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES cert_user_exams(id) ON DELETE CASCADE,
      passage_id INT REFERENCES cert_passages(id),
      passage_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_exam_assigned_grammar (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES cert_user_exams(id) ON DELETE CASCADE,
      question_id INT REFERENCES cert_question_bank(id),
      question_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_exam_assigned_listening (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES cert_user_exams(id) ON DELETE CASCADE,
      listening_id INT REFERENCES cert_listening_bank(id),
      part_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cert_user_answers (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES cert_user_exams(id) ON DELETE CASCADE,
      question_id INT REFERENCES cert_question_bank(id),
      section VARCHAR(30) NOT NULL,
      answer TEXT,
      is_correct BOOLEAN,
      answered_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cert_writing_submissions (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES cert_user_exams(id) ON DELETE CASCADE,
      prompt_id INT REFERENCES cert_writing_prompts(id),
      text TEXT NOT NULL,
      ai_score FLOAT,
      ai_feedback JSONB,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cert_speaking_submissions (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES cert_user_exams(id) ON DELETE CASCADE,
      part_number INT NOT NULL,
      transcript TEXT,
      ai_score FLOAT,
      ai_feedback JSONB,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cert_exam_scores (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES cert_user_exams(id) ON DELETE CASCADE UNIQUE,
      reading_score FLOAT,
      listening_score FLOAT,
      grammar_score FLOAT,
      writing_score FLOAT,
      speaking_score FLOAT,
      overall_score FLOAT,
      passed BOOLEAN,
      calculated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ Cert schema initialized");
}

// ── User Exam ────────────────────────────────────────────────────────
export async function createCertUserExam(userId: number, level: CertLevel, phone: string | null): Promise<CertUserExam> {
  const r = await pool.query<CertUserExam>(
    "INSERT INTO cert_user_exams (user_id, level, phone_number) VALUES ($1, $2, $3) RETURNING *",
    [userId, level, phone]
  );
  return r.rows[0]!;
}

export async function getLatestCertUserExam(userId: number, level: CertLevel): Promise<CertUserExam | null> {
  const r = await pool.query<CertUserExam>(
    "SELECT * FROM cert_user_exams WHERE user_id = $1 AND level = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, level]
  );
  return r.rows[0] ?? null;
}

export async function getCertUserExamById(id: number): Promise<CertUserExam | null> {
  const r = await pool.query<CertUserExam>("SELECT * FROM cert_user_exams WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function updateCertStatus(userExamId: number, status: CertStatus): Promise<void> {
  const extra = status === "reading" || status === "listening" || status === "grammar" || status === "writing" || status === "speaking"
    ? ", started_at = NOW()" : "";
  if (status === "completed") {
    await pool.query("UPDATE cert_user_exams SET status = $1, completed_at = NOW() WHERE id = $2", [status, userExamId]);
  } else {
    await pool.query(`UPDATE cert_user_exams SET status = $1${extra} WHERE id = $2`, [status, userExamId]);
  }
}

export async function setCertPaymentPhoto(userExamId: number, photoId: string): Promise<void> {
  await pool.query(
    "UPDATE cert_user_exams SET payment_photo_id = $1, status = 'payment_pending_approval' WHERE id = $2",
    [photoId, userExamId]
  );
}

export async function getPendingCertPayments(): Promise<CertUserExam[]> {
  const r = await pool.query<CertUserExam>(
    "SELECT * FROM cert_user_exams WHERE status = 'payment_pending_approval' ORDER BY created_at DESC"
  );
  return r.rows;
}

export async function getAnyPendingCertExam(userId: number): Promise<CertUserExam | null> {
  const r = await pool.query<CertUserExam>(
    "SELECT * FROM cert_user_exams WHERE user_id = $1 AND status = 'pending_payment' ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  return r.rows[0] ?? null;
}

export async function getAllCertUserExams(): Promise<{ user_id: number; level: string; status: string; created_at: Date }[]> {
  const r = await pool.query(
    "SELECT user_id, level, status, created_at FROM cert_user_exams ORDER BY created_at DESC LIMIT 100"
  );
  return r.rows;
}

// ── Passage bank ─────────────────────────────────────────────────────
export async function getPassages(level: CertLevel): Promise<CertPassage[]> {
  const r = await pool.query<CertPassage>(
    "SELECT * FROM cert_passages WHERE level = $1 ORDER BY id",
    [level]
  );
  return r.rows;
}

export async function countPassages(level: CertLevel): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM cert_passages WHERE level = $1", [level]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

export async function insertPassage(level: CertLevel, title: string, text: string): Promise<CertPassage> {
  const r = await pool.query<CertPassage>(
    "INSERT INTO cert_passages (level, title, text) VALUES ($1, $2, $3) RETURNING *",
    [level, title, text]
  );
  return r.rows[0]!;
}

// ── Assign passages to user exam (random 3) ──────────────────────────
export async function assignPassages(userExamId: number, level: CertLevel): Promise<CertPassage[]> {
  const all = await getPassages(level);
  const shuffled = shuffle(all).slice(0, 3);
  for (let i = 0; i < shuffled.length; i++) {
    await pool.query(
      "INSERT INTO cert_exam_assigned_passages (user_exam_id, passage_id, passage_order) VALUES ($1, $2, $3)",
      [userExamId, shuffled[i]!.id, i + 1]
    );
  }
  return shuffled;
}

export async function getAssignedPassages(userExamId: number): Promise<CertPassage[]> {
  const r = await pool.query<CertPassage>(
    `SELECT p.* FROM cert_passages p
     JOIN cert_exam_assigned_passages ap ON ap.passage_id = p.id
     WHERE ap.user_exam_id = $1
     ORDER BY ap.passage_order`,
    [userExamId]
  );
  return r.rows;
}

// ── Questions bank ───────────────────────────────────────────────────
export async function getQuestionsForPassage(passageId: number): Promise<CertQuestion[]> {
  const r = await pool.query<CertQuestion>(
    "SELECT * FROM cert_question_bank WHERE passage_id = $1 ORDER BY id",
    [passageId]
  );
  return r.rows;
}

export async function getGrammarQuestions(level: CertLevel): Promise<CertQuestion[]> {
  const r = await pool.query<CertQuestion>(
    "SELECT * FROM cert_question_bank WHERE level = $1 AND section = 'grammar' ORDER BY id",
    [level]
  );
  return r.rows;
}

export async function assignGrammarQuestions(userExamId: number, level: CertLevel): Promise<CertQuestion[]> {
  const all = await getGrammarQuestions(level);
  const selected = shuffle(all).slice(0, 30);
  for (let i = 0; i < selected.length; i++) {
    await pool.query(
      "INSERT INTO cert_exam_assigned_grammar (user_exam_id, question_id, question_order) VALUES ($1, $2, $3)",
      [userExamId, selected[i]!.id, i + 1]
    );
  }
  return selected;
}

export async function getAssignedGrammarQuestions(userExamId: number): Promise<CertQuestion[]> {
  const r = await pool.query<CertQuestion>(
    `SELECT q.* FROM cert_question_bank q
     JOIN cert_exam_assigned_grammar ag ON ag.question_id = q.id
     WHERE ag.user_exam_id = $1
     ORDER BY ag.question_order`,
    [userExamId]
  );
  return r.rows;
}

export async function insertQuestion(
  level: CertLevel, section: CertSection, passageId: number | null,
  partNumber: number, questionText: string, questionType: string,
  options: string[] | null, correctAnswer: string
): Promise<CertQuestion> {
  const r = await pool.query<CertQuestion>(
    `INSERT INTO cert_question_bank
      (level, section, passage_id, part_number, question_text, question_type, options, correct_answer)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [level, section, passageId, partNumber, questionText, questionType,
     options ? JSON.stringify(options) : null, correctAnswer]
  );
  return r.rows[0]!;
}

// ── Listening bank ───────────────────────────────────────────────────
export async function getListeningBank(level: CertLevel): Promise<CertListeningText[]> {
  const r = await pool.query<CertListeningText>(
    "SELECT * FROM cert_listening_bank WHERE level = $1 ORDER BY id",
    [level]
  );
  return r.rows;
}

export async function countListeningBank(level: CertLevel): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM cert_listening_bank WHERE level = $1", [level]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

export async function insertListeningText(level: CertLevel, partNumber: number, transcript: string): Promise<CertListeningText> {
  const r = await pool.query<CertListeningText>(
    "INSERT INTO cert_listening_bank (level, part_number, transcript) VALUES ($1,$2,$3) RETURNING *",
    [level, partNumber, transcript]
  );
  return r.rows[0]!;
}

export async function updateListeningAudio(listeningId: number, audioFileId: string): Promise<void> {
  await pool.query("UPDATE cert_listening_bank SET audio_file_id = $1 WHERE id = $2", [audioFileId, listeningId]);
}

export async function assignListeningTexts(userExamId: number, level: CertLevel): Promise<CertListeningText[]> {
  const all = await getListeningBank(level);
  const selected = shuffle(all).slice(0, 4);
  for (let i = 0; i < selected.length; i++) {
    await pool.query(
      "INSERT INTO cert_exam_assigned_listening (user_exam_id, listening_id, part_order) VALUES ($1,$2,$3)",
      [userExamId, selected[i]!.id, i + 1]
    );
  }
  return selected;
}

export async function getAssignedListeningTexts(userExamId: number): Promise<CertListeningText[]> {
  const r = await pool.query<CertListeningText>(
    `SELECT l.* FROM cert_listening_bank l
     JOIN cert_exam_assigned_listening al ON al.listening_id = l.id
     WHERE al.user_exam_id = $1
     ORDER BY al.part_order`,
    [userExamId]
  );
  return r.rows;
}

// ── Writing prompts ──────────────────────────────────────────────────
export async function getWritingPrompts(level: CertLevel): Promise<CertWritingPrompt[]> {
  const r = await pool.query<CertWritingPrompt>(
    "SELECT * FROM cert_writing_prompts WHERE level = $1 ORDER BY id",
    [level]
  );
  return r.rows;
}

export async function countWritingPrompts(level: CertLevel): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM cert_writing_prompts WHERE level = $1", [level]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

export async function insertWritingPrompt(level: CertLevel, prompt: string): Promise<CertWritingPrompt> {
  const r = await pool.query<CertWritingPrompt>(
    "INSERT INTO cert_writing_prompts (level, prompt) VALUES ($1,$2) RETURNING *",
    [level, prompt]
  );
  return r.rows[0]!;
}

export async function pickRandomWritingPrompt(userExamId: number, level: CertLevel): Promise<CertWritingPrompt> {
  const all = await getWritingPrompts(level);
  const picked = shuffle(all)[0]!;
  return picked;
}

// ── Speaking bank ────────────────────────────────────────────────────
export async function getSpeakingQuestions(level: CertLevel, partNumber: number): Promise<CertSpeakingQuestion[]> {
  const r = await pool.query<CertSpeakingQuestion>(
    "SELECT * FROM cert_speaking_bank WHERE level = $1 AND part_number = $2 ORDER BY id",
    [level, partNumber]
  );
  return shuffle(r.rows).slice(0, partNumber === 2 ? 1 : 4);
}

export async function countSpeakingBank(level: CertLevel): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM cert_speaking_bank WHERE level = $1", [level]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

export async function insertSpeakingQuestion(level: CertLevel, partNumber: number, questionNumber: number, questionText: string): Promise<CertSpeakingQuestion> {
  const r = await pool.query<CertSpeakingQuestion>(
    "INSERT INTO cert_speaking_bank (level, part_number, question_number, question_text) VALUES ($1,$2,$3,$4) RETURNING *",
    [level, partNumber, questionNumber, questionText]
  );
  return r.rows[0]!;
}

// ── Answers ───────────────────────────────────────────────────────────
export async function saveCertAnswer(
  userExamId: number, questionId: number, section: CertSection,
  answer: string, isCorrect: boolean
): Promise<void> {
  await pool.query(
    "INSERT INTO cert_user_answers (user_exam_id, question_id, section, answer, is_correct) VALUES ($1,$2,$3,$4,$5)",
    [userExamId, questionId, section, answer, isCorrect]
  );
}

export async function countCertCorrect(userExamId: number, section: CertSection): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM cert_user_answers WHERE user_exam_id = $1 AND section = $2 AND is_correct = true",
    [userExamId, section]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

export async function countCertTotal(userExamId: number, section: CertSection): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM cert_user_answers WHERE user_exam_id = $1 AND section = $2",
    [userExamId, section]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

// ── Writing submission ────────────────────────────────────────────────
export async function saveCertWriting(
  userExamId: number, promptId: number | null, text: string,
  score: number, feedback: AiFeedback
): Promise<void> {
  await pool.query(
    "INSERT INTO cert_writing_submissions (user_exam_id, prompt_id, text, ai_score, ai_feedback) VALUES ($1,$2,$3,$4,$5)",
    [userExamId, promptId ?? null, text, score, JSON.stringify(feedback)]
  );
}

export async function getCertWriting(userExamId: number): Promise<{ ai_score: number; ai_feedback: AiFeedback } | null> {
  const r = await pool.query(
    "SELECT ai_score, ai_feedback FROM cert_writing_submissions WHERE user_exam_id = $1 LIMIT 1",
    [userExamId]
  );
  return r.rows[0] ?? null;
}

// ── Speaking submission ───────────────────────────────────────────────
export async function saveCertSpeaking(
  userExamId: number, partNumber: number, transcript: string,
  score: number, feedback: SpeakingFeedback
): Promise<void> {
  await pool.query(
    "INSERT INTO cert_speaking_submissions (user_exam_id, part_number, transcript, ai_score, ai_feedback) VALUES ($1,$2,$3,$4,$5)",
    [userExamId, partNumber, transcript, score, JSON.stringify(feedback)]
  );
}

export async function getCertSpeaking(userExamId: number): Promise<{ part_number: number; ai_score: number }[]> {
  const r = await pool.query(
    "SELECT part_number, ai_score FROM cert_speaking_submissions WHERE user_exam_id = $1 ORDER BY part_number",
    [userExamId]
  );
  return r.rows;
}

// ── Scores ────────────────────────────────────────────────────────────
export async function saveCertScores(
  userExamId: number, reading: number, listening: number,
  grammar: number, writing: number, speaking: number,
  overall: number, passed: boolean
): Promise<void> {
  await pool.query(`
    INSERT INTO cert_exam_scores
      (user_exam_id, reading_score, listening_score, grammar_score, writing_score, speaking_score, overall_score, passed)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (user_exam_id) DO UPDATE
    SET reading_score=$2, listening_score=$3, grammar_score=$4,
        writing_score=$5, speaking_score=$6, overall_score=$7, passed=$8, calculated_at=NOW()
  `, [userExamId, reading, listening, grammar, writing, speaking, overall, passed]);
}

export async function getCertScores(userExamId: number): Promise<CertExamScores | null> {
  const r = await pool.query<CertExamScores>(
    "SELECT * FROM cert_exam_scores WHERE user_exam_id = $1", [userExamId]
  );
  return r.rows[0] ?? null;
}

// ── Util ──────────────────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export async function getCertStats(): Promise<{ total: number; b2: number; c1: number; completed: number; pending: number }> {
  const r = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE level='B2') as b2,
      COUNT(*) FILTER (WHERE level='C1') as c1,
      COUNT(*) FILTER (WHERE status='completed') as completed,
      COUNT(*) FILTER (WHERE status='payment_pending_approval') as pending
    FROM cert_user_exams
  `);
  const row = r.rows[0] as Record<string, string>;
  return {
    total: parseInt(row["total"] ?? "0", 10),
    b2: parseInt(row["b2"] ?? "0", 10),
    c1: parseInt(row["c1"] ?? "0", 10),
    completed: parseInt(row["completed"] ?? "0", 10),
    pending: parseInt(row["pending"] ?? "0", 10),
  };
}
