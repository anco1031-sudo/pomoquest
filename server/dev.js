// server/dev.js — ระบบ dev test: เข้าสู่ระบบด้วย admin/adminlouis แล้วทดสอบทุกระบบได้
// ตั้งค่า user/pass ผ่าน env: DEV_USER, DEV_PASS
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, getCharacter, getProgress, addItem, addLog, updateCharacter, bumpDaily, getSkillRow, learnSkill } from './db.js';
import { ITEM_BY_ID, CITIES, ACHIEVEMENTS, SECRET_ACHIEVEMENTS, SCROLL_SKILLS, SCROLL_SKILL_BY_ID } from './data.js';
import { serializeCharacter, gainXp, generateBoss, computeStats, getCharacterSkills, grantSkillXp } from './game.js';
import { checkAchievements } from './achievements.js';

const DEV_USER = process.env.DEV_USER || 'admin';
const DEV_PASS = process.env.DEV_PASS || 'adminlouis';
// token อยู่ในหน่วยความจำ — รีสตาร์ท server แล้วต้อง login ใหม่
const tokens = new Set();

const router = Router();

router.post('/dev/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === DEV_USER && pass === DEV_PASS) {
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    return res.json({ ok: true, token, user });
  }
  return res.status(401).json({ error: 'user/pass ไม่ถูกต้อง' });
});

const requireDev = (req, res, next) => {
  const token = req.headers['x-dev-token'];
  if (token && tokens.has(token)) return next();
  return res.status(401).json({ error: 'ต้องเข้าสู่ระบบ dev ก่อน' });
};

const requireChar = (res) => {
  const c = getCharacter();
  if (!c) { res.status(404).json({ error: 'ยังไม่มีตัวละคร' }); return null; }
  return c;
};

// ----- ทดสอบระบบต่าง ๆ (ต้องมี token) -----

// ให้ไอเทม (ทุกชิ้นรวม exclusive)
router.post('/dev/grant-item', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId } = req.body || {};
  const item = ITEM_BY_ID[itemId];
  if (!item) return res.status(400).json({ error: 'ไอเทมไม่พบ (ดู id ใน server/data.js)' });
  addItem(c.id, itemId, 1);
  addLog(c.id, { type: 'dev', title: '🎁 ให้ไอเทม (dev)', detail: `${item.icon} ${item.name}` });
  res.json({ message: `🎁 ได้ ${item.icon} ${item.name} x1` });
});

// ให้ทอง
router.post('/dev/gold', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const amount = Math.max(0, Math.round(Number(req.body?.amount) || 1000));
  c.gold += amount;
  updateCharacter(c);
  addLog(c.id, { type: 'dev', title: '💰 ให้ทอง (dev)', detail: `+${amount} ทอง`, gold: amount });
  res.json({ ...serializeCharacter(c), message: `💰 +${amount} ทอง` });
});

// ให้ XP (อาจอัพเลเวล)
router.post('/dev/xp', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const amount = Math.max(0, Math.round(Number(req.body?.amount) || 500));
  const ups = gainXp(c, amount);
  updateCharacter(c);
  addLog(c.id, { type: 'dev', title: '✨ ให้ XP (dev)', detail: `+${amount} XP${ups ? ` (อัพ ${ups} เลเวล!)` : ''}`, xp: amount });
  const ach = checkAchievements(c, getProgress(c.id));
  res.json({
    ...serializeCharacter(c),
    achievements: ach.fresh,
    levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
    message: `✨ +${amount} XP${ups ? ` — อัพ ${ups} เลเวล!` : ''}`,
  });
});

// เขียนเรื่องราวการผจญภัย (ทดสอบ story modal)
router.post('/dev/tale', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const text = (req.body?.text || 'เรื่องทดสอบจาก dev panel 📖 — ฮีโร่ฝ่าดงมอนสเตอร์ไปถึงเมืองใหม่ และพร้อมออกผจญภัยต่อ!').slice(0, 500);
  addLog(c.id, { type: 'llm_tale', title: '📖 เรื่องราวการผจญภัย', detail: text });
  res.json({ message: '📖 เขียนเรื่องราวทดสอบแล้ว (จะเด้ง modal ตอนจบ session)' });
});

