import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import {
  db, DB_PATH, getCharacter, getCharacters, getProgress, getSettings, getInventory, getLog, addLog,
  addItem, updateCharacter, getActiveCharacterId, setActiveCharacter, deleteCharacter, bumpDaily, today,
  getSkillRow, learnSkill, getEpoch, rotateEpoch, learnRecipe, getLearnedRecipes, addTrophy, getTrophies,
  getPets, getPet, setActivePet, releasePet, grantPetXp, setPetTrapShield,
} from './db.js';
import {
  CLASSES, ITEM_BY_ID, CITIES, QUESTS, SHOP_STOCK, SCROLL_SKILL_BY_ID, ALT_BOSSES, altBossAt,
  ACHIEVEMENTS, SECRET_ACHIEVEMENTS, STORY_QUESTS, RECIPES, RECIPE_BY_ID, BLUEPRINT_ITEMS, MYSTERY_BOX_ID,
  PET_BY_ID, PET_MAX_SLOTS,
} from './data.js';
import {
  computeStats, serializeCharacter, gainXp, rollEvent, generateBoss, bossPlayerTurn, equipBlockReason,
  rollQuests, resolveQuest, campSellPrice, marketPrice, SLOT_COLS, blackMarketStock, blackMarketOpen, BM_JUNK_MULT, campFreebieId,
  rewardMult, dropMult, priceMult, challengeOf, CHALLENGES, festivalFor, storyReqMet, storyReqLabel,
  exploreMult, exploreRewardMult, bmExtraChance, mysteryBoxRoll, wanderingBossAt, petPerks, acquireItem, hatchEgg,
} from './game.js';
import { checkAchievements, getAchievementList } from './achievements.js';
import { getDailyQuests, claimDailyQuest, claimDailyAll } from './daily.js';
import { llmChat, llmEnabled } from './llm.js';
import { isDevDryRun } from './dev.js';
import { WRITABLE_TABLES, exportJsonData, restoreFromJson, checkDbSchema } from './data-io.js';

const router = Router();

// ----- ในหน่วยความจำ: สถานะการสู้บอส (key = character id) -----
const fights = new Map();

const requireChar = (res) => {
  const c = getCharacter();
  if (!c) { res.status(404).json({ error: 'ยังไม่มีตัวละคร' }); return null; }
  return c;
};

const serialize = (c) => ({ character: serializeCharacter(c) });

// นับ session ที่ทิ้งในสัปดาห์นี้ (จาก log abort — นับเฉพาะสัปดาห์ปัจจุบัน เริ่มวันจันทร์)
const abortsThisWeekCount = (cid) => db.prepare(`
  SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'abort'
    AND created_at >= datetime('now', 'localtime', 'weekday 0', '-6 days')
`).get(cid)?.n || 0;

const charBrief = (c) => ({
  id: c.id, name: c.name, class: c.class,
  classIcon: CLASSES[c.class]?.icon || '❓', className: CLASSES[c.class]?.name || c.class,
  level: c.level, xp: c.xp, gold: c.gold,
  city: CITIES[c.city_index % CITIES.length],
  challengeMode: c.challenge_mode || '',
  createdAt: c.created_at,
});

const charsPayload = () => ({ characters: getCharacters().map(charBrief), activeCharacterId: getActiveCharacterId() });

const dailyPayload = (c) => ({ daily: getDailyQuests(c) });

// เช็คชื่อซ้ำ (ไม่แยกตัวพิมพ์เล็ก/ใหญ่)
const nameTaken = (name, excludeId = null) => {
  const row = excludeId
    ? db.prepare('SELECT id FROM character WHERE name = ? COLLATE NOCASE AND id != ?').get(name, excludeId)
    : db.prepare('SELECT id FROM character WHERE name = ? COLLATE NOCASE').get(name);
  return !!row;
};

// ----- สถานะรวม -----
router.get('/state', (req, res) => {
  const c = getCharacter();
  // epoch = "โลกเวอร์ชัน" — client เทียบกับ epoch ที่เก็บใน timer (localStorage) เพื่อทิ้ง session ที่พักค้างจากโลกเก่า
  const epoch = getEpoch();
  if (!c) return res.json({ hasCharacter: false, epoch, settings: getSettings(), ...charsPayload() });
  res.json({
    hasCharacter: true,
    epoch,
    ...serialize(c),
    inventory: getInventory(c.id),
    progress: getProgress(c.id),
    achievements: getAchievementList(c, getProgress(c.id)),
    log: getLog(c.id),
    settings: getSettings(),
    cities: CITIES.map((city, index) => ({ ...city, index })),
    abortsThisWeek: abortsThisWeekCount(c.id), // ทิ้ง session สัปดาห์นี้ — modal เตือนเมื่อเกินเกณฑ์ (เกณฑ์ = settings.abort_week_limit)
    ...charsPayload(),
    ...dailyPayload(c),
  });
});

// รายชื่อตัวละครทั้งหมด (หน้าเลือกตัวละคร)
router.get('/characters', (req, res) => {
  res.json(charsPayload());
});

// รายการ achievement ทั้งหมด (สำหรับหน้า "ตรา")
router.get('/achievements', (req, res) => {
  const c = requireChar(res); if (!c) return;
  res.json({ achievements: getAchievementList(c, getProgress(c.id)) });
});

