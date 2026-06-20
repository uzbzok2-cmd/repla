import type { Express, Request, Response } from "express";
import { getExamSession, updateExamSession, getBotForExam } from "./webapp.js";
import {
  getAssignedPassages, assignPassages, getQuestionsForPassage,
  getAssignedListeningTexts, assignListeningTexts,
  getAssignedGrammarQuestions, assignGrammarQuestions,
  getWritingPrompts,
  getSpeakingQuestions as getCertSpeakingQs,
  saveCertAnswer, countCertCorrect, countCertTotal,
  saveCertWriting, saveCertSpeaking,
  saveCertScores, updateCertStatus,
  pool as certPool,
} from "./cert/db.js";
import {
  getListeningParts, getReadingPassages, getQuestions,
  getWritingTasks, getSpeakingQuestions as getIeltsSpeakingQs,
  saveAnswer,
  saveWritingSubmission, saveSpeakingSubmission,
  saveScores, updateUserExamStatus,
} from "./ielts/db.js";
import { evaluateRussianWriting, evaluateRussianSpeaking } from "./cert/evaluator.js";
import { evaluateWriting, evaluateSpeaking } from "./ielts/evaluator.js";
import { rawToListeningBand, rawToReadingBand, calcOverall, bandEmoji, bandDescription } from "./ielts/scoring.js";
import type { CertLevel, CertQuestion, CertSpeakingQuestion, AiFeedback as CertAiFeedback, SpeakingFeedback as CertSpeakingFeedback } from "./cert/types.js";
import type { IeltsQuestion, WritingTask, SpeakingQuestion, AiFeedback as IeltsAiFeedback, SpeakingFeedback as IeltsSpeakingFeedback } from "./ielts/types.js";

// ── Option parser ────────────────────────────────────────────────────
type ParsedOption = { letter: string; text: string; raw: string };
const LETTERS = "ABCDEFG";

function parseOpts(raw: string[] | string | null | undefined): ParsedOption[] {
  if (!raw) return [];
  let arr: string[] = [];
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw) as string[]; } catch { arr = raw.split("\n").filter(Boolean); }
  } else if (Array.isArray(raw)) { arr = raw as string[]; }
  return arr.map((o, i) => {
    const s = String(o).trim();
    const m = s.match(/^([A-Ea-e])[.)]\s*(.+)/);
    if (m) return { letter: m[1]!.toUpperCase(), text: m[2]!.trim(), raw: s };
    return { letter: LETTERS[i] ?? String(i + 1), text: s, raw: s };
  });
}

function checkAnswer(userAns: string, correctAns: string, rawOptions?: string[] | string | null): boolean {
  const u = userAns.trim().toUpperCase();
  const c = correctAns.trim().toUpperCase();
  if (u === c) return true;
  const opts = parseOpts(rawOptions);
  if (opts.length > 0) {
    const idx = LETTERS.indexOf(u[0] ?? "");
    if (idx >= 0 && opts[idx]) {
      if (opts[idx].text.toUpperCase() === c || opts[idx].raw.toUpperCase() === c) return true;
    }
    const correctIdx = opts.findIndex(o => o.text.toUpperCase() === c || o.raw.toUpperCase() === c);
    if (correctIdx >= 0) {
      const letter = LETTERS[correctIdx] ?? "";
      if (u === letter) return true;
    }
  }
  return false;
}

function fmtCertQ(q: CertQuestion) {
  return { id: q.id, text: q.question_text, type: q.question_type ?? "multiple_choice", options: q.options };
}
function fmtIeltsQ(q: IeltsQuestion) {
  return { id: q.id, text: q.question_text, type: q.question_type ?? "multiple_choice", options: q.options };
}

