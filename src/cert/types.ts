export type CertLevel = "B2" | "C1";
export type CertSection = "reading" | "listening" | "grammar" | "writing" | "speaking";
export type CertStatus =
  | "pending_payment"
  | "payment_pending_approval"
  | "paid"
  | "ready"
  | "reading"
  | "listening"
  | "grammar"
  | "writing"
  | "speaking"
  | "completed"
  | "expired";

export interface CertUserExam {
  id: number;
  user_id: number;
  level: CertLevel;
  status: CertStatus;
  payment_photo_id: string | null;
  phone_number: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface CertPassage {
  id: number;
  level: CertLevel;
  title: string;
  text: string;
}

export interface CertQuestion {
  id: number;
  level: CertLevel;
  section: CertSection;
  passage_id: number | null;
  part_number: number;
  question_text: string;
  question_type: string;
  options: string[] | null;
  correct_answer: string;
}

export interface CertListeningText {
  id: number;
  level: CertLevel;
  part_number: number;
  transcript: string;
  audio_file_id: string | null;
}

export interface CertWritingPrompt {
  id: number;
  level: CertLevel;
  prompt: string;
}

export interface CertSpeakingQuestion {
  id: number;
  level: CertLevel;
  part_number: number;
  question_number: number;
  question_text: string;
}

export interface CertExamScores {
  id: number;
  user_exam_id: number;
  reading_score: number | null;
  listening_score: number | null;
  grammar_score: number | null;
  writing_score: number | null;
  speaking_score: number | null;
  overall_score: number | null;
  passed: boolean | null;
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

export interface CertSessionState {
  userExamId: number;
  level: CertLevel;
  section: CertSection;
  sectionDeadlineMs: number;
  assignedPassageIds: number[];
  currentPassageIndex: number;
  assignedQuestionIds: number[];
  assignedListeningPartId: number | null;
  currentListeningPart: number;
  writingPromptId: number | null;
  writingPromptText: string;
  speakingPartNumber: number;
  speakingCollecting: boolean;
}