// ----- ตัวละคร -----
router.post('/character/create', (req, res) => {
  const { name, class: cls, challengeMode } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'ต้องตั้งชื่อตัวละคร' });
  if (!CLASSES[cls]) return res.status(400).json({ error: 'เลือกคลาสไม่ถูกต้อง' });
  if (nameTaken(name.trim())) return res.status(400).json({ error: `มีตัวละครชื่อ "${name.trim()}" อยู่แล้ว — ลองชื่ออื่น` });
  const cm = ['hard', 'marathon', 'survival'].includes(challengeMode) ? challengeMode : '';

  const b = CLASSES[cls].base;
  const info = db.prepare(`INSERT INTO character (name, class, hp, max_hp, mp, max_mp, atk, def, spd, crit, challenge_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name.trim().slice(0, 20), cls, b.hp, b.hp, b.mp, b.mp, b.atk, b.def, b.spd, b.crit, cm);
  const c = db.prepare('SELECT * FROM character WHERE id = ?').get(info.lastInsertRowid);
  setActiveCharacter(c.id); // ตัวที่สร้างใหม่ = ตัวที่เล่น
  addLog(c.id, { type: 'system', title: '🎒 เริ่มการผจญภัย', detail: `${c.name} (${CLASSES[cls].name}) ออกเดินทางจาก ${CITIES[0].name}!` });
  res.json({ ...serialize(c), progress: getProgress(c.id), ...charsPayload() });
});

router.post('/character/select', (req, res) => {
  const { id } = req.body || {};
  const target = db.prepare('SELECT id FROM character WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  setActiveCharacter(id);
  res.json({ ok: true, activeCharacterId: id, ...charsPayload() });
});

// เปลี่ยนโหมดท้าทายระหว่างเล่น — เสียค่าปรับทอง (50 + 30×เลเวล) + คอมโบหาย + ต้องไม่มี session กำลังรอ
// (กันสลับโหมดไปมาเก็บรางวัล x1.5 โดยไม่เสี่ยง — เปลี่ยนได้แต่ต้องจ่าย)
router.post('/character/challenge', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { mode } = req.body || {};
  const valid = ['', 'hard', 'marathon', 'survival'];
  if (!valid.includes(mode)) return res.status(400).json({ error: 'โหมดไม่ถูกต้อง' });
  if ((c.challenge_mode || '') === mode) return res.status(400).json({ error: 'กำลังเล่นโหมดนี้อยู่แล้ว' });
  const cost = 50 + 30 * c.level;
  if (c.gold < cost) return res.status(400).json({ error: `ทองไม่พอ — เปลี่ยนโหมดต้องจ่าย ${cost} ทอง` });
  c.gold -= cost;
  c.challenge_mode = mode;
  const prog = getProgress(c.id);
  prog.streak = 0; // เปลี่ยนโหมด = เริ่มคอมโบใหม่
  updateCharacter(c);
  db.prepare('UPDATE progress SET streak = 0 WHERE id = ?').run(prog.id);
  const from = CHALLENGES[c.challenge_mode] ? CHALLENGES[c.challenge_mode].label : '🎮 ปกติ';
  addLog(c.id, { type: 'challenge', title: '🔥 เปลี่ยนโหมดท้าทาย', detail: `สลับจาก ${from} → ${mode ? CHALLENGES[mode].label : '🎮 ปกติ'} (-${cost} ทอง, คอมโบรีเซ็ต)` });
  res.json({ ...serialize(c), progress: getProgress(c.id), message: `เปลี่ยนโหมดแล้ว (-${cost} ทอง, คอมโบรีเซ็ต)` });
});

router.post('/character/rename', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'ต้องตั้งชื่อตัวละคร' });
  const newName = name.trim().slice(0, 20);
  if (nameTaken(newName, c.id)) return res.status(400).json({ error: `มีตัวละครชื่อ "${newName}" อยู่แล้ว` });
  db.prepare('UPDATE character SET name = ? WHERE id = ?').run(newName, c.id);
  const updated = db.prepare('SELECT * FROM character WHERE id = ?').get(c.id);
  addLog(c.id, { type: 'system', title: '📝 เปลี่ยนชื่อ', detail: `เปลี่ยนชื่อเป็น ${newName}` });
  res.json({ ...serialize(updated), ...charsPayload() });
});

router.post('/character/delete', (req, res) => {
  const { id, confirm } = req.body || {};
  // กันลบโดยไม่ตั้งใจ — ต้องส่ง confirm: true (จาก UI ที่กดยืนยัน 2 ครั้ง)
  if (confirm !== true) return res.status(400).json({ error: 'ต้องยืนยันการลบตัวละครก่อน' });
  const target = db.prepare('SELECT id FROM character WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  deleteCharacter(id);
  fights.delete(id);
  if (getActiveCharacterId() === id) {
    const next = db.prepare('SELECT id FROM character ORDER BY id LIMIT 1').get();
    setActiveCharacter(next ? next.id : null);
  }
  res.json({ ok: true, ...charsPayload() });
});

router.post('/character/reset', (req, res) => {
  const c = getCharacter();
  if (!c) return res.json({ ok: true });
  deleteCharacter(c.id);
  fights.delete(c.id);
  const next = db.prepare('SELECT id FROM character ORDER BY id LIMIT 1').get();
  setActiveCharacter(next ? next.id : null);
  res.json({ ok: true, ...charsPayload() });
});

router.post('/character/allocate', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { hp = 0, mp = 0, atk = 0, def = 0, spd = 0 } = req.body || {};
  const total = hp + mp + atk + def + spd;
  if (total > c.stat_points) return res.status(400).json({ error: 'แต้มไม่พอ' });
  c.stat_points -= total;
  c.max_hp += hp * 8; c.hp += hp * 8;
  c.max_mp += mp * 5; c.mp += mp * 5;
  c.atk += atk;
  c.def += def;
  c.spd += spd;
  updateCharacter(c);
  res.json({ ...serialize(c), message: 'จัดสรรแต้มสถานะเรียบร้อย' });
});

// ----- ผจญภัย (work session) -----
router.post('/adventure/event', (req, res) => {
  const c = requireChar(res); if (!c) return;
  // key (optional) = บังคับ event ให้เกิดตาม key — ใช้ใน dev test
  const { key, sessionKey } = req.body || {};
  const ev = rollEvent(c, key || null);
  if (!ev) return res.status(400).json({ error: 'event ไม่พบ' });
  updateCharacter(c);
  // กระเป๋าเต็ม + ของดรอป/รางวัล → ขายอัตโนมัติราคาพื้นฐาน (กันเก็บไว้รอราคาดีไม่อั้น)
  let bagNote = '';
  if (ev.item) {
    const got = acquireItem(c, ev.item.id, 1, { fullMode: 'sell' });
    if (got.sold) bagNote = ` (🎒 กระเป๋าเต็ม — ขาย ${ev.item.icon} ${ev.item.name} อัตโนมัติ +${got.gold} ทอง)`;
  }
  updateCharacter(c);
  if (bagNote) ev.detail = (ev.detail || '') + bagNote;
  addLog(c.id, { type: ev.logType || ev.key, title: ev.title, detail: ev.detail, xp: ev.xp, gold: ev.gold, hpChange: ev.hpChange || 0, mpChange: ev.mpChange || 0, sessionKey });
  // อัปเดต counter สถิติ (รวมตัวที่ใช้ตรวจตราลับ)
  const prog = getProgress(c.id);
  const up = (col, val) => db.prepare(`UPDATE progress SET ${col}=? WHERE id=?`).run(val, prog.id);
  if (ev.key === 'monster' && ev.monster?.win) { prog.monsters_slain += 1; up('monsters_slain', prog.monsters_slain); }
  // 🌟 มอนสเตอร์พิเศษ (จ้าวมังกรทอง) / 🏙️ ตัวประจำเมือง — นับชัยชนะ (ตราลับ "นักล่าตำนาน"/"นักล่าประจำเมือง")
  if (ev.key === 'monster' && ev.monster?.win && ev.monster?.rare) { prog.rare_wins = (prog.rare_wins || 0) + 1; up('rare_wins', prog.rare_wins); }
  if (ev.key === 'monster' && ev.monster?.win && ev.monster?.cityRare) { prog.city_wins = (prog.city_wins || 0) + 1; up('city_wins', prog.city_wins); }
  if (ev.key === 'treasure') { prog.treasures_found += 1; up('treasures_found', prog.treasures_found); }
  if (ev.key === 'shrine') { prog.shrines += 1; up('shrines', prog.shrines); }
  if (ev.key === 'trap') { prog.traps += 1; up('traps', prog.traps); }
  if (ev.key === 'merchant' && ev.item) { prog.merchant_gifts += 1; up('merchant_gifts', prog.merchant_gifts); }
  // ตัวนับรายวัน (Daily Quest)
  if (ev.key === 'treasure') bumpDaily(c.id, 'treasures');
  if (ev.key === 'monster' && ev.monster?.win) bumpDaily(c.id, 'monsters');
  const ach = checkAchievements(c, prog, { event: ev });
  res.json({
    ...serialize(c),
    event: ev,
    progress: getProgress(c.id),
    achievements: ach.fresh,
    ...dailyPayload(c),
    levelUps: { levels: (ev.ups || 0) + ach.ups, statPoints: c.stat_points },
  });
});

router.post('/adventure/complete', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { focusSec = 1500, pauseSec = 0, longPauseSec = 0, longPauseTitle = '', events = [], sessionIdx = 1, sessionsPerCycle = 1, sessionKey = null, focusTask = null } = req.body || {};
  const prog = getProgress(c.id);

  // โหมดมาราธอน: ห้ามพักระหว่างโฟกัส — ถ้าโฟกัสไม่ถึง 90% ของเวลาที่ควร (กดพัก/กลับหน้าหลักกลาง session)
  // → session นี้ "เสีย": ไม่ได้รางวัล ไม่นับ session ไม่สะสม XP/ทอง/คอมโบ
  // (ยกเว้นมี 🛡️ โล่โฟกัส — กันคอมโบไว้ 1 ครั้ง โล่แตก แต่ session ยังเสีย)
  if (c.challenge_mode === 'marathon' && focusSec < 0.9 * getSettings().work_min * 60) {
    if (prog.combo_shield > 0) {
      prog.combo_shield = 0;
      db.prepare('UPDATE progress SET combo_shield = 0 WHERE id = ?').run(prog.id);
      addLog(c.id, {
        type: 'abort', title: '🛡️ โล่โฟกัสกันคอมโบ (มาราธอน)',
        detail: `พักระหว่างโฟกัส (${Math.round(focusSec / 60)} นาที/${getSettings().work_min} นาที) — session นี้เสีย แต่โล่โฟกัสกันคอมโบไว้ได้! (โล่แตก)`,
        focusSec,
      });
      return res.json({ ...serialize(c), failed: true, shieldUsed: true, message: '💔 เสีย session (มาราธอน) — แต่ 🛡️ โล่โฟกัสกันคอมโบไว้ได้! (โล่แตก)' });
    }
    prog.streak = 0;
    db.prepare('UPDATE progress SET streak = 0 WHERE id = ?').run(prog.id);
    addLog(c.id, {
      type: 'abort', title: '💔 เสีย session (มาราธอน)',
      detail: `พักระหว่างโฟกัส (${Math.round(focusSec / 60)} นาที/${getSettings().work_min} นาที) — session นี้ไม่ได้รางวัล คอมโบหาย!`,
      focusSec,
    });
    return res.json({ ...serialize(c), failed: true, message: '💔 เสีย session — โหมดมาราธอนห้ามพักระหว่างโฟกัส (ไม่ได้รางวัล)' });
  }

  // โหมดเอาชีวิตรอด: ถ้า HP เหลือ 1 (ใกล้ตายจากสู้มอนสเตอร์) ตอนจบ session → "อ่อนแรงล้ม"
  // เสียของสุ่ม 1 ชิ้น + คอมโบหาย + เริ่มรอบเมืองใหม่ (ไม่กลับไปเมืองก่อน) — ยังได้ XP/ทอง session (โฟกัสงานครบจริง)
  let survivalFall = null;
  if (c.challenge_mode === 'survival' && c.hp <= 1) {
    const inv = getInventory(c.id).filter((i) => i.qty > 0 && i.type !== 'scroll');
    if (inv.length > 0) {
      const victim = inv[Math.floor(Math.random() * inv.length)];
      db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, victim.item_id);
      survivalFall = `💀 อ่อนแรงล้มกลางป่า — ของหาย: ${victim.icon} ${victim.name} x1`;
    } else {
      survivalFall = '💀 อ่อนแรงล้มกลางป่า — กระเป๋าเปล่า ไม่มีของให้เสีย';
    }
    prog.streak = 0;
    c.hp = 1; // ฟื้นนิดหน่อยจากหมดสติ (ยังไม่ตาย — โหมดนี้โหดแต่ไม่สิ้นหวัง)
  }

  prog.streak += 1;
  prog.best_streak = Math.max(prog.best_streak, prog.streak);
  prog.sessions_completed += 1;
  prog.total_focus_sec += focusSec;
  // พักกลาง session (กดหยุดพัก/กลับหน้าหลักระหว่างโฟกัส) — แยกจาก break_sec (พักระหว่าง session)
  prog.pause_sec += Math.max(0, Math.round(pauseSec));
  // พักยาว 😴 (เลือกตอนกดพัก — ไปนอน/ทานข้าว/ธุระ) — แยกหมวดจาก pause_sec (พักสั้น)
  prog.long_pause_sec += Math.max(0, Math.round(longPauseSec));
  // 🐾 สัตว์เลี้ยงสะสม XP จากเวลาโฟกัส (โฟกัส 1 นาที = 1 XP — ฟัก/ร่วมผจญภัยก็ได้ XP จาก event ด้วย)
  const petLevelNote = (() => {
    const active = getPets(c.id).find((p) => p.is_active);
    if (!active) return '';
    const g = grantPetXp(c.id, active.pet_id, Math.max(1, Math.round(focusSec / 60)));
    if (g.levelUp) {
      const def = PET_BY_ID[active.pet_id];
      return ` · 🐾 ${def?.icon || ''} ${def?.name || active.pet_id} เลเวลขึ้นเป็น Lv.${g.level}!`;
    }
    return '';
  })();

  const bonus = 1 + Math.min(prog.streak - 1, 4) * 0.1;
  const chMult = rewardMult(c); // โหมดท้าทาย: XP/ทอง x1.5 (เสี่ยงสูง รางวัลสูง)
  const xp = Math.round((100 + 20 * c.level) * bonus * chMult);
  const gold = Math.round((25 + 8 * c.level) * chMult);
  const ups = gainXp(c, xp);
  c.gold += gold;
  prog.gold_earned += gold;

  // นับ streak รายวัน (สำหรับตราลับ "เจ็ดวันมหัศจรรย์")
  const timeRow = db.prepare("SELECT strftime('%H','now','localtime') AS h, date('now','localtime') AS d").get();
  const today = timeRow.d;
  if (prog.last_focus_date !== today) {
    const yesterday = db.prepare("SELECT date('now','localtime','-1 day') AS d").get().d;
    prog.daily_streak = prog.last_focus_date === yesterday ? prog.daily_streak + 1 : 1;
    prog.last_focus_date = today;
  }

  updateCharacter(c);
  db.prepare(`UPDATE progress SET streak=@streak, best_streak=@best_streak, sessions_completed=@sessions_completed,
    total_focus_sec=@total_focus_sec, pause_sec=@pause_sec, long_pause_sec=@long_pause_sec, gold_earned=@gold_earned, daily_streak=@daily_streak, last_focus_date=@last_focus_date WHERE id=@id`).run(prog);

  const streakMsg = bonus > 1 ? ` (คอมโบโฟกัส x${bonus.toFixed(1)})` : '';
  const pauseSecRounded = Math.max(0, Math.round(pauseSec));
  const pauseNote = pauseSecRounded > 60
    ? ` · ⏸️ พัก ${Math.round(pauseSecRounded / 60)} นาที`
    : pauseSecRounded > 0 ? ` · ⏸️ พัก ${pauseSecRounded} วิ` : '';
  const longPauseSecRounded = Math.max(0, Math.round(longPauseSec));
  const longPauseTitleClean = typeof longPauseTitle === 'string' ? longPauseTitle.trim() : '';
  const longPauseNote = longPauseSecRounded > 0
    ? ` · 😴 พักยาว ${Math.round(longPauseSecRounded / 60)} นาที${longPauseTitleClean ? ` (${longPauseTitleClean})` : ''}`
    : '';
  const taleAfter = addLog(c.id, {
    type: 'session_done', title: '✅ จบเซสชันโฟกัส', detail: `โฟกัสครบ! +${xp} XP${streakMsg}, +${gold} ทอง${pauseNote}${longPauseNote}${petLevelNote}${survivalFall ? ` · ${survivalFall}` : ''}`,
    xp, gold, focusSec, pauseSec: pauseSecRounded, longPauseSec: longPauseSecRounded, longPauseTitle: longPauseTitleClean, focusTask,
  });
  if (survivalFall) {
    addLog(c.id, { type: 'survival_fall', title: '💀 อ่อนแรงล้ม', detail: survivalFall });
  }

  // เหตุการณ์ที่เจอใน session นี้ (จาก client) — ส่งให้ LLM แต่งเรื่อง + ใช้เป็นสรุปสำรอง
  const sessionEvents = (Array.isArray(events) ? events : [])
    .filter((e) => e && (e.detail || e.title))
    .slice(-12);

  // บันทึกสรุป session กำกับ label "Session X/Y @ HH:MM" — ดูย้อนหลังได้ในบันทึกการผจญภัย (1 แถว/session)
  if (sessionEvents.length > 0) {
    const TYPE_LABEL = { battle_win: 'ชนะมอนสเตอร์', battle_lose: 'หนีมอนสเตอร์', treasure: 'พบสมบัติ', shrine: 'ศาลเจ้า', merchant: 'พ่อค้า', trap: 'กับดัก' };
    const counts = {};
    let sXp = 0, sGold = 0, sHp = 0, sMp = 0, sItems = 0;
    for (const e of sessionEvents) {
      const k = e.logType || e.key || 'event';
      counts[k] = (counts[k] || 0) + 1;
      sXp += e.xp || 0; sGold += e.gold || 0;
      if (e.hpChange < 0) sHp += Math.abs(e.hpChange);
      if (e.mpChange > 0) sMp += e.mpChange;
      if (e.item) sItems += 1;
    }
    const parts = Object.entries(counts).map(([k, n]) => `${TYPE_LABEL[k] || k} x${n}`);
    const hhmm = db.prepare("SELECT strftime('%H:%M','now','localtime') AS t").get().t;
    const sessCity = CITIES[c.city_index % CITIES.length]; // เมืองที่ผจญภัยใน session นี้ — ใช้ค้นหาในหน้าประวัติ session
    addLog(c.id, {
      type: 'session_summary',
      title: `📋 Session ${sessionIdx}/${sessionsPerCycle} @ ${hhmm} · ${sessCity.icon} ${sessCity.name}${focusTask ? ` · 📋 ${focusTask}` : ''}`,
      detail: [parts.join(' · '), `รวม: +${sXp} XP · +${sGold} ทอง${sHp ? ` · เสีย ${sHp} HP` : ''}${sMp ? ` · +${sMp} MP` : ''}${sItems ? ` · ไอเทม ${sItems} ชิ้น` : ''}`].join('\n'),
      xp: sXp, gold: sGold,
      sessionKey,
      city: sessCity.name,
      challengeMode: c.challenge_mode || '',
      focusTask,
    });
  }

  // สรุปจาก log เหตุการณ์จริง — ใช้เมื่อ LLM ไม่ได้เรื่อง (ปิด / พัง / ตอบไม่ได้)
  const fallbackTale = () => {
    if (!sessionEvents.length) return null;
    const lines = sessionEvents.map((e, i) => `${i + 1}. ${e.detail || e.title}`);
    return [
      `ใน session นี้ ${c.name} ได้พบเหตุการณ์ ${sessionEvents.length} อย่าง:`,
      ...lines,
      `รวมแล้วได้ +${xp} XP และ +${gold} ทอง (คอมโบโฟกัส x${bonus.toFixed(1)})`,
    ].join('\n');
  };
  // บันทึกเรื่องราว LLM พร้อม sessionKey — จับกลุ่มในประวัติ session (หน้าประวัติ/ค้นหาเจอเรื่องนี้ด้วย)
  const recordTale = (text) => {
    if (text) addLog(c.id, { type: 'llm_tale', title: '📖 เรื่องราวการผจญภัย', detail: text.slice(0, 500), sessionKey });
  };

  // สรุปการผจญภัยด้วย LLM (ถ้าเปิดใช้) — fire-and-forget: ไม่บล็อก response; ถ้าไม่ได้เรื่องก็ใช้สรุปเหตุการณ์แทน
  // (dev ลองเล่น: ข้ามไปเลย — async write หลุดจาก transaction ที่จะ ROLLBACK ได้)
  const city = CITIES[c.city_index % CITIES.length];
  if (!isDevDryRun()) {
    llmChat({
      system: 'You are the narrator of PomoQuest, a Pomodoro RPG game. Write a short, vivid 2-3 sentence adventure story entirely in Thai (ภาษาไทยล้วน ๆ — no English words at all). Narrate only what happened during this focus session, weaving in the events list below if provided — never invent rewards, numbers, items or levels. Keep it fun and concise.',
      user: JSON.stringify({
        character: c.name, class: CLASSES[c.class]?.name || c.class, level: c.level,
        city: city.name, terrain: city.terrain,
        focusMinutes: Math.round(focusSec / 60), streak: prog.streak,
        xpGained: xp, goldGained: gold, sessionsCompleted: prog.sessions_completed,
        events: sessionEvents.map((e) => e.detail || e.title),
      }),
    }).then((tale) => recordTale(tale || fallbackTale()))
      .catch(() => recordTale(fallbackTale()));
  }
  // 🥚 ไข่ที่กำลังฟัก (ใช้ไข่แล้ว) — จบ 1 session ครบแล้ว → ไข่ฟักออกมาเป็นสัตว์เลี้ยง
  const hatch = hatchEgg(c);
  if (hatch && !hatch.waiting && !hatch.dup) {
    // ฟักสำเร็จ — แจ้งใน log session ด้วย
    addLog(c.id, { type: 'session_done_hatch', title: '🥚 ไข่ฟักแล้ว!', detail: `หลังจบ session ไข่ปริศนาฟักออกมาเป็น ${hatch.pet.icon} ${hatch.pet.name} (${hatch.rarityLabel}) — ตั้งเป็นตัวที่ใช้งานแล้ว` });
  }
  // ตัวนับรายวัน (Daily Quest)
  bumpDaily(c.id, 'sessions');
  bumpDaily(c.id, 'focus_sec', focusSec);
  const ach = checkAchievements(c, prog, { hour: parseInt(timeRow.h, 10) });
  res.json({
    ...serialize(c),
    progress: getProgress(c.id),
    reward: { xp, gold, bonus, streak: prog.streak },
    achievements: ach.fresh,
    ...dailyPayload(c),
    levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
    taleAfter,
    talePending: llmEnabled() && !isDevDryRun(),
    survivalFall,
    hatch,
  });
});

// เรื่องราว LLM หลังจบ session — client poll เรื่องใหม่ที่เพิ่งเขียน (id > after)
router.get('/adventure/story', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const after = parseInt(req.query.after, 10) || 0;
  const tale = db.prepare(`SELECT * FROM log WHERE character_id = ? AND type = 'llm_tale' AND id > ? ORDER BY id LIMIT 1`).get(c.id, after);
  res.json({ story: tale || null, pending: llmEnabled() });
});

// ประวัติ session — สรุป session (session_summary) + เหตุการณ์ทั้งหมดที่อยู่ใน session นั้น (จับกลุ่มด้วย session_key)
router.get('/session-history', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const summaries = db.prepare("SELECT * FROM log WHERE character_id = ? AND type = 'session_summary' ORDER BY id DESC LIMIT 200").all(c.id);
  // backfill: session เก่า (ก่อนมีคอลัมน์ city) — ดึงเมืองจาก title "· 🏰 แอสการ์ด" แล้วบันทึกถาวร
  const backfillCity = db.prepare('UPDATE log SET city = ? WHERE id = ?');
  for (const s of summaries) {
    if (!s.city) {
      const fromTitle = CITIES.find((c) => (s.title || '').includes(`${c.icon} ${c.name}`))?.name || null;
      if (fromTitle) {
        backfillCity.run(fromTitle, s.id);
        s.city = fromTitle;
      }
    }
  }
  const keys = summaries.map((s) => s.session_key).filter(Boolean);
  let eventsByKey = {};
  if (keys.length) {
    const events = db.prepare(`
      SELECT * FROM log WHERE character_id = ? AND session_key IN (${keys.map(() => '?').join(',')})
      AND type NOT IN ('session_summary', 'session_done') ORDER BY id
    `).all(c.id, ...keys);
    for (const e of events) {
      (eventsByKey[e.session_key] ||= []).push(e);
    }
  }
  // เมืองที่เคยผจญภัย (จาก session summary) — เรียงตาม session แรกที่เจอ — ใช้ dropdown กรองเมือง
  const cityRows = db.prepare(
    "SELECT city, MIN(id) AS first_id FROM log WHERE character_id = ? AND type = 'session_summary' AND city IS NOT NULL GROUP BY city ORDER BY first_id"
  ).all(c.id);
  res.json({
    sessions: summaries.map((s) => ({ ...s, events: eventsByKey[s.session_key] || [] })),
    cities: cityRows.map((r) => r.city),
  });
});

router.post('/adventure/abort', (req, res) => {
  const c = requireChar(res); if (!c) return;
  // เหตุผลที่ทิ้ง session (เลือกจาก modal — เก็บสถิติ/ดูย้อนหลัง) + โฟกัสไปแล้วกี่วินาที
  const { reason = '', focusSec = 0 } = req.body || {};
  const reasonLabel = String(reason || '').trim();
  const focusSecN = Math.max(0, Math.round(Number(focusSec) || 0));
  const prog = getProgress(c.id);
  // 🛡️ โล่โฟกัส — ถ้ามี ให้กันคอมโบหาย 1 ครั้ง (โล่แตก แล้วคอมโบยังอยู่)
  if (prog.combo_shield > 0) {
    prog.combo_shield = 0;
    db.prepare('UPDATE progress SET combo_shield = 0 WHERE id = ?').run(prog.id);
    addLog(c.id, { type: 'abort', title: '🛡️ โล่โฟกัสกันคอมโบ!', detail: 'ทิ้งเซสชัน แต่โล่โฟกัสกันคอมโบไว้ได้ (โล่แตก) — คอมโบยังอยู่!', focusSec: focusSecN, abortReason: reasonLabel });
    return res.json({ progress: getProgress(c.id), abortsThisWeek: abortsThisWeekCount(c.id), shieldUsed: true, message: '🛡️ โล่โฟกัสกันคอมโบไว้ได้! คอมโบไม่หาย (โล่แตก)' });
  }
  prog.streak = 0;
  db.prepare('UPDATE progress SET streak = 0 WHERE id = ?').run(prog.id);
  const detail = reasonLabel
    ? `เหตุผล: ${reasonLabel} · คอมโบโฟกัสหายไป (เริ่มใหม่จาก 1)`
    : 'คอมโบโฟกัสหายไป (เริ่มใหม่จาก 1)';
  addLog(c.id, { type: 'abort', title: '💨 ละทิ้งเซสชัน', detail, focusSec: focusSecN, abortReason: reasonLabel });
  res.json({ progress: getProgress(c.id), abortsThisWeek: abortsThisWeekCount(c.id) });
});

// ----- จบพักเบรก — บันทึกสถิติการพัก (ระยะเวลา / เลยเวลา / ต่อเวลากี่ครั้ง) -----
router.post('/break/done', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { breakSec = 0, overrunSec = 0, extended = 0 } = req.body || {};
  const prog = getProgress(c.id);
  prog.break_sec += Math.max(0, Math.round(breakSec));
  prog.break_overrun_sec += Math.max(0, Math.round(overrunSec));
  prog.break_extended += Math.max(0, Math.round(extended));
  db.prepare('UPDATE progress SET break_sec=?, break_overrun_sec=?, break_extended=? WHERE id=?')
    .run(prog.break_sec, prog.break_overrun_sec, prog.break_extended, prog.id);
  const mins = Math.round(Math.max(0, Math.round(breakSec)) / 60);
  const parts = [`พัก ${mins} นาที`];
  if (extended > 0) parts.push(`ต่อเวลา ${extended} ครั้ง`);
  if (overrunSec > 0) parts.push(`เลยเวลา ${Math.round(overrunSec / 60)} นาที`);
  addLog(c.id, { type: 'break_done', title: '☕ จบพักเบรก', detail: parts.join(' · '), breakSec: Math.round(breakSec), overrunSec: Math.round(overrunSec) });
  res.json({ progress: getProgress(c.id), message: 'บันทึกการพักแล้ว' });
});

// ----- เดินทาง (ย้อนกลับไปเมืองที่เคยไปมาแล้ว — เสีย 20 ทอง/เมือง) -----
router.post('/travel', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { cityIndex } = req.body || {};
  if (!Number.isInteger(cityIndex)) return res.status(400).json({ error: 'ระบุเมืองไม่ถูกต้อง' });
  if (cityIndex < 0 || cityIndex > c.city_index) return res.status(400).json({ error: 'เดินทางได้เฉพาะเมืองที่เคยไปมาแล้ว' });
  if (cityIndex === c.city_index) return res.status(400).json({ error: 'คุณอยู่ที่เมืองนี้แล้ว' });
  const dist = c.city_index - cityIndex;
  const cost = dist * 20;
  if (c.gold < cost) return res.status(400).json({ error: `ทองไม่พอ — ต้องใช้ ${cost} ทองเพื่อเดินทางกลับ ${dist} เมือง` });
  const from = CITIES[c.city_index % CITIES.length];
  c.gold -= cost;
  c.city_index = cityIndex;
  updateCharacter(c);
  fights.delete(c.id); // เคลียร์สถานะสู้บอสเก่า
  addLog(c.id, { type: 'travel', title: '🗺️ เดินทาง', detail: `เดินทางจาก ${from.name} กลับสู่ ${CITIES[cityIndex].name} (-${cost} ทอง)`, gold: -cost });
  res.json({
    ...serialize(c),
    progress: getProgress(c.id),
    message: `🗺️ เดินทางถึง ${CITIES[cityIndex].name} แล้ว (-${cost} ทอง)`,
  });
});

// สุ่มหยิบของ n ชิ้นจากลิสต์ (Fisher–Yates)
const pickRandom = (arr, n) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
};

// ตลาดมืด: logic อยู่ที่ server/game.js (blackMarketStock/BM_JUNK_MULT) — ใช้ร่วมกัน routes + dev preview

// ----- ค่ายพัก (short break) -----
// ร้านค่ายพัก: สินค้าสุ่มใหม่ทุกค่ายพัก (visit ต่างกัน = ค่ายพักใหม่) และซื้อได้ครั้งเดียวต่อค่ายพัก
router.get('/camp', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const visit = req.query.visit || `v${Date.now()}`;
  // เทศกาลประจำสัปดาห์ — เมืองนี้เป็นเมืองจัดงานไหม (สินค้าพิเศษลด 20% ที่ร้านค่าย)
  const fest = festivalFor(c.city_index);
  let stock = db.prepare('SELECT item_id, qty, market FROM camp_shop WHERE character_id = ? AND visit = ?').all(c.id, visit);
  if (!stock.length) {
    db.prepare('DELETE FROM camp_shop WHERE character_id = ?').run(c.id); // ล้าง stock ค่ายเก่า
    db.prepare('DELETE FROM camp_quest_done WHERE character_id = ?').run(c.id); // ล้างภารกิจที่ทำแล้วของค่ายเก่า (ทำได้ 1 ครั้งต่อพัก)
    // ขายเฉพาะของที่คลาสนี้ใช้ได้ (ไม่ขายอุปกรณ์เฉพาะคลาสอื่นให้รก)
    const pool = SHOP_STOCK.filter((i) => i.type === 'consumable' || ((i.lvl || 1) <= c.level + 1 && (!i.classReq || i.classReq.includes(c.class))));
    // สินค้า 3–5 ชิ้น: ยา 1–2 + อุปกรณ์ 2–3 (สุ่มจำนวนด้วย)
    const nConsumable = 1 + Math.floor(Math.random() * 2);
    const nGear = 2 + Math.floor(Math.random() * 2);
    const chosen = [
      ...pickRandom(pool.filter((i) => i.type === 'consumable'), nConsumable),
      ...pickRandom(pool.filter((i) => i.type !== 'consumable'), nGear),
    ];
    const ins = db.prepare('INSERT OR IGNORE INTO camp_shop (character_id, visit, item_id, qty, market) VALUES (?, ?, ?, 0, ?)');
    for (const i of chosen) ins.run(c.id, visit, i.id, 'camp');
    // ตลาดมืด (ถ้าเจอ) — เพิ่มสินค้าเข้าร้านค่ายพักนี้ (market='black')
    // UPSERT: ถ้าสินค้าชิ้นนั้นอยู่ในร้านปกติด้วย (เช่น ของเถื่อนที่สุ่มมาเป็นเกียร์ชิ้นเดียวกัน) ให้ตลาดมืดแย่งช่อง
    // สำรวจเมืองเดิมต่อ → โอกาสเจอตลาดมืดเพิ่มขึ้น
    const bm = blackMarketStock(visit, c);
    if (bm) {
      const bmIns = db.prepare(`INSERT INTO camp_shop (character_id, visit, item_id, qty, market) VALUES (?, ?, ?, 0, ?)
        ON CONFLICT(character_id, visit, item_id) DO UPDATE SET market = 'black'`);
      for (const i of bm) bmIns.run(c.id, visit, i.id, 'black');
    }
    // เทศกาลประจำสัปดาห์ — สินค้าพิเศษของเมืองนี้ (market='festival' — ลด 20%)
    if (fest) {
      for (const itemId of fest.items) ins.run(c.id, visit, itemId, 'festival');
    }
    stock = db.prepare('SELECT item_id, qty, market FROM camp_shop WHERE character_id = ? AND visit = ?').all(c.id, visit);
  }
  // ราคาในร้านตามวันนี้ (market) — ของที่พ่อค้าต้องการวันนี้แพงขึ้น, ของส่วนใหญ่ราคาปกติ, สุ่มไม่กี่ชิ้นลดราคา
  const dayKey = today();
  const bm = blackMarketStock(visit, c);
  // โหมดโหด: ราคาในร้านแพงขึ้น x1.3 (ราคาที่โชว์ = ราคาที่จ่ายจริง)
  const pm = priceMult(c);
  // ของแถมฟรี: สุ่ม 1 ชิ้นที่พ่อค้า/ตลาดมืด "ไม่อยากได้" (ราคา 0) — deterministic จาก visit (เปิดซ้ำหน้าเดิมได้ของเดิม)
  const freebieId = campFreebieId(visit, c, stock);
  const shop = stock.map((s) => {
    const base = ITEM_BY_ID[s.item_id];
    if (!base) return null;
    const free = s.item_id === freebieId;
    if (s.market === 'black') {
      const b = bm?.find((x) => x.id === s.item_id);
      return { ...base, price: free ? 0 : Math.round((b?.bmPrice ?? base.price) * pm), originalPrice: Math.round(base.price * pm), bmNormal: b?.bmNormal, bmTag: b?.bmTag, bm: 1, free: free ? 1 : 0, bought: s.qty >= 1 ? 1 : 0 };
    }
    if (s.market === 'festival') {
      // สินค้าเทศกาล — ลด 20% (ราคาที่โชว์ = ราคาที่จ่ายจริง, originalPrice = ราคาปกติก่อนลด)
      return { ...base, price: Math.round(base.price * 0.8 * pm), originalPrice: Math.round(base.price * pm), priceMult: 0.8, sale: 1, festival: 1, free: 0, bought: s.qty >= 1 ? 1 : 0 };
    }
    const m = marketPrice(base, dayKey);
    return { ...base, price: free ? 0 : Math.round(m.price * pm), originalPrice: Math.round(base.price * pm), priceMult: free ? 1 : m.mult, hot: free ? false : m.hot, sale: free ? false : m.sale, free: free ? 1 : 0, bought: s.qty >= 1 ? 1 : 0 };
  }).filter(Boolean);
  // ราคาขายของแต่ละชิ้นตอนค่ายพักนี้ — จังหวะรายวัน (พ่อค้าอยากได้ของบางชิ้น → แพงขึ้น, เปลี่ยนทุกวัน)
  // เมืองยิ่งไกล รับซื้อแพงขึ้น (x1.05/เมือง) · ตลาดมืดรับซื้อของขวัญ (junk) แพงกว่าปกติ +25% — ปรับราคาที่โชว์ให้ตรงกับที่จ่ายจริง
  const inventory = getInventory(c.id);
  const sellPrices = Object.fromEntries(inventory.map((inv) => {
    const sp = campSellPrice(inv, dayKey, c.city_index);
    if (bm && inv.type === 'junk') sp.price = Math.round(sp.price * BM_JUNK_MULT);
    return [inv.item_id, sp];
  }));
  // สูตรคราฟต์ที่เรียนรู้แล้ว (จากแบบแปลน) — พร้อมสถานะวัสดุในกระเป๋า (โชว์ในแท็บ 🛠️ คราฟต์)
  const recipes = getLearnedRecipes(c.id).map((rid) => {
    const rc = RECIPE_BY_ID[rid];
    if (!rc) return null;
    const result = ITEM_BY_ID[rc.result.id];
    return {
      id: rc.id, name: rc.name, icon: rc.icon, desc: rc.desc,
      result: { id: result?.id, name: result?.name, icon: result?.icon, qty: rc.result.qty },
      materials: rc.materials.map((m) => {
        const it = ITEM_BY_ID[m.id];
        return { id: m.id, name: it?.name, icon: it?.icon, qty: m.qty, have: inventory.find((x) => x.item_id === m.id)?.qty || 0 };
      }),
    };
  }).filter(Boolean);
  res.json({
    ...serialize(c),
    inventory,
    sellPrices,
    shop,
    festival: fest || null,
    blackMarket: bm ? { items: shop.filter((s) => s.bm), junkMult: BM_JUNK_MULT } : null,
    // ภารกิจ deterministic ต่อค่ายพัก (seed = visit — กลับเข้าค่ายเดิมได้ชุดเดิม) + สถานะทำแล้ว (กันทำซ้ำโดยสลับหน้าหลัก/ค่าย)
    quests: rollQuests(c.level, 3, visit),
    doneQuests: Object.fromEntries(db.prepare('SELECT quest_id FROM camp_quest_done WHERE character_id = ? AND visit = ?').all(c.id, visit).map((r) => [r.quest_id, true])),
    recipes,
    trophies: getTrophies(c.id),
  });
});

router.post('/shop/buy', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId, visit } = req.body || {};
  const item = ITEM_BY_ID[itemId];
  if (!item) return res.status(400).json({ error: 'ไอเทมไม่มีอยู่' });
  if (item.type !== 'consumable' && (item.lvl || 1) > c.level + 1) return res.status(400).json({ error: 'เลเวลยังไม่พอจะใช้ของแบบนี้' });
  if (!visit) return res.status(400).json({ error: 'ต้องระบุค่ายพักก่อนซื้อ' });
  const row = db.prepare('SELECT qty, market FROM camp_shop WHERE character_id = ? AND visit = ? AND item_id = ?').get(c.id, visit, itemId);
  if (!row) return res.status(400).json({ error: 'สินค้านี้ไม่อยู่ในร้านค่ายพักนี้' });
  if (row.qty >= 1) return res.status(400).json({ error: 'ซื้อได้ครั้งเดียวต่อค่ายพัก — ขายหมดแล้ว' });
  // ของแถมฟรี (พ่อค้า/ตลาดมืดไม่อยากได้ — ราคา 0) — คำนวณซ้ำจาก stock เดียวกับหน้า /camp (deterministic จาก visit)
  const stockRows = db.prepare('SELECT item_id, qty, market FROM camp_shop WHERE character_id = ? AND visit = ?').all(c.id, visit);
  const freebieId = campFreebieId(visit, c, stockRows);
  // ราคาตามแหล่งที่มา: ร้านปกติ = ราคาตลาดวันนี้ · ตลาดมืด = ราคาลดพิเศษ (เท่ากับที่โชว์ใน /camp)
  // โหมดโหด: ของทุกอย่างแพงขึ้น x1.3 (ราคาที่โชว์ในร้านก็ปรับให้ตรง)
  let price, fromBm = false, fromFree = false;
  if (itemId === freebieId) {
    price = 0;
    fromFree = true;
  } else if (row.market === 'black') {
    const bm = blackMarketStock(visit);
    const bmItem = bm?.find((x) => x.id === itemId);
    if (!bmItem) return res.status(400).json({ error: 'ของชิ้นนี้ไม่อยู่ในตลาดมืดค่ายนี้' });
    price = Math.round(bmItem.bmPrice * priceMult(c));
    fromBm = true;
  } else if (row.market === 'festival') {
    price = Math.round(item.price * 0.8 * priceMult(c)); // สินค้าเทศกาล — ลด 20%
  } else {
    price = Math.round(marketPrice(item, today()).price * priceMult(c));
  }
  if (c.gold < price) return res.status(400).json({ error: `ทองไม่พอ! (ต้องใช้ ${price} ทอง)` });
  // กระเป๋าเต็ม + ยังไม่เคยมีของชนิดนี้ → บล็อกการซื้อ (ต้องขายของก่อน)
  // กล่องลึกลับ: เช็คของที่จะได้ (เปิดหน้าเดิม deterministic) ก่อนตัดเงิน
  const boxItem = itemId === MYSTERY_BOX_ID ? mysteryBoxRoll(visit, c) : null;
  const willAdd = boxItem ? boxItem.id : itemId;
  const preCheck = acquireItem(c, willAdd, 1, { fullMode: 'block', checkOnly: true });
  if (preCheck.blocked) {
    return res.status(400).json({ error: `🎒 กระเป๋าเต็ม (${preCheck.used}/${preCheck.cap}) — ขายของก่อนซื้อ (${preCheck.item?.icon} ${preCheck.item?.name} จะใช้ช่องใหม่)` });
  }
  c.gold -= price;
  // กล่องลึกลับ — เปิดเลย ไม่เข้าสู่กระเป๋า (สุ่ม deterministic จากค่ายพัก — เปิดหน้าเดิมได้ของเดิม)
  if (boxItem) {
    acquireItem(c, boxItem.id, 1, { fullMode: 'block' }); // เช็คผ่านแล้ว → เพิ่มได้
  } else {
    acquireItem(c, itemId, 1, { fullMode: 'block' });
  }
  db.prepare('UPDATE camp_shop SET qty = qty + 1 WHERE character_id = ? AND visit = ? AND item_id = ?').run(c.id, visit, itemId);
  updateCharacter(c);
  addLog(c.id, {
    type: 'shop',
    title: fromFree ? '🎁 ของแถมฟรี' : boxItem ? '🎁 เปิดกล่องลึกลับ' : fromBm ? '🖤 ซื้อของตลาดมืด' : '🛒 ซื้อของ',
    detail: boxItem ? `เปิด ${item.icon} ${item.name} ได้ ${boxItem.icon} ${boxItem.name}` : fromFree ? `ได้ ${item.icon} ${item.name} ฟรี (พ่อค้าไม่อยากได้ — ของแถม)` : `ซื้อ ${item.icon} ${item.name} (-${price} ทอง)${fromBm ? ' (ตลาดมืด)' : ''}`,
    gold: -price,
  });
  bumpDaily(c.id, 'items_bought', 1);
  let ach = { fresh: [], ups: 0 };
  if (fromBm || fromFree) {
    const prog = getProgress(c.id);
    if (fromBm) {
      // นับการค้ากับตลาดมืด (ตรา "สายค้าตลาดมืด" + เควสประจำวัน)
      bumpDaily(c.id, 'bm_trades', 1);
      prog.bm_buys = (prog.bm_buys || 0) + 1;
    }
    if (fromFree) prog.freebies = (prog.freebies || 0) + 1; // เก็บของแถม (ตรา "นักเก็บของแถม")
    db.prepare('UPDATE progress SET bm_buys = ?, freebies = ? WHERE id = ?').run(prog.bm_buys || 0, prog.freebies || 0, prog.id);
    ach = checkAchievements(c, prog);
  }
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: fromFree ? `🎁 ของแถม! ได้ ${item.name} ฟรี (พ่อค้าไม่อยากได้)` : boxItem ? `🎁 เปิด ${item.name} แล้ว! ได้ ${boxItem.icon} ${boxItem.name}` : `ซื้อ ${item.name} สำเร็จ (-${price} ทอง)`, achievements: ach.fresh, ...dailyPayload(c) });
});

router.post('/shop/sell', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId, qty = 1 } = req.body || {};
  const inv = getInventory(c.id).find((i) => i.item_id === itemId);
  if (!inv || inv.qty < qty) return res.status(400).json({ error: 'ไม่มีไอเทมพอจะขาย' });
  // ราคาขายตามวันนี้ (พ่อค้าต้องการของบางชิ้น → แพงขึ้น) + เมืองยิ่งไกลขายแพงขึ้น — ราคาเดียวกับที่โชว์ใน /camp
  const sell = campSellPrice(inv, today(), c.city_index);
  // ตลาดมืดรับซื้อของขวัญ (junk) แพงกว่าปกติ +25% — สำรวจเมืองเดิมต่อ → เจอบ่อยขึ้น
  const bmOpen = req.body.visit ? blackMarketOpen(req.body.visit, bmExtraChance(c)) : false;
  const toBm = bmOpen && inv.type === 'junk';
  const price = toBm ? Math.round(sell.price * BM_JUNK_MULT) : sell.price;
  const gain = price * qty;
  c.gold += gain;
  db.prepare('UPDATE inventory SET qty = qty - ? WHERE character_id = ? AND item_id = ?').run(qty, c.id, itemId);
  updateCharacter(c);
  const detail = toBm
    ? `ขาย ${inv.icon} ${inv.name} x${qty} ให้ตลาดมืด (+${gain} ทอง)`
    : sell.wanted
      ? `ขาย ${inv.icon} ${inv.name} x${qty} ให้พ่อค้าที่ต้องการของ (+${gain} ทอง)`
      : `ขาย ${inv.icon} ${inv.name} x${qty} (+${gain} ทอง)`;
  addLog(c.id, { type: 'shop', title: '💰 ขายของ', detail, gold: gain });
  // เควสประจำวัน "คนเก็บขยะ" — ขายของขวัญ (junk) นับชิ้น · ตลาดมืด — ขายให้ตลาดมืดนับการค้า
  if (inv.type === 'junk') bumpDaily(c.id, 'junk_sold', qty);
  if (toBm) bumpDaily(c.id, 'bm_trades', qty);
  // นับจำนวนที่ขายให้พ่อค้าที่ต้องการ (achievement สายพ่อค้า)
  let ach = { fresh: [], ups: 0 };
  if (sell.wanted) {
    const prog = getProgress(c.id);
    prog.wanted_sales = (prog.wanted_sales || 0) + qty;
    db.prepare('UPDATE progress SET wanted_sales = ? WHERE id = ?').run(prog.wanted_sales, prog.id);
    ach = checkAchievements(c, prog);
  }
  res.json({
    ...serialize(c),
    inventory: getInventory(c.id),
    achievements: ach.fresh,
    levelUps: { levels: ach.ups, statPoints: c.stat_points },
    message: toBm ? `🖤 ตลาดมืดรับซื้อแพงกว่า! ได้ +${gain} ทอง` : sell.wanted ? `🔥 พ่อค้าต้องการของชิ้นนี้! ได้ +${gain} ทอง` : `ขายได้ +${gain} ทอง`,
  });
});

router.post('/inventory/use', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId } = req.body || {};
  const inv = getInventory(c.id).find((i) => i.item_id === itemId);
  if (!inv) return res.status(400).json({ error: 'ไม่มีไอเทมนี้' });
  const item = ITEM_BY_ID[itemId];
  const stats = computeStats(c);
  let used = false;
  let ups = 0;

  // แบบแปลนสูตรคราฟต์ — ใช้แล้วเรียนรู้สูตร (เรียนซ้ำไม่ได้ เหมือนคัมภีร์สกิล)
  if (item.type === 'blueprint') {
    const rc = RECIPE_BY_ID[item.learn_recipe];
    if (!rc) return res.status(400).json({ error: 'แบบแปลนนี้ใช้ไม่ได้' });
    if (getLearnedRecipes(c.id).includes(rc.id)) return res.status(400).json({ error: `เรียนรู้สูตร ${rc.name} ไปแล้ว — แบบแปลนซ้ำใช้ไม่ได้` });
    learnRecipe(c.id, rc.id);
    db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
    addLog(c.id, { type: 'recipe_learn', title: `📋 เรียนรู้สูตรใหม่: ${rc.icon} ${rc.name}`, detail: `จาก ${item.name} — ไปคราฟต์ได้ที่แท็บ 🛠️ คราฟต์ในค่ายพัก` });
    const ach = checkAchievements(c, getProgress(c.id));
    return res.json({
      ...serialize(c), inventory: getInventory(c.id),
      message: `📋 เรียนรู้สูตร ${rc.name} แล้ว! ไปคราฟต์ที่ค่ายพัก`,
      achievements: ach.fresh,
      ...dailyPayload(c),
      levelUps: { levels: ach.ups, statPoints: c.stat_points },
    });
  }

  // คัมภีร์สกิลหายาก — ใช้แล้วเรียนรู้สกิลใหม่ (เรียนซ้ำไม่ได้)
  if (item.type === 'scroll') {
    const sk = SCROLL_SKILL_BY_ID[item.learn_skill];
    if (!sk) return res.status(400).json({ error: 'คัมภีร์นี้ใช้ไม่ได้' });
    if (getSkillRow(c.id, sk.id)) return res.status(400).json({ error: `เรียนรู้สกิล ${sk.name} ไปแล้ว — คัมภีร์ซ้ำใช้ไม่ได้` });
    learnSkill(c.id, sk.id, 'scroll');
    db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
    addLog(c.id, { type: 'skill_learn', title: `📖 เรียนรู้สกิลใหม่: ${sk.icon} ${sk.name}`, detail: `จาก ${item.name} — ใช้สู้บอสได้เลย! (${sk.mp} MP)` });
    const ach = checkAchievements(c, getProgress(c.id));
    return res.json({
      ...serialize(c), inventory: getInventory(c.id),
      message: `📖 เรียนรู้สกิล ${sk.name} แล้ว!`,
      achievements: ach.fresh,
      ...dailyPayload(c),
      levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
    });
  }

  // 🥚 ไข่ปริศนา — ใช้แล้วเริ่มฟัก: ยังไม่ฟักทันที ต้องจบ 1 session (adventure/complete) ไข่ถึงจะฟัก (สุ่ม rarity ตอนฟักจริง — ไม่สปอยล์)
  if (item.use_egg) {
    const prog = getProgress(c.id);
    const slots = prog.pet_slots || 1;
    const petCount = getPets(c.id).length;
    if (petCount >= slots) return res.status(400).json({ error: `🐾 คอกสัตว์เต็ม (${petCount}/${slots}) — ปล่อยตัวหนึ่งก่อน หรือใช้ 💳 บัตรขยายคอก` });
    if (c.hatch_pending) return res.status(400).json({ error: '🥚 มีไข่กำลังฟักอยู่แล้ว — รอให้ฟักหลังจบ 1 session ก่อนใช้ใบใหม่' });
    c.hatch_pending = 1;
    updateCharacter(c);
    db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
    addLog(c.id, { type: 'pet_incubate', title: '🥚 ไข่เริ่มฟัก', detail: 'ไข่ปริศนาเริ่มฟักแล้ว — จะฟักออกมาเป็นสัตว์เลี้ยงหลังจบ 1 session โฟกัส!' });
    return res.json({
      ...serialize(c), inventory: getInventory(c.id),
      message: '🥚 ไข่เริ่มฟักแล้ว! จะฟักออกมาหลังจบ 1 session โฟกัส — ไปโฟกัสงานกันเถอะ!',
      ...dailyPayload(c),
      levelUps: { levels: 0, statPoints: c.stat_points },
    });
  }

  // 💳 บัตรขยายคอก — ใช้แล้วขยายช่องเลี้ยงสัตว์ +1 (เริ่ม 1 ช่อง สูงสุด 4)
  if (item.use_stall) {
    const prog = getProgress(c.id);
    const cur = prog.pet_slots || 1;
    if (cur >= PET_MAX_SLOTS) return res.status(400).json({ error: `คอกสัตว์เต็มที่แล้ว (${PET_MAX_SLOTS} ช่อง) — ใช้บัตรเพิ่มไม่ได้` });
    prog.pet_slots = cur + 1;
    db.prepare('UPDATE progress SET pet_slots = ? WHERE id = ?').run(prog.pet_slots, prog.id);
    db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
    addLog(c.id, { type: 'pet_stall', title: '💳 ขยายคอกสัตว์', detail: `ขยายคอกสัตว์เป็น ${prog.pet_slots}/${PET_MAX_SLOTS} ช่อง — เลี้ยงสัตว์เลี้ยงได้มากขึ้น!` });
    return res.json({
      ...serialize(c), inventory: getInventory(c.id),
      message: `💳 ขยายคอกสัตว์เป็น ${prog.pet_slots}/${PET_MAX_SLOTS} ช่องแล้ว!`,
      ...dailyPayload(c),
      levelUps: { levels: 0, statPoints: c.stat_points },
    });
  }

  // 🎁 ของขวัญจ้าวมังกรทอง — เปิดที่ค่ายพัก: สุ่มรางวัลพิเศษ (🏆 ถ้วย 40% / 💛 หัวใจ 30% / 👑 มงกุฎ 20% / ถุงทอง 10%)
  if (item.use_gift) {
    const roll = Math.random();
    const reward = roll < 0.4 ? ITEM_BY_ID[190] : roll < 0.7 ? ITEM_BY_ID[191] : roll < 0.9 ? ITEM_BY_ID[192] : null;
    db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
    let detail, message, gold = 0;
    if (reward) {
      const got = acquireItem(c, reward.id, 1, { fullMode: 'sell' });
      const bagNote = got.sold ? ` (🎒 กระเป๋าเต็ม — ขายอัตโนมัติ +${got.gold} ทอง)` : '';
      detail = `เปิดของขวัญ ได้ ${reward.icon} ${reward.name}! (ขายได้ ${reward.price} ทอง)${bagNote}`;
      message = `🎁 เปิดของขวัญ ได้ ${reward.icon} ${reward.name}!`;
    } else {
      gold = 250;
      c.gold += gold;
      detail = `เปิดของขวัญ เจอถุงทองจ้าวมังกร! (+${gold} ทอง)`;
      message = `🎁 เจอถุงทองจ้าวมังกร! +${gold} ทอง`;
    }
    updateCharacter(c);
    addLog(c.id, { type: 'gift_open', title: '🎁 เปิดของขวัญจ้าวมังกรทอง', detail, gold });
    const ach = checkAchievements(c, getProgress(c.id));
    return res.json({
      ...serialize(c), inventory: getInventory(c.id),
      message,
      achievements: ach.fresh,
      ...dailyPayload(c),
      levelUps: { levels: ach.ups, statPoints: c.stat_points },
    });
  }

  // 🛡️ โล่โฟกัส — ใช้แล้วติดตั้งโล่กันคอมโบ 1 ครั้ง (มีอยู่แล้วใช้ซ้ำไม่ได้)
  if (item.use_shield) {
    const sh = getProgress(c.id);
    if (sh.combo_shield > 0) return res.status(400).json({ error: '🛡️ โล่โฟกัสติดตั้งอยู่แล้ว — กันคอมโบหายได้อีก 1 ครั้ง' });
    sh.combo_shield = 1;
    db.prepare('UPDATE progress SET combo_shield = 1 WHERE id = ?').run(sh.id);
    addLog(c.id, { type: 'shield', title: '🛡️ ติดตั้งโล่โฟกัส', detail: 'กันคอมโบโฟกัสหาย 1 ครั้ง — ครั้งหน้าที่พัก/ทิ้ง session คอมโบจะไม่หาย (โล่จะแตก)' });
    used = true;
  }
  if (item.heal_pct && c.hp < stats.maxHp) { c.hp = Math.min(stats.maxHp, c.hp + Math.round(stats.maxHp * item.heal_pct)); used = true; }
  if (item.mana_pct && c.mp < stats.maxMp) { c.mp = Math.min(stats.maxMp, c.mp + Math.round(stats.maxMp * item.mana_pct)); used = true; }
  if (item.use_gold) { c.gold += item.use_gold; used = true; }
  if (item.use_xp) { ups += gainXp(c, item.use_xp); used = true; }
  if (!used) return res.status(400).json({ error: 'พลังเต็มอยู่แล้ว' });
  db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
  updateCharacter(c);
  bumpDaily(c.id, 'potions');
  const ach = checkAchievements(c, getProgress(c.id));
  res.json({
    ...serialize(c), inventory: getInventory(c.id),
    message: `ใช้ ${item.name} เรียบร้อย`,
    achievements: ach.fresh,
    ...dailyPayload(c),
    levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
  });
});

// ----- สัตว์เลี้ยง: สลับตัวที่ใช้งาน / ปล่อย (คอกเต็มต้องปล่อยก่อน — ได้ทองปลอบใจ) -----
router.post('/pet/swap', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { petId } = req.body || {};
  if (!getPet(c.id, petId)) return res.status(400).json({ error: 'ไม่มีสัตว์เลี้ยงตัวนี้ในคอก' });
  setActivePet(c.id, petId);
  const def = PET_BY_ID[petId];
  addLog(c.id, { type: 'pet_swap', title: '🐾 สลับสัตว์เลี้ยง', detail: `ตั้ง ${def?.icon || ''} ${def?.name || petId} เป็นตัวที่ใช้งาน — ค่าพิเศษของมันมีผลแล้ว!` });
  res.json({ ...serialize(c), message: `🐾 ตั้ง ${def?.icon || ''} ${def?.name || petId} เป็นตัวที่ใช้งานแล้ว` });
});

router.post('/pet/release', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { petId } = req.body || {};
  const row = getPet(c.id, petId);
  if (!row) return res.status(400).json({ error: 'ไม่มีสัตว์เลี้ยงตัวนี้ในคอก' });
  const def = PET_BY_ID[petId];
  const gold = 20 + (row.level - 1) * 10; // ทองปลอบใจตามเลเวล
  releasePet(c.id, petId);
  c.gold += gold;
  updateCharacter(c);
  addLog(c.id, { type: 'pet_release', title: '🕊️ ปล่อยสัตว์เลี้ยง', detail: `ปล่อย ${def?.icon || ''} ${def?.name || petId} (Lv.${row.level}) เป็นอิสระ — ได้ทองปลอบใจ ${gold}` });
  res.json({ ...serialize(c), message: `🕊️ ปล่อย ${def?.icon || ''} ${def?.name || petId} เป็นอิสระแล้ว — ได้ทองปลอบใจ +${gold}` });
});

// ----- คราฟต์ (ต้องเรียนรู้สูตรจากแบบแปลนก่อน — วัสดุคือของขวัญ junk ในกระเป๋า) -----
router.post('/craft', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { recipeId } = req.body || {};
  const rc = RECIPE_BY_ID[recipeId];
  if (!rc) return res.status(400).json({ error: 'สูตรคราฟต์ไม่พบ' });
  if (!getLearnedRecipes(c.id).includes(rc.id)) return res.status(400).json({ error: 'ยังไม่รู้สูตรนี้ — ต้องเรียนรู้จากแบบแปลนก่อน' });
  const inv = getInventory(c.id);
  for (const m of rc.materials) {
    const have = inv.find((i) => i.item_id === m.id)?.qty || 0;
    if (have < m.qty) {
      const it = ITEM_BY_ID[m.id];
      return res.status(400).json({ error: `วัสดุไม่พอ: ${it?.icon || ''} ${it?.name || m.id} ต้องใช้ ${m.qty} ชิ้น (มี ${have})` });
    }
  }
  // กระเป๋าเต็ม + ยังไม่เคยมีของที่คราฟต์ได้ → บล็อก (กันของที่คราฟต์ไปโดนขาย/หาย)
  const result = ITEM_BY_ID[rc.result.id];
  const preCheck = acquireItem(c, result.id, rc.result.qty || 1, { fullMode: 'block', checkOnly: true });
  if (preCheck.blocked) {
    return res.status(400).json({ error: `🎒 กระเป๋าเต็ม (${preCheck.used}/${preCheck.cap}) — ขายของก่อนคราฟต์ (${result.icon} ${result.name} จะใช้ช่องใหม่)` });
  }
  for (const m of rc.materials) {
    db.prepare('UPDATE inventory SET qty = qty - ? WHERE character_id = ? AND item_id = ?').run(m.qty, c.id, m.id);
  }
  acquireItem(c, result.id, rc.result.qty || 1, { fullMode: 'block' }); // เช็คผ่านแล้ว → เพิ่มได้
  const matLabel = rc.materials.map((m) => `${ITEM_BY_ID[m.id]?.icon} ${ITEM_BY_ID[m.id]?.name} x${m.qty}`).join(' + ');
  addLog(c.id, { type: 'craft', title: `🛠️ คราฟต์: ${rc.icon} ${rc.name}`, detail: `${matLabel} → ได้ ${result.icon} ${result.name} x${rc.result.qty || 1}` });
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `🛠️ คราฟต์ ${result.icon} ${result.name} สำเร็จ!` });
});

const SLOT_NAMES = {
  weapon_id: 'อาวุธ (มือหลัก)', offhand_id: 'มือรอง', head_id: 'หมวก', armor_id: 'เกราะตัว',
  arms_id: 'แขน', legs_id: 'ขา', feet_id: 'เท้า',
  accessory_id: 'เครื่องประดับ', accessory_2_id: 'เครื่องประดับ 2', accessory_3_id: 'เครื่องประดับ 3', accessory_4_id: 'เครื่องประดับ 4',
};

// หาช่องที่จะสวมตามชนิดไอเทม (อาวุธสองมือปิดมือรอง ฯลฯ)
const pickEquipSlot = (c, item, addItemFn) => {
  const twoHanded = (id) => !!id && ITEM_BY_ID[id]?.handed === 2;

  if (item.type === 'weapon') {
    if (item.handed === 2) {
      // สองมือ → มือหลัก + เคลียร์มือรอง (คืนกระเป๋า)
      if (c.offhand_id) { addItemFn(c.offhand_id); c.offhand_id = null; }
      return 'weapon_id';
    }
    if (!c.weapon_id) return 'weapon_id';             // มือหลักว่าง → มือหลัก
    if (twoHanded(c.weapon_id)) {                      // มือหลักถือสองมือ → สลับอาวุธหลัก
      addItemFn(c.weapon_id);
      c.weapon_id = null;
      return 'weapon_id';
    }
    return 'offhand_id';                              // มือเดียว → มือรอง (แทนที่ของเดิมถ้ามี)
  }
  if (item.type === 'shield') {
    if (twoHanded(c.weapon_id)) return null;          // ถือสองมือ ใส่โล่ไม่ได้
    return 'offhand_id';
  }
  if (item.type === 'armor') return 'armor_id';
  if (item.type === 'head') return 'head_id';
  if (item.type === 'arms') return 'arms_id';
  if (item.type === 'legs') return 'legs_id';
  if (item.type === 'feet') return 'feet_id';
  if (item.type === 'accessory') {
    return ['accessory_id', 'accessory_2_id', 'accessory_3_id', 'accessory_4_id'].find((s) => !c[s]) || 'accessory_id';
  }
  return null;
};

router.post('/inventory/equip', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId } = req.body || {};
  const inv = getInventory(c.id).find((i) => i.item_id === itemId);
  if (!inv) return res.status(400).json({ error: 'ไม่มีไอเทมนี้' });
  const item = ITEM_BY_ID[itemId];
  if (!item || item.type === 'consumable') return res.status(400).json({ error: 'ไอเทมนี้ใช้ไม่ได้กับช่องสวมใส่' });
  // ข้อจำกัด: เลเวล / เฉพาะคลาส / ค่าสถานะขั้นต่ำ
  const block = equipBlockReason(c, item);
  if (block) return res.status(400).json({ error: `สวมไม่ได้: ${block}` });

  const slot = pickEquipSlot(c, item, (id) => addItem(c.id, id, 1));
  if (!slot) return res.status(400).json({ error: 'ถืออาวุธสองมืออยู่ — ถอดอาวุธออกก่อนถึงจะถือโล่ได้' });

  // ถอดของเก่าในช่องคืนกระเป๋า แล้วใส่ของใหม่
  const oldId = c[slot];
  if (oldId) addItem(c.id, oldId, 1);
  db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
  c[slot] = itemId;
  updateCharacter(c);
  addLog(c.id, { type: 'equip', title: '🔧 สวมใส่', detail: `สวม ${item.icon} ${item.name} (${SLOT_NAMES[slot]})` });
  const ach = checkAchievements(c, getProgress(c.id));
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `สวม ${item.name} (${SLOT_NAMES[slot]})`, achievements: ach.fresh, levelUps: { levels: ach.ups, statPoints: c.stat_points } });
});

router.post('/inventory/unequip', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { slot } = req.body || {};
  if (!SLOT_COLS.includes(slot)) return res.status(400).json({ error: 'ช่องสวมใส่ไม่ถูกต้อง' });
  const id = c[slot];
  if (!id) return res.status(400).json({ error: 'ช่องนี้ว่างอยู่แล้ว' });
  const item = ITEM_BY_ID[id];
  addItem(c.id, id, 1);
  c[slot] = null;
  updateCharacter(c);
  addLog(c.id, { type: 'unequip', title: '📦 ถอดอุปกรณ์', detail: `ถอด ${item?.icon || ''} ${item?.name || 'ไอเทม'} (${SLOT_NAMES[slot]})` });
  const ach = checkAchievements(c, getProgress(c.id));
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `ถอด ${item?.name || 'ไอเทม'} แล้ว`, achievements: ach.fresh, levelUps: { levels: ach.ups, statPoints: c.stat_points } });
});

router.post('/camp/rest', (req, res) => {
  const c = requireChar(res); if (!c) return;
  // โหมดเอาชีวิตรอด: พักแคมป์ไม่ฟื้นพลังฟรี — ต้องใช้ยา/สมุนไพรเอง
  if (c.challenge_mode === 'survival') {
    return res.status(400).json({ error: '🩸 โหมดเอาชีวิตรอด: พักแคมป์ไม่ฟื้นพลังฟรี — ใช้ยา/สมุนไพรในกระเป๋า หรือสู้ต่อ!' });
  }
  const stats = computeStats(c);
  c.hp = stats.maxHp; c.mp = stats.maxMp;
  updateCharacter(c);
  addLog(c.id, { type: 'rest', title: '🔥 พักแคมป์', detail: 'นอนพักข้างกองไฟ — พลังเต็มเปี่ยม!' });
  res.json({ ...serialize(c), message: 'พักผ่อนจนพลังเต็มแล้ว!' });
});

// ----- ภารกิจประจำวัน (Daily Quest) -----
router.get('/daily', (req, res) => {
  const c = requireChar(res); if (!c) return;
  res.json(dailyPayload(c));
});

router.post('/daily/claim', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { questId, reward } = req.body || {};
  const result = claimDailyQuest(c, questId, reward);
  if (result.error) return res.status(400).json({ error: result.error });
  const msg = result.rewardType === 'item'
    ? `🎁 ได้ ${result.item.icon} ${result.item.name}!`
    : result.rewardType === 'xp'
      ? `✨ รับ XP +${result.xp}!`
      : `💰 รับทอง +${result.gold}!`;
  res.json({
    ...serialize(c),
    ...dailyPayload(c),
    reward: result,
    levelUps: { levels: result.ups || 0, statPoints: c.stat_points },
    message: `📅 ${msg}`,
  });
});

router.post('/daily/claim-all', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const result = claimDailyAll(c);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({
    ...serialize(c),
    ...dailyPayload(c),
    reward: { gold: result.gold, xp: result.xp, item: result.item },
    levelUps: { levels: result.ups, statPoints: c.stat_points },
    message: `🎁 รับโบนัส +${result.gold} ทอง${result.item ? ` และได้ ${result.item.icon} ${result.item.name}` : ''}!`,
  });
});

// ----- ภารกิจ -----
router.post('/quest/do', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { questId, visit } = req.body || {};
  const quest = QUESTS.find((q) => q.id === questId);
  if (!quest) return res.status(400).json({ error: 'ภารกิจไม่พบ' });
  // ทำได้ 1 ครั้งต่อค่ายพัก — เช็คจาก visit (กันทำซ้ำโดยกดกลับหน้าหลักแล้วกลับมาค่ายเดิม)
  if (visit) {
    const already = db.prepare('SELECT 1 FROM camp_quest_done WHERE character_id = ? AND visit = ? AND quest_id = ?').get(c.id, visit, questId);
    if (already) return res.status(400).json({ error: 'ทำภารกิจนี้ไปแล้วในค่ายพักนี้' });
  }
  const result = resolveQuest(c, quest);
  updateCharacter(c);
  let bagNote = '';
  if (result.item) {
    const got = acquireItem(c, result.item.id, 1, { fullMode: 'sell' });
    if (got.sold) bagNote = ` (🎒 กระเป๋าเต็ม — ขาย ${result.item.icon} ${result.item.name} อัตโนมัติ +${got.gold} ทอง)`;
  }
  updateCharacter(c);
  addLog(c.id, { type: result.success ? 'quest_win' : 'quest_fail', title: `📜 ${quest.title}`, detail: result.detail + bagNote, xp: result.xp, gold: result.gold });
  // นับภารกิจที่ทำสำเร็จ
  const prog = getProgress(c.id);
  if (result.success) {
    prog.quests_completed += 1;
    db.prepare('UPDATE progress SET quests_completed = ? WHERE id = ?').run(prog.quests_completed, prog.id);
  }
  bumpDaily(c.id, 'camp_quests');
  // บันทึกว่าทำภารกิจนี้ในค่ายพักนี้แล้ว (สำเร็จหรือไม่ก็ตาม — ทำได้ครั้งเดียวต่อพัก) — กันทำซ้ำโดยสลับหน้าหลัก/ค่าย
  if (visit) db.prepare('INSERT OR IGNORE INTO camp_quest_done (character_id, visit, quest_id) VALUES (?, ?, ?)').run(c.id, visit, questId);
  const ach = checkAchievements(c, prog);
  res.json({
    ...serialize(c), result, inventory: getInventory(c.id),
    achievements: ach.fresh,
    progress: getProgress(c.id),
    ...dailyPayload(c),
    levelUps: { levels: (result.ups || 0) + ach.ups, statPoints: c.stat_points },
  });
});

// ----- เควสต์เนื้อเรื่อง (Story Quest) — ปลดล็อกตามความคืบหน้า รับรางวัลครั้งเดียว -----
router.get('/story', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const prog = getProgress(c.id);
  const done = new Set(db.prepare('SELECT quest_id FROM story_quest_done WHERE character_id = ?').all(c.id).map((r) => r.quest_id));
  const quests = STORY_QUESTS.map((q) => {
    const met = storyReqMet(q, c, prog);
    return {
      ...q,
      status: done.has(q.id) ? 'done' : met ? 'claimable' : 'locked',
      reqLabel: storyReqLabel(q, c, prog),
      city: CITIES[q.city % CITIES.length],
      cityIndex: q.city % CITIES.length,
    };
  });
  res.json({ quests, doneCount: done.size, total: STORY_QUESTS.length });
});

router.post('/story/claim', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { questId } = req.body || {};
  const q = STORY_QUESTS.find((x) => x.id === questId);
  if (!q) return res.status(400).json({ error: 'เควสต์เนื้อเรื่องไม่พบ' });
  const prog = getProgress(c.id);
  if (db.prepare('SELECT 1 FROM story_quest_done WHERE character_id = ? AND quest_id = ?').get(c.id, questId)) {
    return res.status(400).json({ error: 'รับรางวัลเควสต์นี้ไปแล้ว' });
  }
  if (!storyReqMet(q, c, prog)) return res.status(400).json({ error: 'ยังไม่ผ่านเงื่อนไขของเควสต์นี้' });
  db.prepare('INSERT INTO story_quest_done (character_id, quest_id) VALUES (?, ?)').run(c.id, questId);
  let ups = 0;
  if (q.reward.gold) c.gold += q.reward.gold;
  if (q.reward.xp) ups = gainXp(c, q.reward.xp);
  updateCharacter(c);
  addLog(c.id, { type: 'story', title: `📖 ${q.title}`, detail: `ทำเควสต์เนื้อเรื่องสำเร็จ (+${q.reward.gold || 0} ทอง, +${q.reward.xp || 0} XP)`, xp: q.reward.xp || 0, gold: q.reward.gold || 0 });
  const ach = checkAchievements(c, prog);
  res.json({
    ...serialize(c),
    progress: getProgress(c.id),
    achievements: ach.fresh,
    levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
    message: `📖 ${q.title} สำเร็จ! (+${q.reward.gold || 0} ทอง, +${q.reward.xp || 0} XP)`,
  });
});

// ----- บอส (long break) -----
const fightFlags = (f) => ({
  rage: !!f?.bossRage,      // 😡 โกรธจัด (HP ≤ 50% — ATK พุ่ง + ท่าไม้ตายบ่อยขึ้น)
  fury: !!f?.bossFury,      // 🔥 สุดทน (สู้ยืดเยื้อเกิน 30 เทิร์น — ATK พุ่งถาวร)
  charging: !!f?.bossCharging, // ⚠️ กำลังชาร์จท่าไม้ตาย (โจมตีให้ถึงเกณฑ์เพื่อสลาย)
  stun: !!f?.bossStun,
  armor: !!f?.bossGuard,    // 🛡️ เกราะมหึมา/เกราะแข็งติดอยู่ (บอสกันดาเมจ)
  dodge: !!f?.bossDodge,    // 💨 เงามายา — บอสหลบโจมตี
  armorTurns: f?.bossGuard?.turns || 0,
  dodgeTurns: f?.bossDodge?.turns || 0,
});

router.get('/boss', (req, res) => {
  const c = requireChar(res); if (!c) return;
  let fight = fights.get(c.id);
  if (!fight) {
    // บอสเร่ร่อนรายสัปดาห์ — สุ่มมาแทนบอสปกติของเมืองในบางสัปดาห์ (deterministic จากสัปดาห์+ตัวละคร+เมือง)
    // POMOQUEST_NO_WANDER=1 ปิดบอสเร่ร่อน (ใช้ในเทสต์ — กันผลขึ้นกับสัปดาห์จริง) · POMOQUEST_WEEK=... บังคับสัปดาห์ (dev)
    const weekKey = process.env.POMOQUEST_WEEK || db.prepare("SELECT strftime('%Y-W%W','now','localtime') AS w").get().w;
    const wander = process.env.POMOQUEST_NO_WANDER ? null : wanderingBossAt(weekKey, c, c.city_index);
    fight = { boss: generateBoss(c.level, c.city_index, c, wander) };
    fights.set(c.id, fight);
  }
  res.json({ ...serialize(c), boss: { ...fight.boss, hp: fight.boss.hp }, fight: fightFlags(fight) });
});

router.post('/boss/act', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const fight = fights.get(c.id);
  if (!fight) return res.status(400).json({ error: 'ยังไม่เริ่มสู้บอส' });
  const { action, itemId, skillId } = req.body || {};
  c.inv = getInventory(c.id);
  const result = bossPlayerTurn(c, fight, action, itemId, skillId);
  if (result.error) return res.status(400).json({ error: result.error });

  updateCharacter(c);

  const prog = getProgress(c.id);
  if (action === 'potion' && !result.error) {
    prog.boss_potions += 1;
    db.prepare('UPDATE progress SET boss_potions=? WHERE id=?').run(prog.boss_potions, prog.id);
    bumpDaily(c.id, 'potions');
  }

  let ach = { fresh: [], ups: 0 };
  if (result.outcome === 'win') {
    const foughtCity = c.city_index;
    const stats = computeStats(c);
    prog.cycles_completed += 1;
    prog.bosses_defeated += 1;
    prog.gold_earned += result.gold || 0;
    // นับรอบที่จบในโหมดท้าทาย (ตราเฉพาะโหมด)
    if (c.challenge_mode) {
      const col = `${c.challenge_mode}_cycles`;
      prog[col] = (prog[col] || 0) + 1;
    }
    // สลายท่าไม้ตายสะสม (ตรา "จอมสลาย")
    prog.charge_breaks = (prog.charge_breaks || 0) + (result.breaks || 0);
    db.prepare(`UPDATE progress SET cycles_completed=@cycles_completed, bosses_defeated=@bosses_defeated, gold_earned=@gold_earned,
      hard_cycles=@hard_cycles, marathon_cycles=@marathon_cycles, survival_cycles=@survival_cycles,
      charge_breaks=@charge_breaks WHERE id=@id`).run(prog);
    // กระเป๋าเต็ม + ของรางวัล/ดรอป → ขายอัตโนมัติราคาพื้นฐาน (กันเก็บไว้รอราคาดีไม่อั้น)
    let lootNote = '';
    const lootAdd = (itemId, note) => {
      const got = acquireItem(c, itemId, 1, { fullMode: 'sell' });
      const def = ITEM_BY_ID[itemId];
      return `${note}${got.sold ? ` (🎒 เต็ม — ขาย ${def?.icon} ${def?.name} อัตโนมัติ +${got.gold} ทอง)` : ''}`;
    };
    if (result.item) lootNote = lootAdd(result.item.id, ` และได้ ${result.item.icon} ${result.item.name}!`);
    // เมืองยังไม่ย้ายอัตโนมัติ — client จะถามว่า "เดินทางต่อ" หรือ "สำรวจเมืองเดิมต่อ" (POST /boss/after)
    fights.delete(c.id);
    // ของรางวัลเฉพาะบอส — ปกติโอกาส ~50% ได้ของขวัญประจำตัว (ขายได้ที่แคมป์)
    // บอสลับ (สำรวจเมืองเดิมครบรอบ) → ได้ของพิเศษการันตีครั้งแรกของเมืองนั้น · มีแล้วได้ค่าหัวทองแทน (กันฟาร์มซ้ำ)
    // ชนะด้วยฝีมือ (สลายท่าไม้ตาย ≥1 ครั้ง หรืออดทนสู้จนบอสสุดทน) → การันตีของรางวัลบอส (แทนสุ่ม 50%)
    const masterWin = (result.breaks || 0) > 0 || result.furyWin;
    if (fight.boss.isWander && fight.boss.loot) {
      // บอสเร่ร่อน — ของรางวัลการันตี + แบบแปลนสูตรคราฟต์ (แหล่งหาแบบแปลนที่แน่นอน)
      lootNote += lootAdd(fight.boss.loot, ' และได้ของรางวัลบอสเร่ร่อน');
      const bp = ITEM_BY_ID[BLUEPRINT_ITEMS[Math.floor(Math.random() * BLUEPRINT_ITEMS.length)]];
      if (bp) lootNote += lootAdd(bp.id, ` + แบบแปลน ${bp.icon} ${bp.name}`);
    } else if (fight.boss.isAlt && fight.boss.loot) {
      const owned = getInventory(c.id).some((i) => i.item_id === fight.boss.loot);
      if (owned) {
        c.gold += 150;
        lootNote += ' และได้ค่าหัวบอสลับ +150 ทอง';
      } else {
        lootNote += lootAdd(fight.boss.loot, ' และได้ของพิเศษบอสลับ');
      }
    } else if (fight.boss.loot && (masterWin || Math.random() < 0.5)) {
      lootNote += lootAdd(fight.boss.loot, ` และได้ของรางวัลบอส${masterWin ? ' (รางวัลฝีมือ — การันตี)' : ''}`);
    }
    // 🦄 ยูนิคอร์น — กันกับดัก 1 ครั้ง/รอบ (โล่สะสมใหม่ทุกครั้งที่ชนะบอส)
    if (petPerks(c).trapShield) setPetTrapShield(c.id, 1);
    // 💳 บอสลับ — การันตีบัตรขยายคอก 1 ใบแรก (ถ้ายังไม่มีเลย) — คอกสัตว์ขยายช่องได้
    if (fight.boss.isAlt && !getInventory(c.id).some((i) => i.item_id === 171)) {
      addItem(c.id, 171, 1);
      lootNote += ' + 💳 บัตรขยายคอก (ของรางวัลบอสลับ — ครั้งแรก)';
    }
    updateCharacter(c);
    addTrophy(c.id, fight.boss.name, fight.boss.icon); // ห้องเก็บถ้วยรางวัล — ชนะบอสครั้งแรกของบอสนั้น (INSERT OR IGNORE)
    addLog(c.id, { type: 'boss_win', title: '🏆 ชนะบอส!', detail: `กำราบ ${fight.boss.name} ได้!${lootNote}`, xp: result.xp, gold: result.gold });
    ach = checkAchievements(c, prog, {
      bossWin: {
        hp: c.hp,
        pct: (c.hp / stats.maxHp) * 100,
        noEquip: !SLOT_COLS.some((col) => c[col]),
        cityIndex: foughtCity,
        breaks: result.breaks || 0,   // สลายท่าไม้ตายในไฟต์นี้ (ตราลับ "สยบจอมชาร์จ")
        fury: !!result.furyWin,       // ชนะตอนบอสสุดทน (ตราลับ "อดทนที่สุด")
      },
    });
    bumpDaily(c.id, 'boss_wins');
  }
  res.json({
    ...serialize(c),
    boss: { ...fight.boss, hp: fight.boss.hp },
    fight: fightFlags(fight),
    log: result.log,
    outcome: result.outcome,
    item: result.item || null,
    inventory: getInventory(c.id),
    progress: getProgress(c.id),
    achievements: ach.fresh,
    breaks: result.breaks || 0,
    furyWin: !!result.furyWin,
    ...dailyPayload(c),
    levelUps: { levels: (result.ups || 0) + ach.ups, statPoints: c.stat_points },
  });
});

// ----- หลังชนะบอส: เลือก "เดินทางต่อ" (เมืองใหม่) หรือ "สำรวจเมืองเดิมต่อ" (รอบเพิ่ม — ความยาก/รางวัล/ตลาดมืดเพิ่ม) -----
router.post('/boss/after', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { choice } = req.body || {};
  const city = CITIES[c.city_index % CITIES.length];
  if (choice === 'travel') {
    c.city_index = (c.city_index + 1) % CITIES.length;
    c.city_rounds = 0; // ย้ายเมือง = เริ่มสำรวจรอบใหม่
    updateCharacter(c);
    const next = CITIES[c.city_index % CITIES.length];
    addLog(c.id, { type: 'travel', title: '🗺️ เดินทางต่อ', detail: `จาก ${city.name} สู่ ${next.name} — เริ่มรอบการผจญภัยใหม่!` });
    return res.json({ ...serialize(c), message: `🗺️ เดินทางถึง ${next.name} แล้ว — เริ่มรอบใหม่!` });
  }
  if (choice === 'stay') {
    c.city_rounds = (c.city_rounds || 0) + 1;
    updateCharacter(c);
    const round = c.city_rounds;
    const em = exploreMult(c);
    const rm = exploreRewardMult(c);
    // เจอบอสลับในรอบนี้ไหม (รอบถัดไปที่ต้องสู้)
    const altNext = round >= altBossAt(c.city_index % CITIES.length);
    const altNote = altNext ? ` — และบอสลับจะปรากฏตัว! (${ALT_BOSSES[c.city_index % ALT_BOSSES.length].icon} ${ALT_BOSSES[c.city_index % ALT_BOSSES.length].name})` : '';
    addLog(c.id, { type: 'city_stay', title: '🏠 สำรวจเมืองเดิมต่อ', detail: `อยู่ต่อที่ ${city.name} — รอบที่ ${round} (ศัตรู x${em}, รางวัล x${rm})${altNote}` });
    return res.json({
      ...serialize(c),
      message: `🏠 สำรวจ ${city.name} ต่อ — รอบที่ ${round}: ศัตรูแข็งขึ้น x${em} แต่รางวัล x${rm}${altNext ? ' · บอสลับมาแล้ว!' : ''}`,
    });
  }
  return res.status(400).json({ error: 'ระบุทางเลือกไม่ถูกต้อง (travel / stay)' });
});

router.post('/boss/retreat', (req, res) => {
  const c = requireChar(res); if (!c) return;
  fights.delete(c.id);
  const stats = computeStats(c);
  c.hp = Math.max(1, c.hp - Math.round(stats.maxHp * 0.2));
  updateCharacter(c);
  addLog(c.id, { type: 'boss_lose', title: '💨 ถอยทัพ', detail: 'สู้บอสไม่ไหว ถอยกลับไปสำรวจใหม่ — ไม่นับรอบและไม่เพิ่มความยาก' });
  res.json({ ...serialize(c), message: 'ถอยกลับไปสำรวจใหม่ (ไม่นับรอบ — ความยากเท่าเดิม)' });
});

// ----- สรุปรายสัปดาห์: 7 วันล่าสุด เทียบ 7 วันก่อนหน้า -----
router.get('/weekly-summary', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const t = (expr) => db.prepare(`SELECT datetime(${expr}) AS t`).get().t;
  const now = t("'now','localtime'");
  const t7 = t("'now','localtime','-7 days'");
  const t14 = t("'now','localtime','-14 days'");
  // unlocked_at ของ achievement เก็บเป็น UTC — ต้องเทียบขอบเขต UTC แยก
  const utcNow = t("'now'");
  const utc7 = t("'now','-7 days'");
  const utc14 = t("'now','-14 days'");
  const achMap = new Map([...ACHIEVEMENTS, ...SECRET_ACHIEVEMENTS].map((a) => [a.id, a]));

  const summarize = (start, end, utcStart, utcEnd) => {
    // end แบบ inclusive (<=) — กัน session ที่จบในวินาทีเดียวกับที่เปิดหน้าสถิติหายไป
    const row = db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(focus_sec),0) AS focus_sec,
      COALESCE(SUM(xp),0) AS xp, COALESCE(SUM(gold),0) AS gold
      FROM log WHERE character_id=? AND type='session_done' AND created_at>=? AND created_at<=?`).get(c.id, start, end);
    const counts = db.prepare(`SELECT type, COUNT(*) AS n FROM log WHERE character_id=? AND type IN ('boss_win','battle_win') AND created_at>=? AND created_at<=? GROUP BY type`).all(c.id, start, end);
    const cities = db.prepare(`SELECT DISTINCT city FROM log WHERE character_id=? AND type='session_summary' AND city IS NOT NULL AND created_at>=? AND created_at<=?`).all(c.id, start, end).map((r) => r.city);
    const achRows = db.prepare(`SELECT achievement_id FROM achievement_unlock WHERE character_id=? AND unlocked_at>=? AND unlocked_at<=?`).all(c.id, utcStart, utcEnd);
    return {
      sessions: row.sessions, focusSec: row.focus_sec, xp: row.xp, gold: row.gold,
      bossWins: counts.find((x) => x.type === 'boss_win')?.n || 0,
      monsterWins: counts.find((x) => x.type === 'battle_win')?.n || 0,
      cities,
      achievements: achRows.map((r) => {
        const a = achMap.get(r.achievement_id);
        return a ? { id: a.id, name: a.name, icon: a.icon } : { id: r.achievement_id, name: r.achievement_id, icon: '🏅' };
      }),
    };
  };

  res.json({
    thisWeek: summarize(t7, now, utc7, utcNow),
    lastWeek: summarize(t14, t7, utc14, utc7),
  });
});