// ปลดล็อก achievement (ปกติ/ลับ) พร้อมรางวัล
router.post('/dev/achieve', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { id } = req.body || {};
  const a = [...ACHIEVEMENTS, ...SECRET_ACHIEVEMENTS].find((x) => x.id === id);
  if (!a) return res.status(400).json({ error: 'achievement ไม่พบ (ดู id ใน server/data.js)' });
  const ins = db.prepare('INSERT OR IGNORE INTO achievement_unlock (character_id, achievement_id) VALUES (?, ?)').run(c.id, id);
  let ups = 0;
  if (ins.changes) {
    if (a.reward.gold) c.gold += a.reward.gold;
    if (a.reward.xp) ups = gainXp(c, a.reward.xp);
    updateCharacter(c);
    addLog(c.id, { type: 'achievement', title: `🏅 ปลดล็อก (dev): ${a.name}`, detail: a.desc, gold: a.reward.gold || 0, xp: a.reward.xp || 0 });
  }
  res.json({ ...serializeCharacter(c), message: ins.changes ? `🏅 ปลดล็อก "${a.name}" แล้ว (+${a.reward.gold || 0} ทอง)` : `"${a.name}" ปลดล็อกอยู่แล้ว` });
});

// เรียนรู้สกิลสุ่มจากคัมภีร์ (ทดสอบระบบสกิลคัมภีร์)
router.post('/dev/learn-skill', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const id = req.body?.skillId || SCROLL_SKILLS[Math.floor(Math.random() * SCROLL_SKILLS.length)].id;
  const sk = SCROLL_SKILL_BY_ID[id];
  if (!sk) return res.status(400).json({ error: 'สกิลไม่พบ (ดู id ใน server/data.js)' });
  if (getSkillRow(c.id, sk.id)) {
    return res.json({ ...serializeCharacter(c), message: `📖 เรียนรู้ ${sk.name} อยู่แล้ว` });
  }
  learnSkill(c.id, sk.id, 'scroll');
  addLog(c.id, { type: 'skill_learn', title: `📖 เรียนรู้สกิล (dev): ${sk.icon} ${sk.name}`, detail: `จาก dev panel — ใช้สู้บอสได้เลย! (${sk.mp} MP)` });
  res.json({ ...serializeCharacter(c), message: `📖 เรียนรู้สกิล ${sk.name} แล้ว!` });
});

// ให้ XP สกิลทุกตัว (ทดสอบเลเวลสกิล — +10%/เลเวล สูงสุด Lv.5)
router.post('/dev/skill-xp', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const amount = Math.max(1, Math.round(Number(req.body?.amount) || 120));
  const skills = getCharacterSkills(c);
  let leveled = 0;
  for (const s of skills) grantSkillXp(c, s.id, amount).levelUp && leveled++;
  res.json({ ...serializeCharacter(c), message: `⭐ ให้ XP ${amount} กับทุกสกิล${leveled ? ` — อัพเลเวล ${leveled} สกิล!` : ''}` });
});

// ชนะบอสทันที (ทดสอบรอบเมือง / วัฏจักร)
router.post('/dev/boss-win', requireDev, (req, res) => {
  const c = requireChar(res); if (!c) return;
  const boss = generateBoss(c.level, c.city_index);
  const prog = getProgress(c.id);
  const xp = 250 + 60 * c.level;
  const gold = 120 + 40 * c.level;
  const ups = gainXp(c, xp);
  c.gold += gold;
  prog.cycles_completed += 1;
  prog.bosses_defeated += 1;
  prog.gold_earned += gold;
  db.prepare('UPDATE progress SET cycles_completed=?, bosses_defeated=?, gold_earned=? WHERE id=?')
    .run(prog.cycles_completed, prog.bosses_defeated, prog.gold_earned, prog.id);
  const drop = Math.random() < 0.35
    ? pickGear(c.level)
    : null;
  if (drop) addItem(c.id, drop.id);
  c.city_index = (c.city_index + 1) % CITIES.length;
  updateCharacter(c);
  addLog(c.id, { type: 'boss_win', title: '🏆 ชนะบอส! (dev)', detail: `กำราบ ${boss.name} และเดินทางสู่ ${CITIES[c.city_index].name}!`, xp, gold });
  bumpDaily(c.id, 'boss_wins');
  const stats = computeStats(c);
  const ach = checkAchievements(c, prog, {
    bossWin: { hp: c.hp, pct: (c.hp / stats.maxHp) * 100, noEquip: false, cityIndex: c.city_index },
  });
  res.json({
    ...serializeCharacter(c),
    progress: getProgress(c.id),
    achievements: ach.fresh,
    levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
    message: `🏆 ชนะบอส ${boss.name} (dev) +${xp} XP, +${gold} ทอง → ${CITIES[c.city_index].name}`,
  });
});

const pickGear = (level) => {
  const pool = Object.values(ITEM_BY_ID).filter((i) => !i.exclusive && i.type !== 'consumable' && i.type !== 'junk' && (i.lvl || 1) <= level + 1);
  return pool[Math.floor(Math.random() * pool.length)] || null;
};

export default router;
