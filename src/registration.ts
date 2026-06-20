import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

export interface UserProfile {
  user_id: number;
  full_name: string;
  phone_number: string | null;
  age: number | null;
  gender: string | null;
  registered_at: Date;
}

export type RegStep =
  | { step: "idle" }
  | { step: "asking_name" }
  | { step: "asking_age"; fullName: string }
  | { step: "asking_gender"; fullName: string; age: number }
  | { step: "asking_phone"; fullName: string; age: number; gender: string };

const regStates = new Map<number, RegStep>();

export function getRegStep(userId: number): RegStep {
  return regStates.get(userId) ?? { step: "idle" };
}
export function setRegStep(userId: number, step: RegStep): void {
  regStates.set(userId, step);
}
export function clearRegStep(userId: number): void {
  regStates.set(userId, { step: "idle" });
}

export async function initProfileSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id BIGINT PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL DEFAULT '',
      phone_number VARCHAR(50),
      age INT,
      gender VARCHAR(20),
      registered_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bot_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export async function dbSaveAdminChatId(chatId: number): Promise<void> {
  await pool.query(`
    INSERT INTO bot_settings (key, value)
    VALUES ('admin_chat_id', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, [String(chatId)]);
}

export async function dbLoadAdminChatId(): Promise<number | null> {
  const r = await pool.query<{ value: string }>(
    "SELECT value FROM bot_settings WHERE key = 'admin_chat_id'"
  );
  const row = r.rows[0];
  if (!row) return null;
  const id = parseInt(row.value, 10);
  return isNaN(id) ? null : id;
}

export async function getProfile(userId: number): Promise<UserProfile | null> {
  const r = await pool.query<UserProfile>(
    "SELECT * FROM user_profiles WHERE user_id = $1",
    [userId]
  );
  return r.rows[0] ?? null;
}

export async function upsertProfile(
  userId: number,
  fullName: string,
  phone: string | null,
  age: number | null,
  gender: string | null
): Promise<void> {
  await pool.query(`
    INSERT INTO user_profiles (user_id, full_name, phone_number, age, gender)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        phone_number = COALESCE(EXCLUDED.phone_number, user_profiles.phone_number),
        age = COALESCE(EXCLUDED.age, user_profiles.age),
        gender = COALESCE(EXCLUDED.gender, user_profiles.gender),
        last_seen = NOW()
  `, [userId, fullName, phone, age, gender]);
}

export async function updateProfilePhone(userId: number, phone: string): Promise<void> {
  await pool.query(
    "UPDATE user_profiles SET phone_number = $1 WHERE user_id = $2",
    [phone, userId]
  );
}

export async function touchLastSeen(userId: number): Promise<void> {
  await pool.query(
    "UPDATE user_profiles SET last_seen = NOW() WHERE user_id = $1",
    [userId]
  );
}

export async function isRegistered(userId: number): Promise<boolean> {
  const p = await getProfile(userId);
  return !!(p && p.full_name && p.phone_number && p.age && p.gender);
}

export async function getAllProfiles(): Promise<UserProfile[]> {
  const r = await pool.query<UserProfile>(
    "SELECT * FROM user_profiles ORDER BY registered_at DESC LIMIT 200"
  );
  return r.rows;
}