// ----- ชาเลนจ์รายสัปดาห์ (async — ตั้งเป้าเอง + แชร์รหัส ไม่ต้องมี server กลาง) -----
// คำนวณ session + นาทีโฟกัสของสัปดาห์นี้ (จันทร์–อาทิตย์ ตามเวลาเครื่อง) + ประวัติ 8 สัปดาห์ก่อน
router.get('/challenge/progress', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const weekStart = fmt(mon);
  const weekEnd = fmt(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6));

  const weekRow = (start, end) => db.prepare(`
    SELECT COUNT(*) AS sessions, COALESCE(SUM(focus_sec),0) AS focus_sec
    FROM log WHERE character_id=? AND type='session_done' AND date(created_at)>=? AND date(created_at)<=?
  `).get(c.id, start, end);

  const daysRaw = db.prepare(`
    SELECT date(created_at) AS d, COUNT(*) AS sessions, COALESCE(SUM(focus_sec),0) AS focus_sec
    FROM log WHERE character_id=? AND type='session_done' AND date(created_at)>=? AND date(created_at)<=?
    GROUP BY d
  `).all(c.id, weekStart, weekEnd);
  const byDate = Object.fromEntries(daysRaw.map((r) => [r.d, r]));

  const wd = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = fmt(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
    days.push({ date: d, weekday: wd[i], sessions: byDate[d]?.sessions || 0, focusSec: byDate[d]?.focus_sec || 0 });
  }

  const prevWeeks = [];
  for (let w = 1; w <= 8; w++) {
    const pm = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - w * 7);
    const ps = fmt(pm);
    const pe = fmt(new Date(pm.getFullYear(), pm.getMonth(), pm.getDate() + 6));
    const row = weekRow(ps, pe);
    prevWeeks.push({ weekStart: ps, weekEnd: pe, sessions: row.sessions, focusSec: row.focus_sec });
  }

  const cur = weekRow(weekStart, weekEnd);
  res.json({
    weekStart, weekEnd, days,
    sessions: cur.sessions, focusSec: cur.focus_sec,
    prevWeeks,
  });
});