// ── GET /api/exam/data ───────────────────────────────────────────────
async function handleGetExamData(req: Request, res: Response): Promise<void> {
  const token = req.query["token"] as string | undefined;
  if (!token) { res.status(400).json({ error: "Token kerak" }); return; }

  const session = getExamSession(token);
  if (!session) { res.status(404).json({ error: "Sessiya topilmadi yoki muddati o'tgan" }); return; }

  try {
    if (session.examType === "cert") {
      const level = (session.level ?? "B2") as CertLevel;
      const ueid  = session.userExamId;

      // Reading
      let passages = await getAssignedPassages(ueid);
      if (!passages.length) passages = await assignPassages(ueid, level);
      const readingPassages = await Promise.all(passages.map(async (p, i) => ({
        passageIndex: i,
        title: p.title || `Matn ${i + 1}`,
        text: p.text || "",
        questions: (await getQuestionsForPassage(p.id)).map(fmtCertQ),
      })));

      // Listening
      let listeningTexts = await getAssignedListeningTexts(ueid);
      if (!listeningTexts.length) listeningTexts = await assignListeningTexts(ueid, level);
      const listeningParts = await Promise.all(listeningTexts.map(async (lt, i) => {
        const r = await certPool.query<CertQuestion>(
          "SELECT * FROM cert_question_bank WHERE level=$1 AND section='listening' AND part_number=$2 ORDER BY id LIMIT 5",
          [level, lt.part_number]
        );
        return {
          passageIndex: i,
          title: `${i + 1}-qism`,
          text: lt.transcript || "",
          questions: r.rows.map(fmtCertQ),
        };
      }));

      // Grammar
      let grammarQs = await getAssignedGrammarQuestions(ueid);
      if (!grammarQs.length) grammarQs = await assignGrammarQuestions(ueid, level);

      // Writing prompt
      const prompts = await getWritingPrompts(level);
      const wp = prompts[Math.floor(Math.random() * prompts.length)];
      if (wp) updateExamSession(token, { writingPromptId: wp.id, writingPromptText: wp.prompt });

      // Speaking
      const spQs = (await Promise.all([1, 2, 3].map(p => getCertSpeakingQs(level, p)))).flat() as CertSpeakingQuestion[];

      res.json({
        examType: "cert", level, userExamId: ueid,
        sections: [
          { id: "reading",   name: "Чтение",     nameUz: "O'qish",     emoji: "📖", durationMinutes: 60, type: "passage_mcq", passages: readingPassages },
          { id: "listening", name: "Аудирование", nameUz: "Tinglash",   emoji: "🎧", durationMinutes: 40, type: "passage_mcq", passages: listeningParts },
          { id: "grammar",   name: "Грамматика",  nameUz: "Grammatika", emoji: "📝", durationMinutes: 45, type: "plain_mcq",   questions: grammarQs.map(fmtCertQ) },
          { id: "writing",   name: "Письмо",      nameUz: "Yozish",     emoji: "✍️", durationMinutes: 60, type: "writing",     promptId: wp?.id, prompt: wp?.prompt ?? "" },
          { id: "speaking",  name: "Говорение",   nameUz: "Gapirish",   emoji: "🗣", durationMinutes: 15, type: "speaking",
            questions: spQs.map(q => ({ id: q.id, partNumber: q.part_number, text: q.question_text })) },
        ],
      });
    } else {
      // IELTS
      const examId = session.examId!;
      const ueid   = session.userExamId;

      const lParts = await getListeningParts(examId);
      const listeningPassages = await Promise.all(lParts.map(async lp => ({
        passageIndex: lp.part_number - 1,
        title: `Part ${lp.part_number}`,
        text: lp.transcript ?? "",
        questions: (await getQuestions(examId, "listening", lp.part_number)).map(fmtIeltsQ),
      })));

      const rPassages = await getReadingPassages(examId);
      const readingPassages = await Promise.all(rPassages.map(async rp => ({
        passageIndex: rp.passage_number - 1,
        title: rp.title || `Passage ${rp.passage_number}`,
        text: rp.text || "",
        questions: (await getQuestions(examId, "reading", rp.passage_number)).map(fmtIeltsQ),
      })));

      const wTasks = await getWritingTasks(examId) as WritingTask[];
      const spQs   = await getIeltsSpeakingQs(examId) as SpeakingQuestion[];

      res.json({
        examType: "ielts", userExamId: ueid, examId,
        sections: [
          { id: "listening", name: "Listening", nameUz: "Tinglash", emoji: "🎧", durationMinutes: 40, type: "passage_mcq",   passages: listeningPassages },
          { id: "reading",   name: "Reading",   nameUz: "O'qish",   emoji: "📖", durationMinutes: 60, type: "passage_mcq",   passages: readingPassages },
          { id: "writing",   name: "Writing",   nameUz: "Yozish",   emoji: "✍️", durationMinutes: 60, type: "writing_tasks",
            tasks: wTasks.map(t => ({ taskNumber: t.task_number, prompt: t.prompt })) },
          { id: "speaking",  name: "Speaking",  nameUz: "Gapirish", emoji: "🗣", durationMinutes: 15, type: "speaking",
            questions: spQs.map(q => ({ id: q.id, partNumber: q.part_number, text: q.question_text })) },
        ],
      });
    }
  } catch (err) {
    console.error("Exam data error:", err);
    res.status(500).json({ error: "Server xatosi. Qayta urinib ko'ring." });
  }
}

