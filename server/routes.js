import { Router } from 'express';
import {
  db, getCharacter, getCharacters, getProgress, getSettings, getInventory, getLog, addLog,
  addItem, updateCharacter, getActiveCharacterId, setActiveCharacter, deleteCharacter, bumpDaily,
} from './db.js';
import {
  CLASSES, ITEM_BY_ID, CITIES, QUESTS, SHOP_STOCK,
} from './data.js';
import {
  computeStats, serializeCharacter, gainXp, rollEvent, generateBoss, bossPlayerTurn,
  rollQuests, resolveQuest, SLOT_COLS,
} from './game.js';
import { checkAchievements, getAchievementList } from './achievements.js';
import { getDailyQuests, claimDailyQuest, claimDailyAll } from './daily.js';
import { llmChat } from './llm.js';

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
  const { name, class: cls } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'ต้องตั้งชื่อตัวละคร' });
  if (!CLASSES[cls]) return res.status(400).json({ error: 'เลือกคลาสไม่ถูกต้อง' });
  if (nameTaken(name.trim())) return res.status(400).json({ error: `มีตัวละครชื่อ "${name.trim()}" อยู่แล้ว — ลองชื่ออื่น` });

  const b = CLASSES[cls].base;
  const info = db.prepare(`INSERT INTO character (name, class, hp, max_hp, mp, max_mp, atk, def, spd, crit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name.trim().slice(0, 20), cls, b.hp, b.hp, b.mp, b.mp, b.atk, b.def, b.spd, b.crit);
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
    xp, gold, focusSec,
  });

  // สรุปการผจญภัยด้วย LLM (ถ้าเปิดใช้) — fire-and-forget: ไม่บล็อก response, error → เงียบ (เกมใช้ข้อความเดิม)
  const city = CITIES[c.city_index % CITIES.length];
  llmChat({
    system: 'You are the narrator of PomoQuest, a Pomodoro RPG game. Write a short, vivid 2-3 sentence adventure story in Thai mixed with English (like the game\'s style). Narrate only what happened during this focus session — never invent rewards, numbers, items or levels. Keep it fun and concise.',
    user: JSON.stringify({
      character: c.name, class: CLASSES[c.class]?.name || c.class, level: c.level,
      city: city.name, terrain: city.terrain,
      focusMinutes: Math.round(focusSec / 60), streak: prog.streak,
      xpGained: xp, goldGained: gold, sessionsCompleted: prog.sessions_completed,
    }),
  }).then((tale) => {
    if (tale) addLog(c.id, { type: 'llm_tale', title: '📖 เรื่องราวการผจญภัย', detail: tale.slice(0, 500) });
  }).catch(() => {});
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
  bumpDaily(c.id, 'items_bought', qty);
  res.json({ ...serialize(c), inventory: getInventory(c.id), message: `ซื้อ ${item.name} สำเร็จ`, ...dailyPayload(c) });
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
  let ups = 0;
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
    bumpDaily(c.id, 'potions');
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

  // เมืองที่ชนะบอสมาแล้ว (จาก log boss_win)
  const cityLogs = db.prepare("SELECT detail FROM log WHERE character_id = ? AND type = 'boss_win' ORDER BY id").all(c.id);

  res.json({
    character: serializeCharacter(c),
    progress: prog,
    days,
    cityLogs,
    achievements: { unlocked: ach.unlocked, total: ach.total },
    settings: getSettings(),
  });
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