// ----- สถิติละเอียด (หน้า Stats) -----
router.get('/stats', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const prog = getProgress(c.id);
  const ach = getAchievementList(c, prog);

  // session + เวลาโฟกัสย้อนหลัง 7 วัน
  const raw = db.prepare(`
    SELECT date(created_at) AS d, COUNT(*) AS sessions, COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'session_done'
      AND created_at >= datetime('now', 'localtime', '-6 days')
    GROUP BY d`).all(c.id);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = db.prepare(`SELECT date('now','localtime','-${i} day') AS d`).get().d;
    const row = raw.find((r) => r.d === date);
    days.push({ date, sessions: row?.sessions || 0, focusSec: row?.focus_sec || 0 });
  }

  // session + เวลาโฟกัสย้อนหลัง 30 วัน (กราฟรายเดือน)
  const monthRaw = db.prepare(`
    SELECT date(created_at) AS d, COUNT(*) AS sessions, COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'session_done'
      AND created_at >= datetime('now', 'localtime', '-29 days')
    GROUP BY d`).all(c.id);
  const monthDays = [];
  for (let i = 29; i >= 0; i--) {
    const date = db.prepare(`SELECT date('now','localtime','-${i} day') AS d`).get().d;
    const row = monthRaw.find((r) => r.d === date);
    monthDays.push({ date, sessions: row?.sessions || 0, focusSec: row?.focus_sec || 0 });
  }

  // เมืองที่ชนะบอสมาแล้ว (จาก log boss_win)
  const cityLogs = db.prepare("SELECT detail FROM log WHERE character_id = ? AND type = 'boss_win' ORDER BY id").all(c.id);

  // สถิติการค้าตลาดมืด (จาก log: ซื้อ title '🖤 ซื้อของตลาดมืด' · ขาย detail มีคำว่า 'ตลาดมืด')
  const bmBuys = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(-gold),0) AS gold FROM log WHERE character_id=? AND type='shop' AND title='🖤 ซื้อของตลาดมืด'").get(c.id);
  const bmSells = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(gold),0) AS gold FROM log WHERE character_id=? AND type='shop' AND title='💰 ขายของ' AND detail LIKE '%ตลาดมืด%'").get(c.id);
  const bmStats = { buys: bmBuys.n, buyGold: bmBuys.gold, sells: bmSells.n, sellGold: bmSells.gold, profit: bmSells.gold - bmBuys.gold };

  // เวลาพักเบรกย้อนหลัง 7 วัน (จาก log break_done) + พักกลาง session (จาก log session_done)
  const breakRaw = db.prepare(`
    SELECT date(created_at) AS d, COALESCE(SUM(break_sec), 0) AS break_sec, COALESCE(SUM(break_overrun_sec), 0) AS overrun_sec
    FROM log WHERE character_id = ? AND type = 'break_done'
      AND created_at >= datetime('now', 'localtime', '-6 days')
    GROUP BY d`).all(c.id);
  const pauseRaw = db.prepare(`
    SELECT date(created_at) AS d, COALESCE(SUM(pause_sec), 0) AS pause_sec
    FROM log WHERE character_id = ? AND type = 'session_done'
      AND created_at >= datetime('now', 'localtime', '-6 days')
    GROUP BY d`).all(c.id);
  const longPauseRaw = db.prepare(`
    SELECT date(created_at) AS d, COALESCE(SUM(long_pause_sec), 0) AS long_pause_sec
    FROM log WHERE character_id = ? AND type = 'session_done'
      AND created_at >= datetime('now', 'localtime', '-6 days')
    GROUP BY d`).all(c.id);
  const pauseByDate = Object.fromEntries(pauseRaw.map((r) => [r.d, r.pause_sec]));
  const longPauseByDate = Object.fromEntries(longPauseRaw.map((r) => [r.d, r.long_pause_sec]));
  const breakDays = [];
  for (let i = 6; i >= 0; i--) {
    const date = db.prepare(`SELECT date('now','localtime','-${i} day') AS d`).get().d;
    const row = breakRaw.find((r) => r.d === date);
    breakDays.push({ date, breakSec: row?.break_sec || 0, overrunSec: row?.overrun_sec || 0, pauseSec: pauseByDate[date] || 0, longPauseSec: longPauseByDate[date] || 0 });
  }

  // สถิติแยกตามงานที่โฟกัส (session_done — 30 วันล่าสุด) — ตั้งชื่องานก่อนเริ่มโฟกัสได้
  const tasks = db.prepare(`
    SELECT COALESCE(NULLIF(focus_task, ''), 'ไม่ระบุ') AS task, COUNT(*) AS sessions, COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'session_done'
      AND created_at >= datetime('now', 'localtime', '-29 days')
    GROUP BY task ORDER BY focus_sec DESC LIMIT 12
  `).all(c.id);

  // พักยาว 😴 แยกตามชื่อ (30 วันล่าสุด) — ตัวเลือกสำเร็จรูป + ชื่อที่พิมพ์เอง — รวมเวลาพักยาวต่อชื่อ
  const longPauseTitles = db.prepare(`
    SELECT COALESCE(NULLIF(long_pause_title, ''), '(ไม่มีชื่อ)') AS title,
           COALESCE(SUM(long_pause_sec), 0) AS sec, COUNT(*) AS times
    FROM log WHERE character_id = ? AND type = 'session_done' AND long_pause_sec > 0
      AND created_at >= datetime('now', 'localtime', '-29 days')
    GROUP BY title ORDER BY sec DESC LIMIT 12
  `).all(c.id);

  // ทิ้ง session แยกตามเหตุผล (30 วันล่าสุด) — ตัวเลือกสำเร็จรูป + เหตุผลที่พิมพ์เอง — รวมจำนวนครั้ง + เวลาที่โฟกัสไปก่อนทิ้ง
  const abortReasons = db.prepare(`
    SELECT COALESCE(NULLIF(abort_reason, ''), '(ไม่ระบุ)') AS reason,
           COUNT(*) AS times, COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'abort'
      AND created_at >= datetime('now', 'localtime', '-29 days')
    GROUP BY reason ORDER BY times DESC LIMIT 12
  `).all(c.id);
  const abortsTotal = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'abort'").get(c.id)?.n || 0;

  // ทิ้ง session แยกตามช่วงเวลา (30 วันล่าสุด) — เช้า 05-11 / กลางวัน 12-16 / เย็น 17-21 / ดึก 22-04
  // (ดูว่าช่วงไหนทิ้งบ่อยที่สุด — นับจากเวลาที่กดทิ้งจริง ๆ ใน log abort)
  const abortByPeriod = db.prepare(`
    SELECT
      CASE
        WHEN CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 5 AND 11 THEN 'เช้า'
        WHEN CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 12 AND 16 THEN 'กลางวัน'
        WHEN CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 17 AND 21 THEN 'เย็น'
        ELSE 'ดึก'
      END AS period,
      COUNT(*) AS times, COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'abort'
      AND created_at >= datetime('now', 'localtime', '-29 days')
    GROUP BY period
  `).all(c.id);

  // ทิ้ง session แยกตามวันในสัปดาห์ (30 วันล่าสุด) — dow 0-6 (อาทิตย์=0) → ฝั่ง client แปลงเป็นชื่อไทย
  const abortByWeekday = db.prepare(`
    SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow, COUNT(*) AS times,
           COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'abort'
      AND created_at >= datetime('now', 'localtime', '-29 days')
    GROUP BY dow
  `).all(c.id);
  const abortsThisWeek = abortsThisWeekCount(c.id);

  // heatmap โฟกัส 12 สัปดาห์ (วันละกี่นาที)
  const heatRaw = db.prepare(`
    SELECT date(created_at) AS d, COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'session_done'
      AND created_at >= datetime('now', 'localtime', '-90 days')
    GROUP BY d`).all(c.id);
  const heatmap = [];
  for (let i = 90; i >= 0; i--) {
    const date = db.prepare(`SELECT date('now','localtime','-${i} day') AS d`).get().d;
    const row = heatRaw.find((r) => r.d === date);
    heatmap.push({ date, focusSec: row?.focus_sec || 0 });
  }

  res.json({
    character: serializeCharacter(c),
    progress: prog,
    days,
    monthDays,
    breakDays,
    heatmap,
    tasks,
    longPauseTitles,
    abortReasons,
    abortsTotal,
    abortByPeriod,
    abortByWeekday,
    abortsThisWeek,
    cityLogs,
    bmStats,
    achievements: { unlocked: ach.unlocked, total: ach.total },
    settings: getSettings(),
  });
});