// ── POST /api/exam/submit ────────────────────────────────────────────
async function handleSubmitExam(req: Request, res: Response): Promise<void> {
  const { token, mcqAnswers, writingTexts, speakingTexts } = req.body as {
    token: string;
    mcqAnswers: Record<string, string>;
    writingTexts: Record<string, string | Record<string, string>>;
    speakingTexts: Record<string, string>;
  };

  if (!token) { res.status(400).json({ error: "Token kerak" }); return; }
  const session = getExamSession(token);
  if (!session) { res.status(404).json({ error: "Sessiya topilmadi" }); return; }

  const bot = getBotForExam();
  const uid  = session.userId;

  try {
    if (session.examType === "cert") {
      const level = (session.level ?? "B2") as CertLevel;
      const ueid  = session.userExamId;

      // ── Score Reading ────────────────────────────────────────────
      const passages = await getAssignedPassages(ueid);
      for (const p of passages) {
        const qs = await getQuestionsForPassage(p.id);
        for (const q of qs) {
          const ua = mcqAnswers[String(q.id)] ?? "";
          const ok = ua ? checkAnswer(ua, q.correct_answer, q.options) : false;
          await saveCertAnswer(ueid, q.id, "reading", ua, ok);
        }
      }

      // ── Score Listening ──────────────────────────────────────────
      const listeningTexts = await getAssignedListeningTexts(ueid);
      for (const lt of listeningTexts) {
        const r = await certPool.query<CertQuestion>(
          "SELECT * FROM cert_question_bank WHERE level=$1 AND section='listening' AND part_number=$2 ORDER BY id LIMIT 5",
          [level, lt.part_number]
        );
        for (const q of r.rows) {
          const ua = mcqAnswers[String(q.id)] ?? "";
          const ok = ua ? checkAnswer(ua, q.correct_answer, q.options) : false;
          await saveCertAnswer(ueid, q.id, "listening", ua, ok);
        }
      }

      // ── Score Grammar ────────────────────────────────────────────
      const grammarQs = await getAssignedGrammarQuestions(ueid);
      for (const q of grammarQs) {
        const ua = mcqAnswers[String(q.id)] ?? "";
        const ok = ua ? checkAnswer(ua, q.correct_answer, q.options) : false;
        await saveCertAnswer(ueid, q.id, "grammar", ua, ok);
      }

      const rCorrect = await countCertCorrect(ueid, "reading");
      const rTotal   = await countCertTotal(ueid, "reading");
      const lCorrect = await countCertCorrect(ueid, "listening");
      const lTotal   = await countCertTotal(ueid, "listening");
      const gCorrect = await countCertCorrect(ueid, "grammar");
      const gTotal   = await countCertTotal(ueid, "grammar");

      const rScore = rTotal > 0 ? Math.round((rCorrect / rTotal) * 100) : 0;
      const lScore = lTotal > 0 ? Math.round((lCorrect / lTotal) * 100) : 0;
      const gScore = gTotal > 0 ? Math.round((gCorrect / gTotal) * 100) : 0;

      // ── Evaluate Writing ─────────────────────────────────────────
      const writingText = typeof writingTexts["writing"] === "string" ? writingTexts["writing"] : "";
      const promptText  = session.writingPromptText ?? "Fikrlaringizni yozing";
      const promptId    = session.writingPromptId ?? 1;
      let wScore = 55;
      let wDetail = "";
      if (writingText.trim().length > 20) {
        try {
          const wEval = await evaluateRussianWriting(level, promptText, writingText);
          wScore  = Math.round(Number(wEval.band_score) || 55);
          wDetail = String(wEval.detailed_feedback ?? "");
          await saveCertWriting(ueid, promptId, writingText, wScore, wEval);
        } catch { await saveCertWriting(ueid, promptId, writingText, wScore, makeFallbackCertFeedback(wScore)); }
      } else {
        await saveCertWriting(ueid, promptId, writingText || "(yozilmadi)", wScore, makeFallbackCertFeedback(wScore));
      }

      // ── Evaluate Speaking ────────────────────────────────────────
      const spQs = (await Promise.all([1, 2, 3].map(p => getCertSpeakingQs(level, p)))).flat() as CertSpeakingQuestion[];
      let sScore = 60;
      for (const part of [1, 2, 3]) {
        const partQs   = spQs.filter(q => q.part_number === part);
        const partTexts = partQs.map(q => q.question_text);
        const transcript = partQs.map(q => speakingTexts[String(q.id)] ?? "").join("\n\n");
        if (transcript.trim().length > 10) {
          try {
            const spEval = await evaluateRussianSpeaking(level, part, partTexts, transcript);
            const partScore = Math.round(Number(spEval.band_score) || 60);
            await saveCertSpeaking(ueid, part, transcript, partScore, spEval);
            sScore = partScore;
          } catch { await saveCertSpeaking(ueid, part, transcript || "(yozilmadi)", sScore, makeFallbackCertSpeaking(sScore)); }
        } else {
          await saveCertSpeaking(ueid, part, "(yozilmadi)", sScore, makeFallbackCertSpeaking(sScore));
        }
      }

      const overall = Math.round((rScore + lScore + gScore + wScore + sScore) / 5);
      const passed  = overall >= 66;

      await saveCertScores(ueid, rScore, lScore, gScore, wScore, sScore, overall, passed);
      await updateCertStatus(ueid, "completed");

      const msg =
        `🎓 <b>RUS TILI ${level} IMTIHON NATIJASI</b>\n\n` +
        `📖 Чтение:      <b>${rScore}%</b>  (${rCorrect}/${rTotal})\n` +
        `🎧 Аудирование: <b>${lScore}%</b>  (${lCorrect}/${lTotal})\n` +
        `📝 Грамматика:  <b>${gScore}%</b>  (${gCorrect}/${gTotal})\n` +
        `✍️ Письмо:      <b>${wScore}%</b>\n` +
        `🗣 Говорение:   <b>${sScore}%</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 <b>Umumiy ball: ${overall}%</b>\n` +
        (passed ? `✅ <b>Tabriklaymiz! Imtihondan o'tdingiz!</b>` : `❌ <b>O'tish bali yetarli emas (66% kerak)</b>`) +
        (wDetail ? `\n\n💬 <i>${wDetail}</i>` : "");
      bot?.sendMessage(uid, msg, { parse_mode: "HTML" }).catch(() => {});

      res.json({ ok: true, passed, overall,
        scores: { reading: rScore, listening: lScore, grammar: gScore, writing: wScore, speaking: sScore } });

    } else {
      // ── IELTS ────────────────────────────────────────────────────
      const examId = session.examId!;
      const ueid   = session.userExamId;

      // Score Listening
      const lParts = await getListeningParts(examId);
      let lCorrect = 0, lTotal = 0;
      for (const lp of lParts) {
        const qs = await getQuestions(examId, "listening", lp.part_number);
        for (const q of qs) {
          const ua = mcqAnswers[String(q.id)] ?? "";
          const ok = ua ? checkAnswer(ua, q.correct_answer, q.options) : false;
          await saveAnswer(ueid, q.id, "listening", ua, ok);
          if (ok) lCorrect++; lTotal++;
        }
      }

      // Score Reading
      const rPassages = await getReadingPassages(examId);
      let rCorrect = 0, rTotal = 0;
      for (const rp of rPassages) {
        const qs = await getQuestions(examId, "reading", rp.passage_number);
        for (const q of qs) {
          const ua = mcqAnswers[String(q.id)] ?? "";
          const ok = ua ? checkAnswer(ua, q.correct_answer, q.options) : false;
          await saveAnswer(ueid, q.id, "reading", ua, ok);
          if (ok) rCorrect++; rTotal++;
        }
      }

      const lBand = rawToListeningBand(lCorrect);
      const rBand = rawToReadingBand(rCorrect);

      // Evaluate Writing
      const wTasks = await getWritingTasks(examId) as WritingTask[];
      const writingTaskTexts = (writingTexts["writing"] ?? {}) as Record<string, string>;
      let wBand = 5.5;
      let wDetail = "";
      for (const t of wTasks) {
        const tText = writingTaskTexts[`task${t.task_number}`] ?? "";
        if (tText.trim().length > 20) {
          try {
            const wEval = await evaluateWriting(t.task_number, t.prompt, tText);
            wBand   = Number(wEval.band_score) || 5.5;
            wDetail = String(wEval.detailed_feedback ?? "");
            await saveWritingSubmission(ueid, t.task_number, tText, wBand, wEval as unknown as IeltsAiFeedback);
          } catch { await saveWritingSubmission(ueid, t.task_number, tText, 5.5, makeFallbackIeltsFeedback()); }
        } else {
          await saveWritingSubmission(ueid, t.task_number, tText || "(yozilmadi)", 5.5, makeFallbackIeltsFeedback());
        }
      }

      // Evaluate Speaking
      const spQs = await getIeltsSpeakingQs(examId) as SpeakingQuestion[];
      let sBand = 5.5;
      for (const part of [1, 2, 3]) {
        const partQs   = spQs.filter(q => q.part_number === part);
        const partTexts = partQs.map(q => q.question_text);
        const transcript = partQs.map(q => speakingTexts[String(q.id)] ?? "").join("\n\n");
        if (transcript.trim().length > 10) {
          try {
            const spEval = await evaluateSpeaking(part, partTexts, transcript);
            sBand = Number((spEval as unknown as Record<string, unknown>)["band_score"]) || 5.5;
            await saveSpeakingSubmission(ueid, part, transcript, sBand, spEval as unknown as IeltsSpeakingFeedback);
          } catch { await saveSpeakingSubmission(ueid, part, transcript || "(yozilmadi)", 5.5, makeFallbackIeltsSpeaking()); }
        } else {
          await saveSpeakingSubmission(ueid, part, "(yozilmadi)", 5.5, makeFallbackIeltsSpeaking());
        }
      }

      const overall = calcOverall(lBand, rBand, wBand, sBand);
      await saveScores(ueid, lBand, rBand, wBand, sBand, overall);
      await updateUserExamStatus(ueid, "completed");

      const emoji = bandEmoji(overall);
      const desc  = bandDescription(overall);
      const msg =
        `${emoji} <b>IELTS IMTIHON NATIJASI</b>\n\n` +
        `🎧 Listening: <b>${lBand.toFixed(1)}</b> (${lCorrect}/${lTotal})\n` +
        `📖 Reading:   <b>${rBand.toFixed(1)}</b> (${rCorrect}/${rTotal})\n` +
        `✍️ Writing:   <b>${wBand.toFixed(1)}</b>\n` +
        `🗣 Speaking:  <b>${sBand.toFixed(1)}</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 <b>Overall Band: ${overall.toFixed(1)}</b>\n` +
        `🏷 <i>${desc}</i>` +
        (wDetail ? `\n\n💬 <i>${wDetail}</i>` : "");
      bot?.sendMessage(uid, msg, { parse_mode: "HTML" }).catch(() => {});

      res.json({ ok: true, overall,
        scores: { listening_score: lBand, reading_score: rBand, writing_score: wBand, speaking_score: sBand } });
    }
  } catch (err) {
    console.error("Exam submit error:", err);
    res.status(500).json({ error: "Yuborishda xatolik. Qayta urinib ko'ring." });
  }
}

