import { CLASSES, ITEM_BY_ID, CITIES, BOSSES, MONSTERS, EVENT_POOL, QUESTS } from './data.js';

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const xpToNext = (level) => Math.floor(80 * Math.pow(level, 1.6));

// คำนวณค่าสถานะแสดงผล = สถานะฐาน/เติบโต + โบนัสจากอุปกรณ์ที่สวม
export function computeStats(c) {
  const eq = [c.weapon_id, c.armor_id, c.accessory_id]
    .filter(Boolean)
    .map((id) => ITEM_BY_ID[id])
    .filter(Boolean);
  const s = {
    maxHp: c.max_hp + eq.reduce((a, i) => a + (i.hp_bonus || 0), 0),
    maxMp: c.max_mp + eq.reduce((a, i) => a + (i.mp_bonus || 0), 0),
    atk: c.atk + eq.reduce((a, i) => a + (i.atk_bonus || 0), 0),
    def: c.def + eq.reduce((a, i) => a + (i.def_bonus || 0), 0),
    spd: c.spd + eq.reduce((a, i) => a + (i.spd_bonus || 0), 0),
    crit: c.crit + eq.reduce((a, i) => a + (i.crit_bonus || 0), 0),
  };
  return {
    ...s,
    hp: clamp(c.hp, 0, s.maxHp),
    mp: clamp(c.mp, 0, s.maxMp),
    weapon: c.weapon_id ? ITEM_BY_ID[c.weapon_id] : null,
    armor: c.armor_id ? ITEM_BY_ID[c.armor_id] : null,
    accessory: c.accessory_id ? ITEM_BY_ID[c.accessory_id] : null,
  };
}

export function serializeCharacter(c) {
  const cls = CLASSES[c.class];
  const stats = computeStats(c);
  return {
    id: c.id,
    name: c.name,
    class: c.class,
    className: cls.name,
    classEn: cls.en,
    classIcon: cls.icon,
    level: c.level,
    xp: c.xp,
    xpToNext: xpToNext(c.level),
    gold: c.gold,
    statPoints: c.stat_points,
    cityIndex: c.city_index,
    city: CITIES[c.city_index % CITIES.length],
    ...stats,
  };
}

// การเติบโตเมื่อเลเวลอัพ (ทำกับค่าฐานที่เก็บใน DB)
export function applyLevelUp(c, n = 1) {
  let ups = 0;
  for (let i = 0; i < n; i++) {
    c.level += 1;
    c.stat_points += 5;
    c.max_hp += 10;
    c.max_mp += 3;
    c.atk += 2;
    c.def += 1;
    c.spd += 1;
    ups += 1;
  }
  return ups;
}

// เติม XP และอัพเลเวลอัตโนมัติ — คืนจำนวนเลเวลที่อัพ
export function gainXp(c, amount) {
  c.xp += amount;
  let ups = 0;
  while (c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    applyLevelUp(c, 1);
    ups += 1;
  }
  return ups;
}

// ดาเมจโจมตีธรรมดา
export function attackDamage(atk, def) {
  const base = atk * (0.85 + Math.random() * 0.3) - def * 0.4;
  return Math.max(1, Math.round(base));
}

export function isCrit(critPct) {
  return Math.random() * 100 < critPct;
}

// ----- ระบบมอนสเตอร์ / ต่อสู้อัตโนมัติ (ช่วง work session — ไม่รบกวนสมาธิ) -----
export function rollMonster(level) {
  const m = pick(MONSTERS);
  const power = Math.round((12 + 5 * level) * m.power);
  return { ...m, power };
}

export function playerPower(c) {
  const s = computeStats(c);
  return s.atk + s.spd * 0.6 + c.level * 2;
}

// ต่อสู้แบบ auto — คืนผลลัพธ์
export function resolveCombat(c, monster) {
  const p = playerPower(c);
  const win = Math.random() < p / (p + monster.power);
  const stats = computeStats(c);
  let hpLoss = 0;
  let xp = 0;
  let gold = 0;
  let detail = '';
  if (win) {
    xp = monster.xp + rand(0, 8) + c.level;
    gold = monster.gold + rand(0, 6);
    hpLoss = rand(3, 9);
    detail = `🗡️ กำราบ ${monster.name} ได้สำเร็จ! (+${xp} XP, +${gold} ทอง)`;
  } else {
    xp = Math.max(2, Math.round(monster.xp * 0.25));
    hpLoss = Math.round(stats.maxHp * 0.08) + rand(2, 6);
    detail = `💨 โดน ${monster.name} ต้อนจนต้องหนี… (ได้ ${xp} XP แต่เสียพลังไป ${hpLoss})`;
  }
  c.hp = Math.max(1, c.hp - hpLoss);
  const ups = gainXp(c, xp);
  c.gold += gold;
  return { win, xp, gold, hpLoss, detail, monster, ups };
}

