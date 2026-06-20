export type IeltsSection = "listening" | "reading" | "writing" | "speaking";
export type ExamStatus =
  | "pending_payment"
  | "payment_pending_approval"
  | "paid"
  | "listening"
  | "reading"
  | "writing"
  | "speaking"
  | "completed"
  | "expired";

export type QuestionType =
  | "multiple_choice"
  | "true_false_ng"
  | "fill_blank"
  | "matching"
  | "short_answer";

export interface IeltsExam {
  id: number;
  title: string;
  is_active: boolean;
  created_at: Date;
}

export interface ListeningPart {
  id: number;
  exam_id: number;
  part_number: number;
  audio_file_id: string | null;
  transcript: string | null;
  duration_seconds: number;
}

export interface ReadingPassage {
  id: number;
  exam_id: number;
  passage_number: number;
  title: string;
  text: string;
}

export interface IeltsQuestion {
  id: number;
  exam_id: number;
  section: IeltsSection;
  part_number: number;
  question_number: number;
  question_text: string;
  question_type: QuestionType;
  options: string[] | null;
  correct_answer: string;
  marks: number;
}

export interface WritingTask {
  id: number;
  exam_id: number;
  task_number: number;
  prompt: string;
  image_file_id: string | null;
}

export interface SpeakingQuestion {
  id: number;
  exam_id: number;
  part_number: number;
  question_number: number;
  question_text: string;
  audio_file_id: string | null;
}

export interface UserExam {
  id: number;
  user_id: number;
  exam_id: number;
  status: ExamStatus;
  payment_photo_id: string | null;
  section_deadline: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface ExamScores {
  id: number;
  user_exam_id: number;
  listening_score: number | null;
  reading_score: number | null;
  writing_score: number | null;
  speaking_score: number | null;
  overall_score: number | null;
  calculated_at: Date;
}

export interface AiFeedback {
  task_achievement?: number;
  coherence_cohesion?: number;
  lexical_resource?: number;
  grammatical_range?: number;
  band_score: number;
  strengths: string[];
  weaknesses: string[];
  detailed_feedback: string;
}

export interface SpeakingFeedback {
  fluency_coherence?: number;
  pronunciation?: number;
  lexical_resource?: number;
  grammatical_range?: number;
  band_score: number;
  strengths: string[];
  weaknesses: string[];
  detailed_feedback: string;
}

// In-memory session state during exam
export interface IeltsSessionState {
  userExamId: number;
  examId: number;
  section: IeltsSection;
  partNumber: number;
  questionIndex: number;
  pendingAnswers: Record<number, string>; // questionId -> answer
  sectionDeadlineMs: number;
  writingTaskNumber?: 1 | 2;
  speakingCollecting?: boolean;
  awaitingPayment?: boolean;
}