// ── Fallback feedback constructors ───────────────────────────────────
function makeFallbackCertFeedback(score: number): CertAiFeedback {
  return { band_score: score, task_achievement: score, coherence_cohesion: score,
    lexical_resource: score, grammatical_range: score,
    strengths: ["Urinish qilindi"], weaknesses: ["Yaxshilanish kerak"],
    detailed_feedback: "Javob qisqa bo'lgani uchun ball taxminiy hisoblandi." };
}
function makeFallbackCertSpeaking(score: number): CertSpeakingFeedback {
  return { band_score: score, fluency_coherence: score, pronunciation: score,
    lexical_resource: score, grammatical_range: score,
    strengths: ["Urinish qilindi"], weaknesses: ["Yaxshilanish kerak"],
    detailed_feedback: "Javob topshirilmadi." };
}
function makeFallbackIeltsFeedback(): IeltsAiFeedback {
  return { band_score: 5.5, task_achievement: 5.5, coherence_cohesion: 5.5,
    lexical_resource: 5.5, grammatical_range: 5.5,
    strengths: ["Attempted"], weaknesses: ["Needs improvement"],
    detailed_feedback: "Answer not submitted. Default score assigned." };
}
function makeFallbackIeltsSpeaking(): IeltsSpeakingFeedback {
  return { band_score: 5.5, fluency_coherence: 5.5, pronunciation: 5.5,
    lexical_resource: 5.5, grammatical_range: 5.5,
    strengths: ["Attempted"], weaknesses: ["Needs improvement"],
    detailed_feedback: "Answer not submitted. Default score assigned." };
}

// ── Register routes ──────────────────────────────────────────────────
export function setupExamRoutes(app: Express): void {
  app.get("/exam", (_req, res) => { res.sendFile("exam.html", { root: "public" }); });
  app.get("/api/exam/data", handleGetExamData);
  app.post("/api/exam/submit", handleSubmitExam);
}