// ----- เหตุการณ์สุ่มระหว่าง session -----
export function rollEvent(c) {
  const total = EVENT_POOL.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * total;
  let ev = EVENT_POOL[0];
  for (const e of EVENT_POOL) {
    r -= e.weight;
    if (r <= 0) { ev = e; break; }
  }

  const city = CITIES[c.city_index % CITIES.length];
  const base = {
    key: ev.key,
    title: ev.title,
    flavor: ev.flavor.replace('{monster}', '???'),
    xp: 0, gold: 0, item: null, hpChange: 0, mpChange: 0,
  };

  if (ev.key === 'monster') {
    const m = rollMonster(c.level);
    const res = resolveCombat(c, m);
    return {
      ...base,
      flavor: ev.flavor.replace('{monster}', `${m.icon} ${m.name} (พลัง ${m.power})`),
      xp: res.xp, gold: res.gold, hpChange: -res.hpLoss,
      detail: res.detail,
      monster: { name: m.name, icon: m.icon, win: res.win },
      logType: res.win ? 'battle_win' : 'battle_lose',
      ups: res.ups,
    };
  }

  if (ev.key === 'treasure') {
    const xp = rand(10, 25) + c.level;
    const gold = rand(15, 45) + c.level * 2;
    c.gold += gold;
    const ups = gainXp(c, xp);
    base.xp = xp; base.gold = gold;
    base.ups = ups;
    base.detail = `เปิดกล่องสมบัติ: ได้ทอง ${gold} และประสบการณ์ ${xp}`;
    if (Math.random() < 0.12) {
      const item = pick(Object.values(ITEM_BY_ID).filter((i) => i.type === 'consumable' || (i.lvl || 1) <= c.level + 1));
      base.item = { id: item.id, name: item.name, icon: item.icon };
      base.detail += ` — และพบ ${item.icon} ${item.name}!`;
    }
    base.logType = 'treasure';
    return base;
  }

  if (ev.key === 'shrine') {
    const stats = computeStats(c);
    if (Math.random() < 0.5 || c.mp >= stats.maxMp) {
      const xp = rand(20, 40) + c.level;
      base.ups = gainXp(c, xp);
      base.xp = xp;
      base.detail = `สวดมนต์ที่ศาลเจ้า ได้แรงบันดาลใจ (+${xp} XP)`;
    } else {
      const mp = Math.round(stats.maxMp * 0.4);
      c.mp = clamp(c.mp + mp, 0, stats.maxMp);
      base.mpChange = mp;
      base.detail = `พลังศักดิ์สิทธิ์หลั่งไหลเข้าใส่ (+${mp} MP)`;
    }
    base.logType = 'shrine';
    return base;
  }

  if (ev.key === 'merchant') {
    if (Math.random() < 0.5) {
      const gold = rand(5, 15);
      c.gold += gold;
      base.gold = gold;
      base.detail = `ซื้อของที่ระลึกจากพ่อค้าและขายต่อ ได้กำไร ${gold} ทอง`;
    } else {
      const item = pick([1, 3]);
      base.item = { id: item.id, name: ITEM_BY_ID[item].name, icon: ITEM_BY_ID[item].icon };
      base.detail = `พ่อค้าใจดีแถม ${ITEM_BY_ID[item].icon} ${ITEM_BY_ID[item].name} ให้ฟรี!`;
    }
    base.logType = 'merchant';
    return base;
  }

  if (ev.key === 'trap') {
    const stats = computeStats(c);
    const hpLoss = Math.round(stats.maxHp * 0.06) + rand(2, 5);
    c.hp = Math.max(1, c.hp - hpLoss);
    base.hpChange = -hpLoss;
    base.detail = `หลบไม่ทัน เสียพลังไป ${hpLoss} — แต่เก็บเศษสมบัติได้นิดหน่อย`;
    if (Math.random() < 0.4) {
      const xp = rand(5, 12);
      base.ups = gainXp(c, xp);
      base.xp = xp;
      base.detail += ` (+${xp} XP)`;
    }
    base.logType = 'trap';
    return base;
  }
  return base;
}

// ----- บอส (พักใหญ่หลังครบ 4 session) -----
export function generateBoss(level, cityIndex) {
  const boss = BOSSES[cityIndex % BOSSES.length];
  const maxHp = 90 + 32 * level;
  return {
    name: boss.name,
    icon: boss.icon,
    maxHp,
    hp: maxHp,
    atk: 9 + Math.round(2.5 * level),
    def: 3 + level,
    crit: 10,
  };
}