// ----- ตั้งค่า -----
router.put('/settings', (req, res) => {
  const s = getSettings();
  const { work_min, short_break_min, long_break_min, sessions_per_cycle, abort_week_limit } = req.body || {};
  db.prepare(`UPDATE settings SET work_min=?, short_break_min=?, long_break_min=?, sessions_per_cycle=?, abort_week_limit=? WHERE id=1`)
    .run(
      Math.max(1, Math.min(90, work_min ?? s.work_min)),
      Math.max(1, Math.min(30, short_break_min ?? s.short_break_min)),
      Math.max(1, Math.min(60, long_break_min ?? s.long_break_min)),
      Math.max(1, Math.min(8, sessions_per_cycle ?? s.sessions_per_cycle)),
      // เกณฑ์เตือนทิ้ง session (ครั้ง/สัปดาห์) — 0 = ปิดเตือน, บังคับ 0-20
      Math.max(0, Math.min(20, Math.round(abort_week_limit ?? s.abort_week_limit ?? 3))),
    );
  res.json({ settings: getSettings() });
});

// ----- ข้อมูล: export / import / reset (แท็บตั้งค่า) -----

// Export .db — ดาวน์โหลด DB ทั้งหมดเป็นไฟล์ .db (snapshot สม่ำเสมอ — ใช้ได้กับ ./run.sh restore)
router.get('/backup', (req, res) => {
  const buf = db.serialize();
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="pomoquest-backup-${ts}.db"`);
  res.send(Buffer.from(buf));
});

// Export JSON (.json.gz) — อ่าน/แก้ด้วยมือได้ บีบอัด gzip ให้ไฟล์เล็กลง
router.get('/export', (req, res) => {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(exportJsonData(db))), { level: 9 });
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="pomoquest-backup-${ts}.json.gz"`);
  res.send(gz);
});

