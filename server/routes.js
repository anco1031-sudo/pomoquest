import { Router } from 'express';
import {
  db, getCharacter, getProgress, getSettings, getInventory, getLog, addLog,
  addItem, updateCharacter,
} from './db.js';
import {
  CLASSES, ITEM_BY_ID, CITIES, QUESTS, SHOP_STOCK,
} from './data.js';
import {
  computeStats, serializeCharacter, gainXp, rollEvent, generateBoss, bossPlayerTurn,
  rollQuests, resolveQuest,
} from './game.js';
import { checkAchievements, getAchievementList } from './achievements.js';

const router = Router();

// ----- ในหน่วยความจำ: สถานะการสู้บอส (key = character id) -----
const fights = new Map();

const requireChar = (res) => {
  const c = getCharacter();
  if (!c) { res.status(404).json({ error: 'ยังไม่มีตัวละคร' }); return null; }
  return c;
};

const serialize = (c) => ({ character: serializeCharacter(c) });

// ----- สถานะรวม -----
router.get('/state', (req, res) => {
  const c = getCharacter();
  if (!c) return res.json({ hasCharacter: false, settings: getSettings() });
  res.json({
    hasCharacter: true,
    ...serialize(c),
    inventory: getInventory(c.id),
    progress: getProgress(c.id),
    achievements: getAchievementList(c, getProgress(c.id)),
    log: getLog(c.id),
    settings: getSettings(),
  });
});

// รายการ achievement ทั้งหมด (สำหรับหน้า "ตรา")
router.get('/achievements', (req, res) => {
  const c = requireChar(res); if (!c) return;
  res.json({ achievements: getAchievementList(c, getProgress(c.id)) });
});

