// server/dev.js — ระบบ dev test: เข้าสู่ระบบด้วย admin/admin แล้วทดสอบทุกระบบได้
// ⚠️ โหมด "ลองเล่น": ทุก action เขียนลง DB ภายใน transaction แล้ว ROLLBACK ทันที
//    — แสดงผลเหมือนจริง (เลเวล/ทอง/ไอเทม/ตรา) แต่ไม่บันทึกอะไรลง DB (กันปั๊มเลเวล)
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, getCharacter, getProgress, getInventory, addItem, addLog, updateCharacter, bumpDaily, getSkillRow, learnSkill } from './db.js';
import { ITEM_BY_ID, CITIES, ACHIEVEMENTS, SECRET_ACHIEVEMENTS, SCROLL_SKILLS, SCROLL_SKILL_BY_ID } from './data.js';
import { serializeCharacter, gainXp, generateBoss, computeStats, getCharacterSkills, grantSkillXp, bmStockFor, BM_JUNK_MULT, exploreRewardMult } from './game.js';
import { checkAchievements } from './achievements.js';

// dev เป็นเครื่องมือทดสอบในเครื่อง + โหมดลองเล่นไม่บันทึก — ใช้ admin/admin ตายตัว (ไม่มี env ให้ตั้ง)
const DEV_USER = 'admin';
const DEV_PASS = 'admin';
// token อยู่ในหน่วยความจำ — รีสตาร์ท server แล้วต้อง login ใหม่
const tokens = new Set();

// ระหว่างที่ dev dry-run middleware กำลังรัน request อยู่ (ลองเล่น) — ใช้กัน async write (เช่น LLM tale)
// เขียนหลุดจาก transaction ที่จะ ROLLBACK (เช็คแบบ synchronous ใน handler เท่านั้น)
let dryRunActive = false;
export const isDevDryRun = () => dryRunActive;

// ตัวกลาง: request ที่มี x-dev-token ถูกต้อง (ปุ่มใน dev panel ที่เรียก endpoint จริงของเกม
// เช่น จบ session / event / ซื้อ / ภารกิจ) → รันทั้ง request ใน transaction แล้ว ROLLBACK ทันที
// แสดงผลเหมือนจริง (XP/ทอง/เลเวลอัพ/ของ) แต่ไม่บันทึกอะไรลง DB — กันปั๊มเลเวล
// ข้าม /dev/* เพราะจัดการ transaction เองอยู่แล้ว (dryRun ด้านล่าง)
export const devDryRun = (req, res, next) => {
  const token = req.headers['x-dev-token'];
  // ไม่มี token = เล่นเกมปกติ (apiPost ไม่ส่ง header นี้) · /dev/* จัดการ transaction เอง
  if (!token || req.path.startsWith('/dev/')) return next();
  // token หมดอายุ (token อยู่ในหน่วยความจำ server — รีสตาร์ทแล้วของเก่าที่ค้างใน localStorage ใช้ไม่ได้)
  // → ตอบ 401 ห้ามรันต่อแบบปกติ: ไม่งั้น dev test จะบันทึก log/XP/ทองลง DB จริงเงียบ ๆ (กันปั๊มเลเวลทะลุ)
  if (!tokens.has(token)) {
    return res.status(401).json({ error: 'เซสชัน dev หมดอายุ — ต้องเข้าสู่ระบบ dev ใหม่ (server รีสตาร์ทแล้ว login ใหม่)' });
  }
  dryRunActive = true;
  try {
    db.exec('BEGIN');
  } catch (e) {
    console.error('dev dry-run: เปิด transaction ไม่ได้:', e.message);
    dryRunActive = false;
    return next(); // เปิด transaction ไม่ได้ → รันแบบปกติ (กัน request ค้าง)
  }
  try {
    next();
    db.exec('ROLLBACK');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ไม่มี transaction ค้าง */ }
    console.error('dev dry-run error:', e);
  } finally {
    dryRunActive = false;
  }
};

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

