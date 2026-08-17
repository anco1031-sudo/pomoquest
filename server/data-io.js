// server/data-io.js — export/import ข้อมูลเกม (ใช้ร่วมกันระหว่าง API routes และ CLI backup)
// ตารางที่ export/import ได้ (item เป็น data สถิตจากโค้ด — ไม่ export)
export const WRITABLE_TABLES = ['character', 'progress', 'inventory', 'log', 'achievement_unlock', 'daily_counter', 'daily_quest_done', 'daily_streak', 'camp_shop', 'camp_quest_done', 'character_skill', 'settings'];

// เวอร์ชันของ schema/ฟอร์แมต export — ถ้าเปลี่ยนโครงสร้างตาราง/คอลัมน์ที่กระทบ import ให้ +1
export const SCHEMA_VERSION = 1;

// คอลัมน์บังคับของตาราง log (ใช้เช็คเวอร์ชัน .db เก่า)
export const REQUIRED_LOG_COLUMNS = ['hp_change', 'mp_change', 'session_key', 'city'];

// ดึงข้อมูลทุกตารางเป็น object (พร้อม header สำหรับเช็คเวอร์ชันตอน import)
export function exportJsonData(db) {
  const data = { app: 'pomoquest', version: SCHEMA_VERSION, exported_at: new Date().toISOString() };
  for (const t of WRITABLE_TABLES) data[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return data;
}

// เขียนข้อมูล JSON ลงตาราง — ตรวจ format + เวอร์ชันก่อน แล้วเขียนใน transaction (มีผลทันที)
// โยน Error พร้อมข้อความที่ user เข้าใจได้ถ้าไฟล์ไม่ถูกต้อง
export function restoreFromJson(db, data) {
  if (!data || typeof data !== 'object' || data.app !== 'pomoquest') {
    throw new Error('ไฟล์ไม่ใช่ export ของ PomoQuest (.json.gz)');
  }
  if (data.version !== SCHEMA_VERSION) {
    throw new Error(`เวอร์ชัน schema ไม่ตรงกัน — ไฟล์นี้ v${data.version ?? '?'} แต่เกมปัจจุบันเป็น v${SCHEMA_VERSION} (อัปเดตเกมแล้วลองใหม่)`);
  }
  if (!Array.isArray(data.character) || !Array.isArray(data.settings)) {
    throw new Error('ไฟล์ .json.gz ไม่สมบูรณ์ (ข้อมูลตารางไม่ครบ)');
  }
  db.transaction(() => {
    for (const t of WRITABLE_TABLES) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare('DELETE FROM sqlite_sequence').run();
    for (const t of WRITABLE_TABLES) {
      const rows = Array.isArray(data[t]) ? data[t] : [];
      if (!rows.length) continue;
      // กรองคอลัมน์ตาม schema จริง (กัน SQL injection ผ่านชื่อคอลัมน์จากไฟล์)
      const realCols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      const cols = Object.keys(rows[0]).filter((c) => realCols.includes(c));
      if (!cols.length) continue;
      const ins = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) ins.run(cols.map((c) => r[c]));
    }
  })();
}

// เช็คว่าไฟล์ .db เป็น schema ของ PomoQuest ตรงตามเวอร์ชันปัจจุบัน (ดูคอลัมน์บังคับในตาราง log)
// คืน null = ผ่าน, หรือข้อความ error ที่ user เข้าใจได้
// (เปิด readonly ไม่ error กับไฟล์ขยะ — พอ query ถึง throw เลยต้องจับเอง)
export function checkDbSchema(testDb) {
  let tables;
  try {
    tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  } catch {
    return 'ไฟล์ไม่ใช่ฐานข้อมูล SQLite';
  }
  const need = ['character', 'item', 'log', 'progress', 'settings'];
  if (!need.every((t) => tables.includes(t))) return 'ไม่ใช่ฐานข้อมูล PomoQuest';
  const logCols = testDb.prepare('PRAGMA table_info(log)').all().map((c) => c.name);
  const missing = REQUIRED_LOG_COLUMNS.filter((c) => !logCols.includes(c));
  if (missing.length) return `ฐานข้อมูลเป็นเวอร์ชันเก่า (ตาราง log ไม่มีคอลัมน์: ${missing.join(', ')}) — อัปเดตเกมแล้ว export ใหม่`;
  return null;
}