export function bossPlayerTurn(c, fight, action, itemId) {
  const stats = computeStats(c);
  const log = [];
  let outcome = null; // null = ยังสู้, 'win' | 'lose'

  if (action === 'attack') {
    const crit = isCrit(stats.crit);
    let dmg = attackDamage(stats.atk, fight.boss.def);
    if (crit) dmg = Math.round(dmg * 1.7);
    fight.boss.hp = Math.max(0, fight.boss.hp - dmg);
    log.push(`⚔️ ${c.name} โจมตี${crit ? ' — คริติคอล!!' : ''} โดน ${dmg} ดาเมจ`);
  } else if (action === 'skill') {
    const cost = 12 + c.level;
    if (c.mp < cost) return { error: 'มานาไม่พอ!' };
    c.mp -= cost;
    const crit = isCrit(stats.crit);
    let dmg = Math.round(stats.atk * 1.6 - fight.boss.def * 0.5);
    if (crit) dmg = Math.round(dmg * 1.7);
    fight.boss.hp = Math.max(0, fight.boss.hp - dmg);
    log.push(`🔮 ใช้พลังเวท (-${cost} MP) โดน ${dmg} ดาเมจ${crit ? ' — คริติคอล!!' : ''}`);
  } else if (action === 'potion') {
    const inv = c.inv || [];
    const slot = inv.find((i) => i.item_id === itemId);
    const item = ITEM_BY_ID[itemId];
    if (!slot || slot.qty <= 0) return { error: 'ไม่มีไอเทมนี้ในกระเป๋า' };
    if (!item || item.type !== 'consumable') return { error: 'ใช้ไอเทมนี้ไม่ได้' };
    let used = false;
    if (item.heal_pct && c.hp < stats.maxHp) {
      c.hp = clamp(c.hp + Math.round(stats.maxHp * item.heal_pct), 0, stats.maxHp);
      used = true;
    }
    if (item.mana_pct && c.mp < stats.maxMp) {
      c.mp = clamp(c.mp + Math.round(stats.maxMp * item.mana_pct), 0, stats.maxMp);
      used = true;
    }
    if (!used) return { error: 'พลังยังเต็มอยู่ ไม่จำเป็นต้องใช้' };
    slot.qty -= 1;
    log.push(`🧪 ใช้ ${item.icon} ${item.name} — ฟื้นพลัง! (HP ${c.hp}/${stats.maxHp}, MP ${c.mp}/${stats.maxMp})`);
  }

  // เทิร์นบอส
  if (fight.boss.hp > 0) {
    const crit = Math.random() * 100 < fight.boss.crit;
    let dmg = attackDamage(fight.boss.atk, stats.def);
    if (crit) dmg = Math.round(dmg * 1.5);
    c.hp = Math.max(1, c.hp - dmg);
    log.push(`💢 ${fight.boss.icon} ${fight.boss.name} ตอบโต้ โดน ${dmg} ดาเมจ${crit ? ' — คริติคอล!' : ''}`);
  }

  if (fight.boss.hp <= 0) {
    outcome = 'win';
    const xp = 250 + 60 * c.level;
    const gold = 120 + 40 * c.level;
    const ups = gainXp(c, xp);
    c.gold += gold;
    const drop = Math.random() < 0.35 ? pick(Object.values(ITEM_BY_ID).filter((i) => i.type !== 'consumable' && (i.lvl || 1) <= c.level + 1)) : null;
    log.push(`🏆 กำราบ ${fight.boss.name} ได้! +${xp} XP, +${gold} ทอง${drop ? ` และได้ ${drop.icon} ${drop.name}` : ''}`);
    return { log, outcome, xp, gold, item: drop, boss: fight.boss, ups };
  }

  return { log, outcome, boss: fight.boss };
}

// ----- ภารกิจช่วงพักสั้น -----
export function rollQuests(level, count = 3) {
  const pool = [...QUESTS];
  const picked = [];
  while (picked.length < count && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked.map((q) => ({
    ...q,
    xp: Math.round(q.xp * (1 + level * 0.08)),
    gold: Math.round(q.gold * (1 + level * 0.08)),
  }));
}

export function resolveQuest(c, quest) {
  const success = Math.random() < quest.success;
  const scale = 1 + c.level * 0.08;
  let xp = 0, gold = 0, hpChange = 0, item = null, detail = '', ups = 0;
  if (success) {
    xp = Math.round(quest.xp * scale); gold = Math.round(quest.gold * scale);
    ups = gainXp(c, xp);
    c.gold += gold;
    detail = `✅ ${quest.win} (+${xp} XP, +${gold} ทอง)`;
    if (Math.random() < 0.15) {
      const i = pick([1, 3]);
      item = { id: i, name: ITEM_BY_ID[i].name, icon: ITEM_BY_ID[i].icon };
      detail += ` และได้ ${ITEM_BY_ID[i].icon} ${ITEM_BY_ID[i].name}`;
    }
  } else {
    const stats = computeStats(c);
    hpChange = -Math.round(stats.maxHp * 0.05);
    c.hp = Math.max(1, c.hp + hpChange);
    xp = Math.round(quest.xp * scale * 0.2);
    ups = gainXp(c, xp);
    detail = `⚠️ ${quest.fail} (ได้ ${xp} XP แต่เสียพลัง ${-hpChange})`;
  }
  return { success, xp, gold, hpChange, item, detail, ups };
}