// รัน action แบบลองเล่น: BEGIN → ทำทุกอย่าง (เขียนลง DB) → capture สถานะที่จะแสดง → ROLLBACK
// ตัว `c` ที่ mutate เป็นออบเจกต์ในหน่วยความจำ — serialize ออกมาได้ แต่ข้อมูลไม่ติด DB
const dryRun = (res, fn) => {
  const c = getCharacter();
  if (!c) { res.status(404).json({ error: 'ยังไม่มีตัวละคร' }); return null; }
  let out = null;
  try {
    db.exec('BEGIN');
    const extra = fn(c) || {};
    // capture สถานะหลัง action (ยังอยู่ใน transaction — ข้อมูลอัปเดตแล้ว) ก่อน rollback
    out = {
      ...extra,
      character: serializeCharacter(c),
      inventory: getInventory(c.id),
      progress: getProgress(c.id),
    };
    db.exec('ROLLBACK');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ไม่มี transaction ค้าง */ }
    console.error('dev action error:', e);
    res.status(400).json({ error: 'dev action ผิดพลาด: ' + (e?.message || e) });
    return null;
  }
  res.json(out);
  return out;
};

// ดูตัวอย่าง stock ตลาดมืด (preview เท่านั้น — ไม่มี flag, ไม่แตะ DB, ไม่มีผลกับเกมจริง)
// ใช้ visit ปัจจุบันเป็น seed → deterministic กับของที่ค่ายพักนี้จะขาย (ถ้าเจอตลาดมืด)
router.post('/dev/black-market', requireDev, (req, res) => {
  const visit = req.body?.visit || `v${Date.now()}`;
  const items = bmStockFor(visit);
  res.json({
    items,
    junkMult: BM_JUNK_MULT,
    message: `🖤 ตัวอย่างตลาดมืด (ค่ายพัก ${visit}) — ${items.length} ชิ้น · รับซื้อขยะ +${Math.round((BM_JUNK_MULT - 1) * 100)}% (preview — ไม่มีผลกับเกม)`,
  });
});

// ----- ทดสอบระบบต่าง ๆ (ต้องมี token — ผลลัพธ์ไม่บันทึก) -----

// ให้ไอเทม (ทุกชิ้นรวม exclusive)
router.post('/dev/grant-item', requireDev, (req, res) => {
  const { itemId } = req.body || {};
  const item = ITEM_BY_ID[itemId];
  if (!item) return res.status(400).json({ error: 'ไอเทมไม่พบ (ดู id ใน server/data.js)' });
  dryRun(res, (c) => {
    addItem(c.id, itemId, 1);
    addLog(c.id, { type: 'dev', title: '🎁 ให้ไอเทม (dev)', detail: `${item.icon} ${item.name}` });
    return { message: `🎁 ลองเล่น: ได้ ${item.icon} ${item.name} x1 (ไม่บันทึก)` };
  });
});

// เติม HP/MP เต็ม (ทดสอบระบบสู้ / สถานะ)
router.post('/dev/heal', requireDev, (req, res) => {
  dryRun(res, (c) => {
    const stats = computeStats(c);
    c.hp = stats.maxHp;
    c.mp = stats.maxMp;
    updateCharacter(c);
    addLog(c.id, { type: 'dev', title: '💖 เติมพลัง (dev)', detail: `HP/MP เต็มแล้ว (${stats.maxHp}/${stats.maxMp})` });
    return { message: `💖 ลองเล่น: HP/MP เต็มแล้ว (${stats.maxHp}/${stats.maxMp}) (ไม่บันทึก)` };
  });
});

// ย้ายเมืองถัดไป (ทดสอบรอบเมือง / วัฏจักร)
router.post('/dev/next-city', requireDev, (req, res) => {
  dryRun(res, (c) => {
    const next = (c.city_index + 1) % CITIES.length;
    c.city_index = next;
    updateCharacter(c);
    addLog(c.id, { type: 'dev', title: '🗺️ ย้ายเมือง (dev)', detail: `เดินทางสู่ ${CITIES[next].name}!` });
    return { message: `🗺️ ลองเล่น: ไป ${CITIES[next].name} (ไม่บันทึก)` };
  });
});