// Import — รองรับ 2 แบบ:
//  - .json.gz (export จากปุ่ม Export JSON) → เขียนลงตารางทันที ไม่ต้องรีสตาร์ท
//  - .db (SQLite — export จากปุ่ม Export / ./run.sh backup) → แทนที่ไฟล์ ต้องรีสตาร์ท server
router.post('/restore', (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (!buf.length) return res.status(400).json({ error: 'ไฟล์ว่างเปล่า' });
    // gzip magic bytes (0x1f 0x8b) → JSON export
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      try {
        const json = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
        restoreFromJson(db, json);
        return res.json({ message: 'กู้คืนข้อมูลแล้ว (JSON) — ข้อมูลใหม่มีผลทันที', restart: false });
      } catch (e) {
        return res.status(400).json({ error: e.message || 'ไฟล์ .json.gz ไม่ถูกต้อง' });
      }
    }
    // SQLite .db — ตรวจว่าเป็น DB ของ PomoQuest + เวอร์ชัน schema ก่อนแทนที่ไฟล์
    const tmp = path.join(path.dirname(DB_PATH), 'restore-pending.db');
    try {
      fs.writeFileSync(tmp, buf);
      const test = new Database(tmp, { readonly: true });
      const schemaErr = checkDbSchema(test);
      test.close();
      if (schemaErr) throw new Error(schemaErr);
      // แทนที่ไฟล์จริง + ลบ WAL/SHM เก่า (server ยังถือข้อมูลเก่าในความจำจนกว่าจะ restart)
      fs.renameSync(tmp, DB_PATH);
      for (const f of [DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
      res.json({ message: 'กู้คืนข้อมูลแล้ว (ไฟล์ .db) — รีสตาร์ท server เพื่อให้ข้อมูลใหม่มีผล (./run.sh start)', restart: true });
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      res.status(400).json({ error: e.message || 'ไฟล์ไม่ใช่ฐานข้อมูล PomoQuest ที่ถูกต้อง (รองรับ .json.gz หรือ .db)' });
    }
  });
});

// Reset — ล้างข้อมูลเกมทั้งหมด (มีผลทันที ไม่ต้องรีสตาร์ท)
router.post('/reset', (req, res) => {
  for (const t of ['achievement_unlock', 'camp_shop', 'camp_quest_done', 'character_skill', 'daily_counter', 'daily_quest_done', 'daily_streak', 'story_quest_done', 'inventory', 'log', 'progress', 'character']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM sqlite_sequence').run(); // รีเซ็ต autoincrement
  db.prepare("UPDATE settings SET work_min=25, short_break_min=5, long_break_min=15, sessions_per_cycle=4, event_every_sec=90, active_character_id=NULL WHERE id=1").run();
  rotateEpoch(); // หมุน "โลกเวอร์ชัน" — session ที่พักค้างในเครื่อง (localStorage) จากโลกเก่าถูกทิ้งอัตโนมัติ
  res.json({ message: 'ล้างข้อมูลเกมทั้งหมดแล้ว — เริ่มต้นใหม่ได้เลย' });
});

export default router;