// ----- ตัวละคร -----
router.post('/character/create', (req, res) => {
  const { name, class: cls } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'ต้องตั้งชื่อตัวละคร' });
  if (!CLASSES[cls]) return res.status(400).json({ error: 'เลือกคลาสไม่ถูกต้อง' });
  if (getCharacter()) return res.status(409).json({ error: 'มีตัวละครอยู่แล้ว — กดเริ่มเกมใหม่เพื่อสร้างใหม่' });

  const b = CLASSES[cls].base;
  const info = db.prepare(`INSERT INTO character (name, class, hp, max_hp, mp, max_mp, atk, def, spd, crit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name.trim().slice(0, 20), cls, b.hp, b.hp, b.mp, b.mp, b.atk, b.def, b.spd, b.crit);
  const c = db.prepare('SELECT * FROM character WHERE id = ?').get(info.lastInsertRowid);
  addLog(c.id, { type: 'system', title: '🎒 เริ่มการผจญภัย', detail: `${c.name} (${CLASSES[cls].name}) ออกเดินทางจาก ${CITIES[0].name}!` });
  res.json({ ...serialize(c), progress: getProgress(c.id) });
});

router.post('/character/reset', (req, res) => {
  const c = getCharacter();
  if (!c) return res.json({ ok: true });
  db.prepare('DELETE FROM inventory WHERE character_id = ?').run(c.id);
  db.prepare('DELETE FROM progress WHERE character_id = ?').run(c.id);
  db.prepare('DELETE FROM log WHERE character_id = ?').run(c.id);
  db.prepare('DELETE FROM character WHERE id = ?').run(c.id);
  fights.delete(c.id);
  res.json({ ok: true });
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
  const ev = rollEvent(c);
  updateCharacter(c);
  addLog(c.id, { type: ev.logType || ev.key, title: ev.title, detail: ev.detail, xp: ev.xp, gold: ev.gold });
  if (ev.item) addItem(c.id, ev.item.id);
  // อัปเดต counter สถิติ (รวมตัวที่ใช้ตรวจตราลับ)
  const prog = getProgress(c.id);
  const up = (col, val) => db.prepare(`UPDATE progress SET ${col}=? WHERE id=?`).run(val, prog.id);
  if (ev.key === 'monster' && ev.monster?.win) { prog.monsters_slain += 1; up('monsters_slain', prog.monsters_slain); }
  if (ev.key === 'treasure') { prog.treasures_found += 1; up('treasures_found', prog.treasures_found); }
  if (ev.key === 'shrine') { prog.shrines += 1; up('shrines', prog.shrines); }
  if (ev.key === 'trap') { prog.traps += 1; up('traps', prog.traps); }
  if (ev.key === 'merchant' && ev.item) { prog.merchant_gifts += 1; up('merchant_gifts', prog.merchant_gifts); }
  const ach = checkAchievements(c, prog, { event: ev });
  res.json({
    ...serialize(c),
    event: ev,
    progress: getProgress(c.id),
    achievements: ach.fresh,
    levelUps: { levels: (ev.ups || 0) + ach.ups, statPoints: c.stat_points },
  });
});

router.post('/adventure/complete', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { focusSec = 1500 } = req.body || {};
  const prog = getProgress(c.id);

  prog.streak += 1;
  prog.best_streak = Math.max(prog.best_streak, prog.streak);
  prog.sessions_completed += 1;
  prog.total_focus_sec += focusSec;

  const bonus = 1 + Math.min(prog.streak - 1, 4) * 0.1;
  const xp = Math.round((100 + 20 * c.level) * bonus);
  const gold = 25 + 8 * c.level;
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
  addLog(c.id, {
    type: 'session_done', title: '✅ จบเซสชันโฟกัส', detail: `โฟกัสครบ! +${xp} XP${streakMsg}, +${gold} ทอง`,
    xp, gold,
  });
  const ach = checkAchievements(c, prog, { hour: parseInt(timeRow.h, 10) });
  res.json({
    ...serialize(c),
    progress: getProgress(c.id),
    reward: { xp, gold, bonus, streak: prog.streak },
    achievements: ach.fresh,
    levelUps: { levels: ups + ach.ups, statPoints: c.stat_points },
  });
});

router.post('/adventure/abort', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const prog = getProgress(c.id);
  prog.streak = 0;
  db.prepare('UPDATE progress SET streak = 0 WHERE id = ?').run(prog.id);
  addLog(c.id, { type: 'abort', title: '💨 ละทิ้งเซสชัน', detail: 'คอมโบโฟกัสหายไป (เริ่มใหม่จาก 1)' });
  res.json({ progress: getProgress(c.id) });
});

// ----- ค่ายพัก (short break) -----
router.get('/camp', (req, res) => {
  const c = requireChar(res); if (!c) return;
  res.json({
    ...serialize(c),
    inventory: getInventory(c.id),
    shop: SHOP_STOCK.filter((i) => i.type === 'consumable' || (i.lvl || 1) <= c.level + 1)
      .map((i) => ({ ...i, owned: getInventory(c.id).find((x) => x.item_id === i.id)?.qty || 0 })),
    quests: rollQuests(c.level, 3),
  });
});

router.post('/shop/buy', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId, qty = 1 } = req.body || {};
  const item = ITEM_BY_ID[itemId];
  if (!item) return res.status(400).json({ error: 'ไอเทมไม่มีอยู่' });
  if (item.type !== 'consumable' && (item.lvl || 1) > c.level + 1) return res.status(400).json({ error: 'เลเวลยังไม่พอจะใช้ของแบบนี้' });
  const cost = item.price * qty;
  if (c.gold < cost) return res.status(400).json({ error: 'ทองไม่พอ!' });
  c.gold -= cost;
  addItem(c.id, itemId, qty);
  updateCharacter(c);
  addLog(c.id, { type: 'shop', title: '🛒 ซื้อของ', detail: `ซื้อ ${item.icon} ${item.name} x${qty} (-${cost} ทอง)`, gold: -cost });
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `ซื้อ ${item.name} สำเร็จ` });
});

router.post('/shop/sell', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId, qty = 1 } = req.body || {};
  const inv = getInventory(c.id).find((i) => i.item_id === itemId);
  if (!inv || inv.qty < qty) return res.status(400).json({ error: 'ไม่มีไอเทมพอจะขาย' });
  const gain = Math.round(inv.price * 0.5) * qty;
  c.gold += gain;
  db.prepare('UPDATE inventory SET qty = qty - ? WHERE character_id = ? AND item_id = ?').run(qty, c.id, itemId);
  updateCharacter(c);
  addLog(c.id, { type: 'shop', title: '💰 ขายของ', detail: `ขาย ${inv.icon} ${inv.name} x${qty} (+${gain} ทอง)`, gold: gain });
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `ขายได้ ${gain} ทอง` });
});

router.post('/inventory/use', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId } = req.body || {};
  const inv = getInventory(c.id).find((i) => i.item_id === itemId);
  if (!inv) return res.status(400).json({ error: 'ไม่มีไอเทมนี้' });
  const item = ITEM_BY_ID[itemId];
  const stats = computeStats(c);
  let used = false;
  if (item.heal_pct && c.hp < stats.maxHp) { c.hp = Math.min(stats.maxHp, c.hp + Math.round(stats.maxHp * item.heal_pct)); used = true; }
  if (item.mana_pct && c.mp < stats.maxMp) { c.mp = Math.min(stats.maxMp, c.mp + Math.round(stats.maxMp * item.mana_pct)); used = true; }
  if (!used) return res.status(400).json({ error: 'พลังเต็มอยู่แล้ว' });
  db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
  updateCharacter(c);
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `ใช้ ${item.name} เรียบร้อย` });
});

router.post('/inventory/equip', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const { itemId } = req.body || {};
  const inv = getInventory(c.id).find((i) => i.item_id === itemId);
  if (!inv) return res.status(400).json({ error: 'ไม่มีไอเทมนี้' });
  const item = ITEM_BY_ID[itemId];
  if (item.type === 'consumable') return res.status(400).json({ error: 'ไอเทมนี้ใช้ไม่ได้กับช่องสวมใส่' });

  const slot = item.type === 'weapon' ? 'weapon_id' : item.type === 'armor' ? 'armor_id' : 'accessory_id';
  const oldId = c[slot];
  // ถอดของเก่าคืนกระเป๋า
  if (oldId) addItem(c.id, oldId, 1);
  // ใส่ของใหม่
  db.prepare('UPDATE inventory SET qty = qty - 1 WHERE character_id = ? AND item_id = ?').run(c.id, itemId);
  c[slot] = itemId;
  updateCharacter(c);
  addLog(c.id, { type: 'equip', title: '🔧 สวมใส่', detail: `สวม ${item.icon} ${item.name}` });
  const ach = checkAchievements(c, getProgress(c.id));
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `สวม ${item.name} เรียบร้อย`, achievements: ach.fresh, levelUps: { levels: ach.ups, statPoints: c.stat_points } });
});

router.post('/camp/rest', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const stats = computeStats(c);
  c.hp = stats.maxHp; c.mp = stats.maxMp;
  updateCharacter(c);
  addLog(c.id, { type: 'rest', title: '🔥 พักแคมป์', detail: 'นอนพักข้างกองไฟ — พลังเต็มเปี่ยม!' });
  res.json({ ...serialize(c), message: 'พักผ่อนจนพลังเต็มแล้ว!' });
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
  const ach = checkAchievements(c, prog);
  res.json({
    ...serialize(c), result, inventory: getInventory(c.id),
    achievements: ach.fresh,
    progress: getProgress(c.id),
    levelUps: { levels: (result.ups || 0) + ach.ups, statPoints: c.stat_points },
  });
});

// ----- บอส (long break) -----
router.get('/boss', (req, res) => {
  const c = requireChar(res); if (!c) return;
  let fight = fights.get(c.id);
  if (!fight) {
    fight = { boss: generateBoss(c.level, c.city_index) };
    fights.set(c.id, fight);
  }
  res.json({ ...serialize(c), boss: { ...fight.boss, hp: fight.boss.hp } });
});

router.post('/boss/act', (req, res) => {
  const c = requireChar(res); if (!c) return;
  const fight = fights.get(c.id);
  if (!fight) return res.status(400).json({ error: 'ยังไม่เริ่มสู้บอส' });
  const { action, itemId } = req.body || {};
  c.inv = getInventory(c.id);
  const result = bossPlayerTurn(c, fight, action, itemId);
  if (result.error) return res.status(400).json({ error: result.error });

  updateCharacter(c);

  const prog = getProgress(c.id);
  if (action === 'potion' && !result.error) {
    prog.boss_potions += 1;
    db.prepare('UPDATE progress SET boss_potions=? WHERE id=?').run(prog.boss_potions, prog.id);
  }

  let ach = { fresh: [], ups: 0 };
  if (result.outcome === 'win') {
    const foughtCity = c.city_index;
    const stats = computeStats(c);
    prog.cycles_completed += 1;
    prog.bosses_defeated += 1;
    prog.gold_earned += result.gold || 0;
    db.prepare(`UPDATE progress SET cycles_completed=@cycles_completed, bosses_defeated=@bosses_defeated, gold_earned=@gold_earned WHERE id=@id`).run(prog);
    if (result.item) addItem(c.id, result.item.id);
    c.city_index = (c.city_index + 1) % CITIES.length;
    updateCharacter(c);
    fights.delete(c.id);
    addLog(c.id, { type: 'boss_win', title: '🏆 ชนะบอส!', detail: `กำราบ ${fight.boss.name} และเดินทางสู่ ${CITIES[c.city_index].name}!`, xp: result.xp, gold: result.gold });
    ach = checkAchievements(c, prog, {
      bossWin: {
        hp: c.hp,
        pct: (c.hp / stats.maxHp) * 100,
        noEquip: !c.weapon_id && !c.armor_id && !c.accessory_id,
        cityIndex: foughtCity,
      },
    });
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

// ----- ตั้งค่า -----
router.put('/settings', (req, res) => {
  const s = getSettings();
  const { work_min, short_break_min, long_break_min, sessions_per_cycle, event_every_sec } = req.body || {};
  db.prepare(`UPDATE settings SET work_min=?, short_break_min=?, long_break_min=?, sessions_per_cycle=?, event_every_sec=? WHERE id=1`)
    .run(
      Math.max(1, Math.min(90, work_min ?? s.work_min)),
      Math.max(1, Math.min(30, short_break_min ?? s.short_break_min)),
      Math.max(1, Math.min(60, long_break_min ?? s.long_break_min)),
      Math.max(1, Math.min(8, sessions_per_cycle ?? s.sessions_per_cycle)),
      Math.max(30, Math.min(600, event_every_sec ?? s.event_every_sec)),
    );
  res.json({ settings: getSettings() });
});

export default router;
