import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import {
  db, DB_PATH, getCharacter, getCharacters, getProgress, getSettings, getInventory, getLog, addLog,
  addItem, updateCharacter, getActiveCharacterId, setActiveCharacter, deleteCharacter, bumpDaily, today,
  getSkillRow, learnSkill,
} from './db.js';
import {
  CLASSES, ITEM_BY_ID, CITIES, QUESTS, SHOP_STOCK, SCROLL_SKILL_BY_ID,
  ACHIEVEMENTS, SECRET_ACHIEVEMENTS, STORY_QUESTS,
} from './data.js';
import {
  computeStats, serializeCharacter, gainXp, rollEvent, generateBoss, bossPlayerTurn, equipBlockReason,
  rollQuests, resolveQuest, campSellPrice, marketPrice, SLOT_COLS, blackMarketStock, blackMarketOpen, BM_JUNK_MULT,
  rewardMult, dropMult, priceMult, challengeOf, CHALLENGES, festivalFor, storyReqMet, storyReqLabel,
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
  if (!c) return res.json({ hasCharacter: false, settings: getSettings(), ...charsPayload() });
  res.json({
    hasCharacter: true,
    ...serialize(c),
    inventory: getInventory(c.id),
    progress: getProgress(c.id),
    achievements: getAchievementList(c, getProgress(c.id)),
    log: getLog(c.id),
    settings: getSettings(),
    cities: CITIES.map((city, index) => ({ ...city, index })),
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
  addLog(c.id, { type: ev.logType || ev.key, title: ev.title, detail: ev.detail, xp: ev.xp, gold: ev.gold, hpChange: ev.hpChange || 0, mpChange: ev.mpChange || 0, sessionKey });
  if (ev.item) addItem(c.id, ev.item.id);
  // อัปเดต counter สถิติ (รวมตัวที่ใช้ตรวจตราลับ)
  const prog = getProgress(c.id);
  const up = (col, val) => db.prepare(`UPDATE progress SET ${col}=? WHERE id=?`).run(val, prog.id);
  if (ev.key === 'monster' && ev.monster?.win) { prog.monsters_slain += 1; up('monsters_slain', prog.monsters_slain); }
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
  const { focusSec = 1500, events = [], sessionIdx = 1, sessionsPerCycle = 1, sessionKey = null, focusTask = null } = req.body || {};
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
    total_focus_sec=@total_focus_sec, gold_earned=@gold_earned, daily_streak=@daily_streak, last_focus_date=@last_focus_date WHERE id=@id`).run(prog);

  const streakMsg = bonus > 1 ? ` (คอมโบโฟกัส x${bonus.toFixed(1)})` : '';
  const taleAfter = addLog(c.id, {
    type: 'session_done', title: '✅ จบเซสชันโฟกัส', detail: `โฟกัสครบ! +${xp} XP${streakMsg}, +${gold} ทอง${survivalFall ? ` · ${survivalFall}` : ''}`,
    xp, gold, focusSec, focusTask,
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
  const recordTale = (text) => {
    if (text) addLog(c.id, { type: 'llm_tale', title: '📖 เรื่องราวการผจญภัย', detail: text.slice(0, 500) });
  };

  // สรุปการผจญภัยด้วย LLM (ถ้าเปิดใช้) — fire-and-forget: ไม่บล็อก response; ถ้าไม่ได้เรื่องก็ใช้สรุปเหตุการณ์แทน
  // (dev ลองเล่น: ข้ามไปเลย — async write หลุดจาก transaction ที่จะ ROLLBACK ได้)
  const city = CITIES[c.city_index % CITIES.length];
  if (!isDevDryRun()) {
    llmChat({
      system: 'You are the narrator of PomoQuest, a Pomodoro RPG game. Write a short, vivid 2-3 sentence adventure story in Thai mixed with English (like the game\'s style). Narrate only what happened during this focus session, weaving in the events list below if provided — never invent rewards, numbers, items or levels. Keep it fun and concise.',
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
      AND type NOT IN ('session_summary', 'session_done', 'llm_tale') ORDER BY id
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
  const prog = getProgress(c.id);
  // 🛡️ โล่โฟกัส — ถ้ามี ให้กันคอมโบหาย 1 ครั้ง (โล่แตก แล้วคอมโบยังอยู่)
  if (prog.combo_shield > 0) {
    prog.combo_shield = 0;
    db.prepare('UPDATE progress SET combo_shield = 0 WHERE id = ?').run(prog.id);
    addLog(c.id, { type: 'abort', title: '🛡️ โล่โฟกัสกันคอมโบ!', detail: 'ทิ้งเซสชัน แต่โล่โฟกัสกันคอมโบไว้ได้ (โล่แตก) — คอมโบยังอยู่!' });
    return res.json({ progress: getProgress(c.id), shieldUsed: true, message: '🛡️ โล่โฟกัสกันคอมโบไว้ได้! คอมโบไม่หาย (โล่แตก)' });
  }
  prog.streak = 0;
  db.prepare('UPDATE progress SET streak = 0 WHERE id = ?').run(prog.id);
  addLog(c.id, { type: 'abort', title: '💨 ละทิ้งเซสชัน', detail: 'คอมโบโฟกัสหายไป (เริ่มใหม่จาก 1)' });
  res.json({ progress: getProgress(c.id) });
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
    const bm = blackMarketStock(visit);
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
  // ราคาในร้านตามวันนี้ (market) — ของที่พ่อค้าต้องการวันนี้แพงขึ้น, ของไม่ดังลดราคา
  const dayKey = today();
  const bm = blackMarketStock(visit);
  // โหมดโหด: ราคาในร้านแพงขึ้น x1.3 (ราคาที่โชว์ = ราคาที่จ่ายจริง)
  const pm = priceMult(c);
  const shop = stock.map((s) => {
    const base = ITEM_BY_ID[s.item_id];
    if (!base) return null;
    if (s.market === 'black') {
      const b = bm?.find((x) => x.id === s.item_id);
      return { ...base, price: Math.round((b?.bmPrice ?? base.price) * pm), bmNormal: b?.bmNormal, bmTag: b?.bmTag, bm: 1, bought: s.qty >= 1 ? 1 : 0 };
    }
    if (s.market === 'festival') {
      // สินค้าเทศกาล — ลด 20% (ราคาที่โชว์ = ราคาที่จ่ายจริง)
      return { ...base, price: Math.round(base.price * 0.8 * pm), priceMult: 0.8, sale: 1, festival: 1, bought: s.qty >= 1 ? 1 : 0 };
    }
    const m = marketPrice(base, dayKey);
    return { ...base, price: Math.round(m.price * pm), priceMult: m.mult, hot: m.hot, sale: m.sale, bought: s.qty >= 1 ? 1 : 0 };
  }).filter(Boolean);
  // ราคาขายของแต่ละชิ้นตอนค่ายพักนี้ — จังหวะรายวัน (พ่อค้าอยากได้ของบางชิ้น → แพงขึ้น, เปลี่ยนทุกวัน)
  // ตลาดมืดรับซื้อของขวัญ (junk) แพงกว่าปกติ +25% — ปรับราคาที่โชว์ให้ตรงกับที่จ่ายจริง
  const inventory = getInventory(c.id);
  const sellPrices = Object.fromEntries(inventory.map((inv) => {
    const sp = campSellPrice(inv, dayKey);
    if (bm && inv.type === 'junk') sp.price = Math.round(sp.price * BM_JUNK_MULT);
    return [inv.item_id, sp];
  }));
  res.json({
    ...serialize(c),
    inventory,
    sellPrices,
    shop,
    festival: fest || null,
    blackMarket: bm ? { items: shop.filter((s) => s.bm), junkMult: BM_JUNK_MULT } : null,
    quests: rollQuests(c.level, 3),
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
  // ราคาตามแหล่งที่มา: ร้านปกติ = ราคาตลาดวันนี้ · ตลาดมืด = ราคาลดพิเศษ (เท่ากับที่โชว์ใน /camp)
  // โหมดโหด: ของทุกอย่างแพงขึ้น x1.3 (ราคาที่โชว์ในร้านก็ปรับให้ตรง)
  let price, fromBm = false;
  if (row.market === 'black') {
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
  c.gold -= price;
  addItem(c.id, itemId, 1);
  db.prepare('UPDATE camp_shop SET qty = qty + 1 WHERE character_id = ? AND visit = ? AND item_id = ?').run(c.id, visit, itemId);
  updateCharacter(c);
  addLog(c.id, { type: 'shop', title: fromBm ? '🖤 ซื้อของตลาดมืด' : '🛒 ซื้อของ', detail: `ซื้อ ${item.icon} ${item.name} (-${price} ทอง)${fromBm ? ' (ตลาดมืด)' : ''}`, gold: -price });
  bumpDaily(c.id, 'items_bought', 1);
  let ach = { fresh: [], ups: 0 };
  if (fromBm) {
    // นับการค้ากับตลาดมืด (ตรา "สายค้าตลาดมืด" + เควสประจำวัน)
    bumpDaily(c.id, 'bm_trades', 1);
    const prog = getProgress(c.id);
    prog.bm_buys = (prog.bm_buys || 0) + 1;
    db.prepare('UPDATE progress SET bm_buys = ? WHERE id = ?').run(prog.bm_buys, prog.id);
    ach = checkAchievements(c, prog);
  }
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `ซื้อ ${item.name} สำเร็จ (${price} ทอง)`, achievements: ach.fresh, ...dailyPayload(c) });
});

router.post('/shop/sell', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId, qty = 1 } = req.body || {};
  const inv = getInventory(c.id).find((i) => i.item_id === itemId);
  if (!inv || inv.qty < qty) return res.status(400).json({ error: 'ไม่มีไอเทมพอจะขาย' });
  // ราคาขายตามวันนี้ (พ่อค้าต้องการของบางชิ้น → แพงขึ้น) — ราคาเดียวกับที่โชว์ใน /camp
  const sell = campSellPrice(inv, today());
  // ตลาดมืดรับซื้อของขวัญ (junk) แพงกว่าปกติ +25%
  const bmOpen = req.body.visit ? blackMarketOpen(req.body.visit) : false;
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
    message: toBm ? `🖤 ตลาดมืดรับซื้อแพงกว่า! ได้ ${gain} ทอง` : sell.wanted ? `🔥 พ่อค้าต้องการของชิ้นนี้! ได้ ${gain} ทอง` : `ขายได้ ${gain} ทอง`,
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
  const { questId } = req.body || {};
  const quest = QUESTS.find((q) => q.id === questId);
  if (!quest) return res.status(400).json({ error: 'ภารกิจไม่พบ' });
  const result = resolveQuest(c, quest);
  updateCharacter(c);
  if (result.item) addItem(c.id, result.item.id);
  addLog(c.id, { type: result.success ? 'quest_win' : 'quest_fail', title: `📜 ${quest.title}`, detail: result.detail, xp: result.xp, gold: result.gold });
  // นับภารกิจที่ทำสำเร็จ
  const prog = getProgress(c.id);
  if (result.success) {
    prog.quests_completed += 1;
    db.prepare('UPDATE progress SET quests_completed = ? WHERE id = ?').run(prog.quests_completed, prog.id);
  }
  bumpDaily(c.id, 'camp_quests');
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
router.get('/boss', (req, res) => {
  const c = requireChar(res); if (!c) return;
  let fight = fights.get(c.id);
  if (!fight) {
    fight = { boss: generateBoss(c.level, c.city_index, c) };
    fights.set(c.id, fight);
  }
  res.json({ ...serialize(c), boss: { ...fight.boss, hp: fight.boss.hp } });
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
    db.prepare(`UPDATE progress SET cycles_completed=@cycles_completed, bosses_defeated=@bosses_defeated, gold_earned=@gold_earned,
      hard_cycles=@hard_cycles, marathon_cycles=@marathon_cycles, survival_cycles=@survival_cycles WHERE id=@id`).run(prog);
    if (result.item) addItem(c.id, result.item.id);
    c.city_index = (c.city_index + 1) % CITIES.length;
    updateCharacter(c);
    fights.delete(c.id);
    // ของรางวัลเฉพาะบอส — โอกาส ~50% ได้ของขวัญหายากประจำตัว (ขายได้ที่แคมป์)
    let lootNote = '';
    if (fight.boss.loot && Math.random() < 0.5) {
      const loot = ITEM_BY_ID[fight.boss.loot];
      if (loot) {
        addItem(c.id, loot.id);
        lootNote = ` และได้ ${loot.icon} ${loot.name}!`;
      }
    }
    addLog(c.id, { type: 'boss_win', title: '🏆 ชนะบอส!', detail: `กำราบ ${fight.boss.name} และเดินทางสู่ ${CITIES[c.city_index].name}!${lootNote}`, xp: result.xp, gold: result.gold });
    ach = checkAchievements(c, prog, {
      bossWin: {
        hp: c.hp,
        pct: (c.hp / stats.maxHp) * 100,
        noEquip: !SLOT_COLS.some((col) => c[col]),
        cityIndex: foughtCity,
      },
    });
    bumpDaily(c.id, 'boss_wins');
  }
  res.json({
    ...serialize(c),
    boss: { ...fight.boss, hp: fight.boss.hp },
    log: result.log,
    outcome: result.outcome,
    item: result.item || null,
    inventory: getInventory(c.id),
    progress: getProgress(c.id),
    achievements: ach.fresh,
    ...dailyPayload(c),
    levelUps: { levels: (result.ups || 0) + ach.ups, statPoints: c.stat_points },
  });
});

router.post('/boss/retreat', (req, res) => {
  const c = requireChar(res); if (!c) return;
  fights.delete(c.id);
  const stats = computeStats(c);
  c.hp = Math.max(1, c.hp - Math.round(stats.maxHp * 0.2));
  updateCharacter(c);
  addLog(c.id, { type: 'boss_lose', title: '💨 ถอยทัพ', detail: 'สู้ไม่ไหว ถอยกลับไปพักก่อน…' });
  res.json({ ...serialize(c), message: 'ถอยกลับแคมป์ พลังเสียไปเล็กน้อย' });
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

  // เวลาพักเบรกย้อนหลัง 7 วัน (จาก log break_done)
  const breakRaw = db.prepare(`
    SELECT date(created_at) AS d, COALESCE(SUM(break_sec), 0) AS break_sec, COALESCE(SUM(break_overrun_sec), 0) AS overrun_sec
    FROM log WHERE character_id = ? AND type = 'break_done'
      AND created_at >= datetime('now', 'localtime', '-6 days')
    GROUP BY d`).all(c.id);
  const breakDays = [];
  for (let i = 6; i >= 0; i--) {
    const date = db.prepare(`SELECT date('now','localtime','-${i} day') AS d`).get().d;
    const row = breakRaw.find((r) => r.d === date);
    breakDays.push({ date, breakSec: row?.break_sec || 0, overrunSec: row?.overrun_sec || 0 });
  }

  // สถิติแยกตามงานที่โฟกัส (session_done — 30 วันล่าสุด) — ตั้งชื่องานก่อนเริ่มโฟกัสได้
  const tasks = db.prepare(`
    SELECT COALESCE(NULLIF(focus_task, ''), 'ไม่ระบุ') AS task, COUNT(*) AS sessions, COALESCE(SUM(focus_sec), 0) AS focus_sec
    FROM log WHERE character_id = ? AND type = 'session_done'
      AND created_at >= datetime('now', 'localtime', '-29 days')
    GROUP BY task ORDER BY focus_sec DESC LIMIT 12
  `).all(c.id);

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
    cityLogs,
    bmStats,
    achievements: { unlocked: ach.unlocked, total: ach.total },
    settings: getSettings(),
  });
});

// ----- ตั้งค่า -----
router.put('/settings', (req, res) => {
  const s = getSettings();
  const { work_min, short_break_min, long_break_min, sessions_per_cycle } = req.body || {};
  db.prepare(`UPDATE settings SET work_min=?, short_break_min=?, long_break_min=?, sessions_per_cycle=? WHERE id=1`)
    .run(
      Math.max(1, Math.min(90, work_min ?? s.work_min)),
      Math.max(1, Math.min(30, short_break_min ?? s.short_break_min)),
      Math.max(1, Math.min(60, long_break_min ?? s.long_break_min)),
      Math.max(1, Math.min(8, sessions_per_cycle ?? s.sessions_per_cycle)),
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
  for (const t of ['achievement_unlock', 'camp_shop', 'character_skill', 'daily_counter', 'daily_quest_done', 'daily_streak', 'story_quest_done', 'inventory', 'log', 'progress', 'character']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM sqlite_sequence').run(); // รีเซ็ต autoincrement
  db.prepare("UPDATE settings SET work_min=25, short_break_min=5, long_break_min=15, sessions_per_cycle=4, event_every_sec=90, active_character_id=NULL WHERE id=1").run();
  res.json({ message: 'ล้างข้อมูลเกมทั้งหมดแล้ว — เริ่มต้นใหม่ได้เลย' });
});

export default router;