// ให้ทอง
router.post('/dev/gold', requireDev, (req, res) => {
  const amount = Math.max(0, Math.round(Number(req.body?.amount) || 1000));
  dryRun(res, (c) => {
    c.gold += amount;
    updateCharacter(c);
    addLog(c.id, { type: 'dev', title: '💰 ให้ทอง (dev)', detail: `+${amount} ทอง`, gold: amount });
    return { message: `💰 ลองเล่น: +${amount} ทอง (ไม่บันทึก)` };
  });
});

// ให้ XP (อาจอัพเลเวล)
router.post('/dev/xp', requireDev, (req, res) => {
  const amount = Math.max(0, Math.round(Number(req.body?.amount) || 500));
  dryRun(res, (c) => {
    const ups = gainXp(c, amount);
    updateCharacter(c);
    addLog(c.id, { type: 'dev', title: '✨ ให้ XP (dev)', detail: `+${amount} XP${ups ? ` (อัพ ${ups} เลเวล!)` : ''}`, xp: amount });
    const ach = checkAchievements(c, getProgress(c.id));
    return {
      achievements: ach.fresh,
      levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
      message: `✨ ลองเล่น: +${amount} XP${ups ? ` — อัพ ${ups} เลเวล!` : ''} (ไม่บันทึก)`,
    };
  });
});

// เขียนเรื่องราวการผจญภัย (ทดสอบ story modal)
router.post('/dev/tale', requireDev, (req, res) => {
  const text = (req.body?.text || 'เรื่องทดสอบจาก dev panel 📖 — ฮีโร่ฝ่าดงมอนสเตอร์ไปถึงเมืองใหม่ และพร้อมออกผจญภัยต่อ!').slice(0, 500);
  dryRun(res, (c) => {
    addLog(c.id, { type: 'llm_tale', title: '📖 เรื่องราวการผจญภัย', detail: text });
    return { message: '📖 ลองเล่น: เขียนเรื่องราวทดสอบแล้ว (จะเด้ง modal ตอนจบ session — ไม่บันทึก)' };
  });
});

// ปลดล็อก achievement (ปกติ/ลับ) พร้อมรางวัล
router.post('/dev/achieve', requireDev, (req, res) => {
  const { id } = req.body || {};
  const a = [...ACHIEVEMENTS, ...SECRET_ACHIEVEMENTS].find((x) => x.id === id);
  if (!a) return res.status(400).json({ error: 'achievement ไม่พบ (ดู id ใน server/data.js)' });
  dryRun(res, (c) => {
    const ins = db.prepare('INSERT OR IGNORE INTO achievement_unlock (character_id, achievement_id) VALUES (?, ?)').run(c.id, id);
    let ups = 0;
    if (ins.changes) {
      if (a.reward.gold) c.gold += a.reward.gold;
      if (a.reward.xp) ups = gainXp(c, a.reward.xp);
      updateCharacter(c);
      addLog(c.id, { type: 'achievement', title: `🏅 ปลดล็อก (dev): ${a.name}`, detail: a.desc, gold: a.reward.gold || 0, xp: a.reward.xp || 0 });
    }
    return {
      message: ins.changes ? `🏅 ลองเล่น: ปลดล็อก "${a.name}" (+${a.reward.gold || 0} ทอง) (ไม่บันทึก)` : `"${a.name}" ปลดล็อกอยู่แล้ว (ไม่บันทึก)`,
    };
  });
});

// เรียนรู้สกิลสุ่มจากคัมภีร์ (ทดสอบระบบสกิลคัมภีร์)
router.post('/dev/learn-skill', requireDev, (req, res) => {
  const id = req.body?.skillId || SCROLL_SKILLS[Math.floor(Math.random() * SCROLL_SKILLS.length)].id;
  const sk = SCROLL_SKILL_BY_ID[id];
  if (!sk) return res.status(400).json({ error: 'สกิลไม่พบ (ดู id ใน server/data.js)' });
  dryRun(res, (c) => {
    if (getSkillRow(c.id, sk.id)) {
      return { message: `📖 ลองเล่น: เรียนรู้ ${sk.name} อยู่แล้ว (ไม่บันทึก)` };
    }
    learnSkill(c.id, sk.id, 'scroll');
    addLog(c.id, { type: 'skill_learn', title: `📖 เรียนรู้สกิล (dev): ${sk.icon} ${sk.name}`, detail: `จาก dev panel — ใช้สู้บอสได้เลย! (${sk.mp} MP)` });
    return { message: `📖 ลองเล่น: เรียนรู้สกิล ${sk.name} แล้ว! (ไม่บันทึก)` };
  });
});

