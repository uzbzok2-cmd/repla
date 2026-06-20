---
name: Russian B2/C1 Cert Exam Module
description: CEFR certificate exam module architecture, flow, and key decisions
---

## Architecture

- `src/registration.ts` — User profile DB (user_profiles table), in-memory reg state machine
- `src/cert/types.ts` — All TypeScript interfaces for cert exams
- `src/cert/db.ts` — PostgreSQL schema (11 tables) + all queries including random assignment
- `src/cert/state.ts` — In-memory session state (exam session, payment pending, ready-to-start, timers)
- `src/cert/evaluator.ts` — Groq llama-3.3-70b for writing/speaking AI evaluation (Russian)
- `src/cert/certificate.ts` — Text-format certificate generator
- `src/cert/seed.ts` — Question banks: 4 B2 passages + 4 C1 passages, 45 B2 + 30 C1 grammar Qs, 6 B2 + 4 C1 listening texts, 4+4 writing prompts, speaking questions
- `src/cert/handlers.ts` — All bot handlers for the cert module, exported `routeCertMessage` for main router

## Key Decisions

- Payment: 28,000 sum, card 9860 3501 4197 4070; admin username: drector_uz
- Pass threshold: B2 ≥ 60%, C1 ≥ 70% overall
- Sections order: reading (60min) → listening (40min) → grammar (45min) → writing (60min) → speaking (15min)
- Unique questions per user: randomly assigned at exam start, stored in cert_exam_assigned_* tables
- Listening is text-based (transcripts shown); admin can upload audio via updateListeningAudio()
- Grammar answers: user sends all 30 answers in one message, format "1. A\n2. B..."
- Reading: 3 passages shown sequentially, user sends answers per passage
- Writing: AI evaluation via Groq, min 150 words (B2) / 220 words (C1)
- Speaking: voice messages transcribed via Groq whisper-large-v3, then AI evaluated
- Certificate: generated as formatted Telegram HTML text (no image PDF needed)

**Why:** Text-format certificate avoids complex image generation dependencies while remaining readable and shareable.

## Registration Flow

1. /start → check user_profiles table
2. If not registered: ask_name → ask_age → ask_gender (inline keyboard) → ask_phone (request_contact button)
3. All registration state in-memory (regStates Map in registration.ts)
4. Phone captured via Telegram contact share (bot.on("contact"))
5. After registration: show main keyboard

## Admin Commands (cert)

- `/cert_admin` — stats + pending payments
- `/cert_pending` — list pending payments
- `/cert_confirm_{userId}_{level}` — approve payment
- `/cert_reject_{userId}_{level}` — reject payment
