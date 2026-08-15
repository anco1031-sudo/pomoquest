import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, ITEM_BY_ID } from './data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// รองรับการทดสอบด้วย DB แยก (POMOQUEST_DB=/path/to.db)
export const DB_PATH = process.env.POMOQUEST_DB || path.join(dataDir, 'pomoquest.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS character (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  gold INTEGER DEFAULT 50,
  hp INTEGER DEFAULT 100,
  max_hp INTEGER DEFAULT 100,
  mp INTEGER DEFAULT 20,
  max_mp INTEGER DEFAULT 20,
  atk INTEGER DEFAULT 10,
  def INTEGER DEFAULT 5,
  spd INTEGER DEFAULT 8,
  crit REAL DEFAULT 5,
  stat_points INTEGER DEFAULT 0,
  weapon_id INTEGER,
  offhand_id INTEGER,
  head_id INTEGER,
  armor_id INTEGER,
  arms_id INTEGER,
  legs_id INTEGER,
  feet_id INTEGER,
  accessory_id INTEGER,
  accessory_2_id INTEGER,
  accessory_3_id INTEGER,
  accessory_4_id INTEGER,
  city_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  type TEXT NOT NULL,
  desc TEXT,
  hp_bonus INTEGER DEFAULT 0,
  mp_bonus INTEGER DEFAULT 0,
  atk_bonus INTEGER DEFAULT 0,
  def_bonus INTEGER DEFAULT 0,
  spd_bonus INTEGER DEFAULT 0,
  crit_bonus REAL DEFAULT 0,
  heal_pct REAL DEFAULT 0,
  mana_pct REAL DEFAULT 0,
  use_xp INTEGER DEFAULT 0,
  use_gold INTEGER DEFAULT 0,
  price INTEGER DEFAULT 0,
  lvl INTEGER DEFAULT 1,
  handed INTEGER DEFAULT 1,
  exclusive INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  qty INTEGER DEFAULT 1,
  UNIQUE(character_id, item_id)
);

CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL UNIQUE,
  sessions_completed INTEGER DEFAULT 0,
  cycles_completed INTEGER DEFAULT 0,
  total_focus_sec INTEGER DEFAULT 0,
  monsters_slain INTEGER DEFAULT 0,
  treasures_found INTEGER DEFAULT 0,
  bosses_defeated INTEGER DEFAULT 0,
  gold_earned INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  work_min INTEGER DEFAULT 25,
  short_break_min INTEGER DEFAULT 5,
  long_break_min INTEGER DEFAULT 15,
  sessions_per_cycle INTEGER DEFAULT 4,
  event_every_sec INTEGER DEFAULT 90
);

CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  type TEXT,
  title TEXT,
  detail TEXT,
  xp INTEGER DEFAULT 0,
  gold INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS achievement_unlock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT DEFAULT (datetime('now')),
  UNIQUE(character_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS daily_counter (
  character_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  key TEXT NOT NULL,
  value INTEGER DEFAULT 0,
  PRIMARY KEY (character_id, date, key)
);

CREATE TABLE IF NOT EXISTS daily_quest_done (
  character_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  claimed_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (character_id, date, quest_id)
);

CREATE TABLE IF NOT EXISTS daily_streak (
  character_id INTEGER PRIMARY KEY,
  streak INTEGER DEFAULT 0,
  last_date TEXT
);

CREATE TABLE IF NOT EXISTS camp_shop (
  character_id INTEGER NOT NULL,
  visit TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  qty INTEGER DEFAULT 0,
  PRIMARY KEY (character_id, visit, item_id)
);

CREATE TABLE IF NOT EXISTS character_skill (
  character_id INTEGER NOT NULL,
  skill_id TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  source TEXT DEFAULT 'class',
  PRIMARY KEY (character_id, skill_id)
);
`);

// migration: เติมคอลัมน์ใหม่ถ้ายังไม่มี (กัน DB เก่าใช้งานไม่ได้)
function ensureColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
ensureColumn('progress', 'quests_completed', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'daily_streak', 'INTEGER DEFAULT 0');
// จำนวนครั้งที่ซื้อของจากตลาดมืด (ตรา "สายค้าตลาดมืด")
ensureColumn('progress', 'bm_buys', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'last_focus_date', 'TEXT');
ensureColumn('progress', 'boss_potions', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'shrines', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'traps', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'merchant_gifts', 'INTEGER DEFAULT 0');
// สถิติการพักเบรก (พักนานแค่ไหน / เลยเวลา / ต่อเวลากี่ครั้ง)
ensureColumn('progress', 'break_sec', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'break_overrun_sec', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'break_extended', 'INTEGER DEFAULT 0');
// ขายของให้พ่อค้าที่ต้องการ (achievement สายพ่อค้า)
ensureColumn('progress', 'wanted_sales', 'INTEGER DEFAULT 0');
// รอบเมืองที่จบในแต่ละโหมดท้าทาย (ตราเฉพาะโหมด — นับตอนชนะบอส)
ensureColumn('progress', 'hard_cycles', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'marathon_cycles', 'INTEGER DEFAULT 0');
ensureColumn('progress', 'survival_cycles', 'INTEGER DEFAULT 0');
ensureColumn('settings', 'active_character_id', 'INTEGER');
ensureColumn('log', 'focus_sec', 'INTEGER DEFAULT 0');
ensureColumn('log', 'break_sec', 'INTEGER DEFAULT 0');
ensureColumn('log', 'break_overrun_sec', 'INTEGER DEFAULT 0');
// พลังที่เปลี่ยนจากเหตุการณ์ระหว่าง session (ดูย้อนหลังได้ในบันทึกการผจญภัย)
ensureColumn('log', 'hp_change', 'INTEGER DEFAULT 0');
ensureColumn('log', 'mp_change', 'INTEGER DEFAULT 0');
// session_key = id ของ session (client สร้างตอนเริ่ม session) — ใช้จับกลุ่มเหตุการณ์เป็น session เดียวกันในหน้าประวัติ
ensureColumn('log', 'session_key', 'TEXT');
// เมืองที่ผจญภัยใน session (สำหรับหน้า session summary) — ใช้กรองเมืองในหน้าประวัติ session
ensureColumn('log', 'city', 'TEXT');
ensureColumn('daily_quest_done', 'reward', 'TEXT');
// ตลาดมืด (black market) — สินค้าที่ขายในค่ายพักนี้ ระบุแหล่งที่มา ('camp' = ร้านปกติ, 'black' = ตลาดมืด)
ensureColumn('camp_shop', 'market', "TEXT DEFAULT 'camp'");
// โหมดท้าทาย ('' = ปกติ, 'hard' = โหด, 'marathon' = มาราธอน, 'survival' = เอาชีวิตรอด)
ensureColumn('character', 'challenge_mode', "TEXT DEFAULT ''");
// ช่องสวมใส่ใหม่ (ระบบ RPG — กัน DB เก่าใช้งานได้)
ensureColumn('character', 'offhand_id', 'INTEGER');
ensureColumn('character', 'head_id', 'INTEGER');
ensureColumn('character', 'arms_id', 'INTEGER');
ensureColumn('character', 'legs_id', 'INTEGER');
ensureColumn('character', 'feet_id', 'INTEGER');
ensureColumn('character', 'accessory_2_id', 'INTEGER');
ensureColumn('character', 'accessory_3_id', 'INTEGER');
ensureColumn('character', 'accessory_4_id', 'INTEGER');

// seed items — ต้อง ensureColumn item ให้ครบก่อน db.prepare() เพราะ SQLite เช็คคอลัมน์ตอนคอมไพล์
// (ถ้าเตรียม statement ก่อนเพิ่มคอลัมน์ จะพังตอนเปิด DB เก่า: table item has no column named ...)
ensureColumn('item', 'exclusive', 'INTEGER DEFAULT 0');
ensureColumn('item', 'use_xp', 'INTEGER DEFAULT 0');
ensureColumn('item', 'use_gold', 'INTEGER DEFAULT 0');
ensureColumn('item', 'handed', 'INTEGER DEFAULT 1');
ensureColumn('item', 'learn_skill', 'TEXT');

const insertItem = db.prepare(`INSERT OR IGNORE INTO item (id, name, icon, type, desc, hp_bonus, mp_bonus, atk_bonus, def_bonus, spd_bonus, crit_bonus, heal_pct, mana_pct, use_xp, use_gold, price, lvl, handed, exclusive, learn_skill)
  VALUES (@id, @name, @icon, @type, @desc, @hp_bonus, @mp_bonus, @atk_bonus, @def_bonus, @spd_bonus, @crit_bonus, @heal_pct, @mana_pct, @use_xp, @use_gold, @price, @lvl, @handed, @exclusive, @learn_skill)`);
const seedItems = db.transaction(() => {
  for (const i of ITEMS) {
    insertItem.run({
      id: i.id, name: i.name, icon: i.icon, type: i.type, desc: i.desc,
      hp_bonus: i.hp_bonus || 0, mp_bonus: i.mp_bonus || 0,
      atk_bonus: i.atk_bonus || 0, def_bonus: i.def_bonus || 0,
      spd_bonus: i.spd_bonus || 0, crit_bonus: i.crit_bonus || 0,
      heal_pct: i.heal_pct || 0, mana_pct: i.mana_pct || 0,
      use_xp: i.use_xp || 0, use_gold: i.use_gold || 0,
      price: i.price || 0, lvl: i.lvl || 1, handed: i.handed || 1, exclusive: i.exclusive ? 1 : 0,
      learn_skill: i.learn_skill || null,
    });
  }
});
seedItems();
// กัน DB เก่า: อัปเดต handed ของอาวุธสองมือที่ seed ไปแล้ว (INSERT OR IGNORE ไม่ทับของเดิม)
for (const i of ITEMS) {
  if (i.handed === 2) db.prepare('UPDATE item SET handed = 2 WHERE id = ?').run(i.id);
}

// seed settings
db.prepare(`INSERT OR IGNORE INTO settings (id, work_min, short_break_min, long_break_min, sessions_per_cycle, event_every_sec)
  VALUES (1, 25, 5, 15, 4, 90)`).run();

// ----- helpers -----
export const getActiveCharacterId = () =>
  db.prepare('SELECT active_character_id FROM settings WHERE id = 1').get().active_character_id;

export const setActiveCharacter = (id) =>
  db.prepare('UPDATE settings SET active_character_id = ? WHERE id = 1').run(id);

export const getCharacter = () => {
  const activeId = getActiveCharacterId();
  let c = activeId ? db.prepare('SELECT * FROM character WHERE id = ?').get(activeId) : null;
  if (!c) {
    // ถ้ายังไม่เคยตั้ง active (DB เก่า) ใช้ตัวแรกแล้วตั้งให้
    c = db.prepare('SELECT * FROM character ORDER BY id LIMIT 1').get() || null;
    if (c) setActiveCharacter(c.id);
  }
  return c;
};

export const getCharacters = () =>
  db.prepare('SELECT id, name, class, level, xp, gold, city_index, created_at FROM character ORDER BY id').all();

// ----- ตัวนับรายวัน (สำหรับ Daily Quest) -----
export const today = () => db.prepare("SELECT date('now','localtime') AS d").get().d;

export const bumpDaily = (charId, key, amount = 1) => {
  const d = today();
  db.prepare(`INSERT INTO daily_counter (character_id, date, key, value) VALUES (?, ?, ?, ?)
    ON CONFLICT(character_id, date, key) DO UPDATE SET value = value + excluded.value`).run(charId, d, key, amount);
};

export const getDailyCounters = (charId, date) => {
  const rows = db.prepare('SELECT key, value FROM daily_counter WHERE character_id = ? AND date = ?').all(charId, date);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

export const deleteCharacter = (id) => {
  db.prepare('DELETE FROM inventory WHERE character_id = ?').run(id);
  db.prepare('DELETE FROM progress WHERE character_id = ?').run(id);
  db.prepare('DELETE FROM log WHERE character_id = ?').run(id);
  db.prepare('DELETE FROM achievement_unlock WHERE character_id = ?').run(id);
  db.prepare('DELETE FROM character_skill WHERE character_id = ?').run(id);
  db.prepare('DELETE FROM character WHERE id = ?').run(id);
};

export const getProgress = (charId) =>
  db.prepare('SELECT * FROM progress WHERE character_id = ?').get(charId) ||
  db.prepare('INSERT INTO progress (character_id) VALUES (?)').run(charId) && db.prepare('SELECT * FROM progress WHERE character_id = ?').get(charId);

export const getSettings = () => db.prepare('SELECT * FROM settings WHERE id = 1').get();

export const getInventory = (charId) => db.prepare(`
  SELECT inv.item_id, inv.qty, item.name, item.icon, item.type, item.price, item.heal_pct, item.mana_pct,
         item.hp_bonus, item.mp_bonus, item.atk_bonus, item.def_bonus, item.spd_bonus, item.crit_bonus, item.desc,
         item.use_xp, item.use_gold, item.exclusive, item.handed, item.learn_skill
  FROM inventory inv JOIN item ON item.id = inv.item_id
  WHERE inv.character_id = ? AND inv.qty > 0
  ORDER BY item.type, item.id`).all(charId).map((r) => {
  // ข้อมูล static ในโค้ด (lvl / ข้อจำกัดการสวม) — merge ให้ client ใช้เช็คได้
  const def = ITEM_BY_ID[r.item_id] || {};
  return { ...r, lvl: def.lvl || 1, classReq: def.classReq, statReq: def.statReq };
});

export const getLog = (charId, limit = 30) =>
  db.prepare('SELECT * FROM log WHERE character_id = ? ORDER BY id DESC LIMIT ?').all(charId, limit);

export function addLog(charId, { type, title, detail, xp = 0, gold = 0, focusSec = 0, breakSec = 0, overrunSec = 0, hpChange = 0, mpChange = 0, sessionKey = null, city = null }) {
  // เก็บเวลาตาม timezone เครื่อง (สำหรับหน้า Stats และ streak รายวัน) — คืน id เพื่อใช้เป็นตัวอ้างอิง "หลัง log นี้"
  return db.prepare("INSERT INTO log (character_id, type, title, detail, xp, gold, focus_sec, break_sec, break_overrun_sec, hp_change, mp_change, session_key, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))")
    .run(charId, type, title, detail, xp, gold, focusSec, breakSec, overrunSec, hpChange, mpChange, sessionKey, city).lastInsertRowid;
}

// ----- สกิลของตัวละคร (เลเวล/XP ของสกิล — คลาส + สกิลจากคัมภีร์) -----
export const getSkillRows = (charId) =>
  db.prepare('SELECT skill_id, level, xp, source FROM character_skill WHERE character_id = ?').all(charId);

export const getSkillRow = (charId, skillId) =>
  db.prepare('SELECT skill_id, level, xp, source FROM character_skill WHERE character_id = ? AND skill_id = ?').get(charId, skillId);

// upsert: บันทึกเลเวล/XP ของสกิล (คลาสเริ่ม level 1 ไม่มีแถว — มีแถวเมื่อเริ่มสะสม XP)
export const upsertSkillRow = (charId, skillId, level, xp, source = 'class') => {
  db.prepare(`INSERT INTO character_skill (character_id, skill_id, level, xp, source) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(character_id, skill_id) DO UPDATE SET level = excluded.level, xp = excluded.xp`)
    .run(charId, skillId, level, xp, source);
};

// เรียนรู้สกิลใหม่จากคัมภีร์ — ถ้าอยู่แล้วไม่ทำอะไร (คืน 0) / ใหม่คืน 1
export const learnSkill = (charId, skillId, source = 'scroll') =>
  db.prepare('INSERT OR IGNORE INTO character_skill (character_id, skill_id, level, xp, source) VALUES (?, ?, 1, 0, ?)')
    .run(charId, skillId, source).changes;

export const addItem = (charId, itemId, qty = 1) => {
  db.prepare(`INSERT INTO inventory (character_id, item_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(character_id, item_id) DO UPDATE SET qty = qty + excluded.qty`).run(charId, itemId, qty);
};

export const updateCharacter = (c) => {
  db.prepare(`UPDATE character SET level=@level, xp=@xp, gold=@gold, hp=@hp, max_hp=@max_hp, mp=@mp, max_mp=@max_mp,
    atk=@atk, def=@def, spd=@spd, crit=@crit, stat_points=@stat_points,
    weapon_id=@weapon_id, offhand_id=@offhand_id, head_id=@head_id, armor_id=@armor_id,
    arms_id=@arms_id, legs_id=@legs_id, feet_id=@feet_id,
    accessory_id=@accessory_id, accessory_2_id=@accessory_2_id, accessory_3_id=@accessory_3_id, accessory_4_id=@accessory_4_id,
    city_index=@city_index
    WHERE id=@id`).run(c);
};