// ให้ XP สกิลทุกตัว (ทดสอบเลเวลสกิล — +10%/เลเวล สูงสุด Lv.5)
router.post('/dev/skill-xp', requireDev, (req, res) => {
  const amount = Math.max(1, Math.round(Number(req.body?.amount) || 120));
  dryRun(res, (c) => {
    const skills = getCharacterSkills(c);
    let leveled = 0;
    for (const s of skills) grantSkillXp(c, s.id, amount).levelUp && leveled++;
    return { message: `⭐ ลองเล่น: ให้ XP ${amount} กับทุกสกิล${leveled ? ` — อัพเลเวล ${leveled} สกิล!` : ''} (ไม่บันทึก)` };
  });
});

// ชนะบอสทันที (ทดสอบรอบเมือง / วัฏจักร) — ไม่ย้ายเมืองอัตโนมัติ (เหมือนเกมจริง: เลือกเดินทางต่อ/อยู่ต่อ)
router.post('/dev/boss-win', requireDev, (req, res) => {
  dryRun(res, (c) => {
    const boss = generateBoss(c.level, c.city_index, c);
    const prog = getProgress(c.id);
    const rMult = exploreRewardMult(c);
    const xp = Math.round((250 + 60 * c.level) * rMult);
    const gold = Math.round((120 + 40 * c.level) * rMult);
    const ups = gainXp(c, xp);
    c.gold += gold;
    prog.cycles_completed += 1;
    prog.bosses_defeated += 1;
    prog.gold_earned += gold;
    if (c.challenge_mode) prog[`${c.challenge_mode}_cycles`] = (prog[`${c.challenge_mode}_cycles`] || 0) + 1;
    db.prepare('UPDATE progress SET cycles_completed=?, bosses_defeated=?, gold_earned=?, hard_cycles=?, marathon_cycles=?, survival_cycles=? WHERE id=?')
      .run(prog.cycles_completed, prog.bosses_defeated, prog.gold_earned, prog.hard_cycles || 0, prog.marathon_cycles || 0, prog.survival_cycles || 0, prog.id);
    const drop = Math.random() < 0.35
      ? pickGear(c.level)
      : null;
    if (drop) addItem(c.id, drop.id);
    const altNote = boss.isAlt ? ` (บอสลับ — ของพิเศษการันตี!)` : '';
    updateCharacter(c);
    addLog(c.id, { type: 'boss_win', title: '🏆 ชนะบอส! (dev)', detail: `กำราบ ${boss.name} ได้!${altNote}`, xp, gold });
    bumpDaily(c.id, 'boss_wins');
    const stats = computeStats(c);
    const ach = checkAchievements(c, prog, {
      bossWin: { hp: c.hp, pct: (c.hp / stats.maxHp) * 100, noEquip: false, cityIndex: c.city_index },
    });
    return {
      achievements: ach.fresh,
      levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
      message: `🏆 ลองเล่น: ชนะบอส ${boss.name}${altNote} +${xp} XP, +${gold} ทอง → ยังอยู่ที่ ${CITIES[c.city_index].name} (เลือกเดินทางต่อ/อยู่ต่อในเกมจริง) (ไม่บันทึก)`,
    };
  });
});

const pickGear = (level) => {
  const pool = Object.values(ITEM_BY_ID).filter((i) => !i.exclusive && i.type !== 'consumable' && i.type !== 'junk' && (i.lvl || 1) <= level + 1);
  return pool[Math.floor(Math.random() * pool.length)] || null;
};

export default router;
