import pg from "pg";
import type {
  IeltsExam, ListeningPart, ReadingPassage, IeltsQuestion,
  WritingTask, SpeakingQuestion, UserExam, ExamScores,
  AiFeedback, SpeakingFeedback, ExamStatus,
} from "./types.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

// ── Schema ────────────────────────────────────────────────────────────
export async function initSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ielts_exams (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS listening_parts (
      id SERIAL PRIMARY KEY,
      exam_id INT REFERENCES ielts_exams(id) ON DELETE CASCADE,
      part_number INT NOT NULL,
      audio_file_id VARCHAR(500),
      transcript TEXT,
      duration_seconds INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reading_passages (
      id SERIAL PRIMARY KEY,
      exam_id INT REFERENCES ielts_exams(id) ON DELETE CASCADE,
      passage_number INT NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '',
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ielts_questions (
      id SERIAL PRIMARY KEY,
      exam_id INT REFERENCES ielts_exams(id) ON DELETE CASCADE,
      section VARCHAR(20) NOT NULL,
      part_number INT NOT NULL DEFAULT 1,
      question_number INT NOT NULL,
      question_text TEXT NOT NULL,
      question_type VARCHAR(50) NOT NULL DEFAULT 'short_answer',
      options JSONB,
      correct_answer TEXT NOT NULL DEFAULT '',
      marks INT DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS writing_tasks (
      id SERIAL PRIMARY KEY,
      exam_id INT REFERENCES ielts_exams(id) ON DELETE CASCADE,
      task_number INT NOT NULL,
      prompt TEXT NOT NULL,
      image_file_id VARCHAR(500)
    );

    CREATE TABLE IF NOT EXISTS speaking_questions (
      id SERIAL PRIMARY KEY,
      exam_id INT REFERENCES ielts_exams(id) ON DELETE CASCADE,
      part_number INT NOT NULL,
      question_number INT NOT NULL,
      question_text TEXT NOT NULL,
      audio_file_id VARCHAR(500)
    );

    CREATE TABLE IF NOT EXISTS user_exams (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      exam_id INT REFERENCES ielts_exams(id),
      status VARCHAR(40) DEFAULT 'pending_payment',
      payment_photo_id VARCHAR(500),
      section_deadline TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_answers (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES user_exams(id) ON DELETE CASCADE,
      question_id INT REFERENCES ielts_questions(id),
      section VARCHAR(20) NOT NULL,
      answer TEXT,
      is_correct BOOLEAN,
      answered_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS writing_submissions (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES user_exams(id) ON DELETE CASCADE,
      task_number INT NOT NULL,
      text TEXT NOT NULL,
      ai_score FLOAT,
      ai_feedback JSONB,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS speaking_submissions (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES user_exams(id) ON DELETE CASCADE,
      part_number INT NOT NULL,
      transcript TEXT,
      ai_score FLOAT,
      ai_feedback JSONB,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS exam_scores (
      id SERIAL PRIMARY KEY,
      user_exam_id INT REFERENCES user_exams(id) ON DELETE CASCADE UNIQUE,
      listening_score FLOAT,
      reading_score FLOAT,
      writing_score FLOAT,
      speaking_score FLOAT,
      overall_score FLOAT,
      calculated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ IELTS schema initialized");
}

// ── Exam queries ──────────────────────────────────────────────────────
export async function getActiveExam(): Promise<IeltsExam | null> {
  const r = await pool.query<IeltsExam>(
    "SELECT * FROM ielts_exams WHERE is_active = true ORDER BY created_at DESC LIMIT 1"
  );
  return r.rows[0] ?? null;
}

export async function getExamById(id: number): Promise<IeltsExam | null> {
  const r = await pool.query<IeltsExam>("SELECT * FROM ielts_exams WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function createExam(title: string): Promise<IeltsExam> {
  const r = await pool.query<IeltsExam>(
    "INSERT INTO ielts_exams (title) VALUES ($1) RETURNING *", [title]
  );
  return r.rows[0]!;
}

export async function activateExam(id: number): Promise<void> {
  await pool.query("UPDATE ielts_exams SET is_active = false");
  await pool.query("UPDATE ielts_exams SET is_active = true WHERE id = $1", [id]);
}

export async function listExams(): Promise<IeltsExam[]> {
  const r = await pool.query<IeltsExam>("SELECT * FROM ielts_exams ORDER BY created_at DESC LIMIT 20");
  return r.rows;
}

// ── Listening ─────────────────────────────────────────────────────────
export async function getListeningParts(examId: number): Promise<ListeningPart[]> {
  const r = await pool.query<ListeningPart>(
    "SELECT * FROM listening_parts WHERE exam_id = $1 ORDER BY part_number", [examId]
  );
  return r.rows;
}

export async function upsertListeningPart(examId: number, partNumber: number, audioFileId: string): Promise<void> {
  await pool.query(`
    INSERT INTO listening_parts (exam_id, part_number, audio_file_id)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
  `, [examId, partNumber, audioFileId]);
  await pool.query(
    "UPDATE listening_parts SET audio_file_id = $1 WHERE exam_id = $2 AND part_number = $3",
    [audioFileId, examId, partNumber]
  );
}

// ── Reading ───────────────────────────────────────────────────────────
export async function getReadingPassages(examId: number): Promise<ReadingPassage[]> {
  const r = await pool.query<ReadingPassage>(
    "SELECT * FROM reading_passages WHERE exam_id = $1 ORDER BY passage_number", [examId]
  );
  return r.rows;
}

export async function insertReadingPassage(examId: number, passageNumber: number, title: string, text: string): Promise<ReadingPassage> {
  const r = await pool.query<ReadingPassage>(
    "INSERT INTO reading_passages (exam_id, passage_number, title, text) VALUES ($1,$2,$3,$4) RETURNING *",
    [examId, passageNumber, title, text]
  );
  return r.rows[0]!;
}

// ── Questions ─────────────────────────────────────────────────────────
export async function getQuestions(examId: number, section: string, partNumber?: number): Promise<IeltsQuestion[]> {
  let q = "SELECT * FROM ielts_questions WHERE exam_id = $1 AND section = $2";
  const params: unknown[] = [examId, section];
  if (partNumber !== undefined) { q += " AND part_number = $3"; params.push(partNumber); }
  q += " ORDER BY question_number";
  const r = await pool.query<IeltsQuestion>(q, params);
  return r.rows;
}

export async function insertQuestion(
  examId: number, section: string, partNumber: number, questionNumber: number,
  questionText: string, questionType: string, options: string[] | null, correctAnswer: string
): Promise<IeltsQuestion> {
  const r = await pool.query<IeltsQuestion>(`
    INSERT INTO ielts_questions
      (exam_id, section, part_number, question_number, question_text, question_type, options, correct_answer)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [examId, section, partNumber, questionNumber, questionText, questionType,
     options ? JSON.stringify(options) : null, correctAnswer]
  );
  return r.rows[0]!;
}

// ── Writing tasks ─────────────────────────────────────────────────────
export async function getWritingTasks(examId: number): Promise<WritingTask[]> {
  const r = await pool.query<WritingTask>(
    "SELECT * FROM writing_tasks WHERE exam_id = $1 ORDER BY task_number", [examId]
  );
  return r.rows;
}

export async function insertWritingTask(examId: number, taskNumber: number, prompt: string): Promise<WritingTask> {
  const r = await pool.query<WritingTask>(
    "INSERT INTO writing_tasks (exam_id, task_number, prompt) VALUES ($1,$2,$3) RETURNING *",
    [examId, taskNumber, prompt]
  );
  return r.rows[0]!;
}

// ── Speaking questions ────────────────────────────────────────────────
export async function getSpeakingQuestions(examId: number, partNumber?: number): Promise<SpeakingQuestion[]> {
  let q = "SELECT * FROM speaking_questions WHERE exam_id = $1";
  const params: unknown[] = [examId];
  if (partNumber !== undefined) { q += " AND part_number = $2"; params.push(partNumber); }
  q += " ORDER BY part_number, question_number";
  const r = await pool.query<SpeakingQuestion>(q, params);
  return r.rows;
}

export async function insertSpeakingQuestion(
  examId: number, partNumber: number, questionNumber: number, questionText: string
): Promise<SpeakingQuestion> {
  const r = await pool.query<SpeakingQuestion>(
    "INSERT INTO speaking_questions (exam_id, part_number, question_number, question_text) VALUES ($1,$2,$3,$4) RETURNING *",
    [examId, partNumber, questionNumber, questionText]
  );
  return r.rows[0]!;
}

// ── User Exam ─────────────────────────────────────────────────────────
export async function createUserExam(userId: number, examId: number): Promise<UserExam> {
  const r = await pool.query<UserExam>(
    "INSERT INTO user_exams (user_id, exam_id, status) VALUES ($1,$2,'pending_payment') RETURNING *",
    [userId, examId]
  );
  return r.rows[0]!;
}

export async function getUserExam(userId: number): Promise<UserExam | null> {
  const r = await pool.query<UserExam>(
    "SELECT * FROM user_exams WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  return r.rows[0] ?? null;
}

export async function getUserExamById(id: number): Promise<UserExam | null> {
  const r = await pool.query<UserExam>("SELECT * FROM user_exams WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

export async function updateUserExamStatus(
  userExamId: number, status: ExamStatus, deadlineMs?: number
): Promise<void> {
  if (deadlineMs) {
    await pool.query(
      "UPDATE user_exams SET status = $1, section_deadline = $2 WHERE id = $3",
      [status, new Date(deadlineMs), userExamId]
    );
  } else {
    await pool.query("UPDATE user_exams SET status = $1 WHERE id = $2", [status, userExamId]);
  }
}

export async function setPaymentPhoto(userExamId: number, photoId: string): Promise<void> {
  await pool.query(
    "UPDATE user_exams SET payment_photo_id = $1, status = 'payment_pending_approval' WHERE id = $2",
    [photoId, userExamId]
  );
}

export async function getPendingIeltsPayments(): Promise<UserExam[]> {
  const r = await pool.query<UserExam>(
    "SELECT * FROM user_exams WHERE status = 'payment_pending_approval' ORDER BY created_at DESC"
  );
  return r.rows;
}

export async function getAllUserExamsForAdmin(): Promise<{ user_id: number; status: string; created_at: Date }[]> {
  const r = await pool.query(
    "SELECT user_id, status, created_at FROM user_exams ORDER BY created_at DESC LIMIT 50"
  );
  return r.rows;
}

// ── Answers ───────────────────────────────────────────────────────────
export async function saveAnswer(
  userExamId: number, questionId: number, section: string, answer: string, isCorrect: boolean
): Promise<void> {
  await pool.query(
    "INSERT INTO user_answers (user_exam_id, question_id, section, answer, is_correct) VALUES ($1,$2,$3,$4,$5)",
    [userExamId, questionId, section, answer, isCorrect]
  );
}

export async function countCorrectAnswers(userExamId: number, section: string): Promise<number> {
  const r = await pool.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM user_answers WHERE user_exam_id = $1 AND section = $2 AND is_correct = true",
    [userExamId, section]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

// ── Writing ───────────────────────────────────────────────────────────
export async function saveWritingSubmission(
  userExamId: number, taskNumber: number, text: string, score: number, feedback: AiFeedback
): Promise<void> {
  await pool.query(
    "INSERT INTO writing_submissions (user_exam_id, task_number, text, ai_score, ai_feedback) VALUES ($1,$2,$3,$4,$5)",
    [userExamId, taskNumber, text, score, JSON.stringify(feedback)]
  );
}

export async function getWritingSubmissions(userExamId: number): Promise<{ task_number: number; ai_score: number; ai_feedback: AiFeedback }[]> {
  const r = await pool.query(
    "SELECT task_number, ai_score, ai_feedback FROM writing_submissions WHERE user_exam_id = $1 ORDER BY task_number",
    [userExamId]
  );
  return r.rows;
}

// ── Speaking ──────────────────────────────────────────────────────────
export async function saveSpeakingSubmission(
  userExamId: number, partNumber: number, transcript: string, score: number, feedback: SpeakingFeedback
): Promise<void> {
  await pool.query(
    "INSERT INTO speaking_submissions (user_exam_id, part_number, transcript, ai_score, ai_feedback) VALUES ($1,$2,$3,$4,$5)",
    [userExamId, partNumber, transcript, score, JSON.stringify(feedback)]
  );
}

export async function getSpeakingSubmissions(userExamId: number): Promise<{ part_number: number; ai_score: number; ai_feedback: SpeakingFeedback }[]> {
  const r = await pool.query(
    "SELECT part_number, ai_score, ai_feedback FROM speaking_submissions WHERE user_exam_id = $1 ORDER BY part_number",
    [userExamId]
  );
  return r.rows;
}

// ── Scores ────────────────────────────────────────────────────────────
export async function saveScores(
  userExamId: number,
  l: number, r_: number, w: number, s: number, overall: number
): Promise<void> {
  await pool.query(`
    INSERT INTO exam_scores (user_exam_id, listening_score, reading_score, writing_score, speaking_score, overall_score)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (user_exam_id) DO UPDATE
    SET listening_score=$2, reading_score=$3, writing_score=$4, speaking_score=$5, overall_score=$6, calculated_at=NOW()
  `, [userExamId, l, r_, w, s, overall]);
}

export async function getScores(userExamId: number): Promise<ExamScores | null> {
  const r = await pool.query<ExamScores>(
    "SELECT * FROM exam_scores WHERE user_exam_id = $1", [userExamId]
  );
  return r.rows[0] ?? null;
}

export async function getUserExamStats(): Promise<{ total: number; completed: number; paid: number }> {
  const r = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status NOT IN ('pending_payment','payment_pending_approval')) as paid
    FROM user_exams
  `);
  const row = r.rows[0];
  return {
    total: parseInt(row.total, 10),
    completed: parseInt(row.completed, 10),
    paid: parseInt(row.paid, 10),
  };
}
