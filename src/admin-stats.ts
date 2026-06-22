import pg from "pg";
import { getSubscribedUsersCount } from "./subscription.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

export async function getAdminInfoStats(): Promise<string> {
  const [certRow, ieltsRow, genderRows, totalUsersRow] = await Promise.all([
    pool.query<{
      b2_paid: string; c1_paid: string;
      b2_cert: string; c1_cert: string;
    }>(`
      SELECT
        SUM(CASE WHEN ue.level='B2' AND ue.status NOT IN ('pending_payment') THEN 1 ELSE 0 END)::int AS b2_paid,
        SUM(CASE WHEN ue.level='C1' AND ue.status NOT IN ('pending_payment') THEN 1 ELSE 0 END)::int AS c1_paid,
        SUM(CASE WHEN ue.level='B2' AND es.passed=true THEN 1 ELSE 0 END)::int AS b2_cert,
        SUM(CASE WHEN ue.level='C1' AND es.passed=true THEN 1 ELSE 0 END)::int AS c1_cert
      FROM cert_user_exams ue
      LEFT JOIN cert_exam_scores es ON es.user_exam_id = ue.id
    `),

    pool.query<{ paid: string; completed: string; avg_band: string | null }>(`
      SELECT
        COUNT(*)::int                                                             AS paid,
        COUNT(*) FILTER (WHERE ue.status = 'completed')::int                     AS completed,
        ROUND(AVG(es.overall_score)::numeric, 1)::text                           AS avg_band
      FROM user_exams ue
      LEFT JOIN exam_scores es ON es.user_exam_id = ue.id
      WHERE ue.status NOT IN ('pending_payment')
    `),

    pool.query<{ gender: string | null; cnt: string }>(`
      WITH paid_users AS (
        SELECT DISTINCT user_id FROM cert_user_exams WHERE status NOT IN ('pending_payment')
        UNION
        SELECT DISTINCT user_id FROM user_exams WHERE status NOT IN ('pending_payment')
      )
      SELECT
        COALESCE(up.gender, 'unknown') AS gender,
        COUNT(*)::int AS cnt
      FROM paid_users pu
      JOIN user_profiles up ON up.user_id = pu.user_id
      GROUP BY up.gender
    `),

    pool.query<{ cnt: string }>(`SELECT COUNT(*)::int AS cnt FROM user_profiles`),
  ]);

  const c = certRow.rows[0] ?? { b2_paid: "0", c1_paid: "0", b2_cert: "0", c1_cert: "0" };
  const b2Paid  = parseInt(c.b2_paid  ?? "0", 10);
  const c1Paid  = parseInt(c.c1_paid  ?? "0", 10);
  const b2Cert  = parseInt(c.b2_cert  ?? "0", 10);
  const c1Cert  = parseInt(c.c1_cert  ?? "0", 10);

  const ir = ieltsRow.rows[0];
  const ieltsPaid      = parseInt(ir?.paid      ?? "0", 10);
  const ieltsCompleted = parseInt(ir?.completed ?? "0", 10);
  const ieltsAvgBand   = ir?.avg_band ? `${ir.avg_band}` : null;

  const totalUsers = parseInt(totalUsersRow.rows[0]?.cnt ?? "0", 10);

  const genderMap: Record<string, number> = {};
  for (const row of genderRows.rows) {
    const key = (row.gender ?? "unknown").toLowerCase();
    genderMap[key] = (genderMap[key] ?? 0) + parseInt(row.cnt, 10);
  }
  const girls  = genderMap["female"] ?? genderMap["ayol"] ?? genderMap["qiz"] ?? 0;
  const boys   = genderMap["male"]   ?? genderMap["erkak"] ?? genderMap["yigit"] ?? 0;
  const unknownGender = Object.entries(genderMap)
    .filter(([k]) => !["female","ayol","qiz","male","erkak","yigit"].includes(k))
    .reduce((s, [, v]) => s + v, 0);

  const rusCount = getSubscribedUsersCount("russian");
  const engCount = getSubscribedUsersCount("english");
  const turCount = getSubscribedUsersCount("turkish");

  const now = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });

  return (
    `╔═══════════════════════╗\n` +
    `    📊 ADMIN INFO PANEL\n` +
    `╚═══════════════════════╝\n\n` +

    `👥 <b>FOYDALANUVCHILAR:</b>\n` +
    `┗ Jami ro'yxatdan o'tganlar: <b>${totalUsers}</b>\n\n` +

    `🎓 <b>RUS TILI SERTIFIKATI:</b>\n` +
    `┣ B2 — To'lov qilganlar: <b>${b2Paid}</b>\n` +
    `┣ B2 — Sertifikat olganlar: <b>${b2Cert} ✅</b>\n` +
    `┣ C1 — To'lov qilganlar: <b>${c1Paid}</b>\n` +
    `┗ C1 — Sertifikat olganlar: <b>${c1Cert} ✅</b>\n\n` +

    `📝 <b>IELTS MOCK EXAM:</b>\n` +
    `┣ To'lov qilganlar: <b>${ieltsPaid}</b>\n` +
    `┣ Imtihon topshirganlar: <b>${ieltsCompleted}</b>\n` +
    `┗ O'rtacha band score: <b>${ieltsAvgBand ?? "—"}</b>\n` +
    `<i>(IELTS da o'tdi/o'tmadi yo'q — band score beriladi)</i>\n\n` +

    `🗣 <b>3 TIL SUHBAT OBUNASI:</b>\n` +
    `┣ 🇷🇺 Ruscha: <b>${rusCount}</b>\n` +
    `┣ 🇬🇧 Inglizcha: <b>${engCount}</b>\n` +
    `┗ 🇹🇷 Turkcha: <b>${turCount}</b>\n\n` +

    `👤 <b>TO'LOV QILGANLAR JINSI:</b>\n` +
    `┣ 🙍‍♀️ Qizlar: <b>${girls}</b>\n` +
    `┣ 🙍‍♂️ O'g'il bolalar: <b>${boys}</b>\n` +
    `┗ ❓ Noma'lum: <b>${unknownGender}</b>\n` +

    `\n🕐 <i>${now}</i>`
  );
}
