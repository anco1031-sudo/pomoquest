import { CLASSES, ITEMS, ITEM_BY_ID, CITIES, BOSSES, ALT_BOSSES, altBossAt, BOSS_SKILLS, BOSS_LOADOUTS, MONSTERS, EVENT_POOL, QUESTS, COMMON_LOOT, RARE_JUNK, SKILLS, SCROLL_SKILLS, SCROLL_SKILL_BY_ID, SCROLL_ITEMS, RANKS, COMPANIONS, FESTIVALS, STORY_QUESTS } from './data.js';
import { today, getSkillRows, getSkillRow, upsertSkillRow } from './db.js';

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ----- PRNG แบบ seed ได้ — ราคาขายตอนค่ายพักต้องคำนวณซ้ำได้เหมือนเดิมจาก visit เดียวกัน -----
const hashSeed = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ----- ตลาดมืด (black market) — เจอสุ่ม ~25% ต่อค่ายพัก (deterministic จาก visit — refresh แล้วเหมือนเดิม) -----
// เลือก "สำรวจเมืองเดิมต่อ" หลังชนะบอส → โอกาสเจอตลาดมืดเพิ่มขึ้น (+10% ต่อรอบ สูงสุด +35%)
// รับซื้อของขวัญ (junk) แพงกว่าปกติ +25% · ขาย: คัมภีร์สกิล (ลด 15%), ของหายาก (ลด 25%), ของเถื่อนเก็งกำไร (ลด 45%), ของพิเศษ exclusive (ลด 10%)
export const BM_OPEN_CHANCE = 0.25;
export const BM_JUNK_MULT = 1.25;
// โบนัสโอกาสเจอตลาดมืดจากการสำรวจเมืองเดิมต่อ — +10% ต่อรอบ สูงสุด +35% (รวมสูงสุด 60%)
export const bmExtraChance = (c) => Math.round(Math.min(0.35, (c?.city_rounds || 0) * 0.1) * 100) / 100;
export const blackMarketOpen = (visit, extraChance = 0) => seededRng(`bm-open-${visit}`)() < BM_OPEN_CHANCE + extraChance;
const bmDisc = (item, mult) => ({ bmPrice: Math.max(1, Math.round(item.price * mult)), bmNormal: item.price });

// stock ของตลาดมืด (ไม่เช็คว่าเจอหรือเปล่า — ใช้ preview ได้) — deterministic จาก visit
export function bmStockFor(visit) {
  const rng = seededRng(`bm-stock-${visit}`);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const scroll = ITEM_BY_ID[pick(SCROLL_ITEMS)];
  const rare = ITEM_BY_ID[pick([...RARE_JUNK, ...BOSSES.map((b) => b.loot)])];
  const specPool = ITEMS.filter((i) => !i.exclusive && i.type !== 'scroll');
  const spec = pick(specPool);
  // ของพิเศษ exclusive หลุดมาจาก daily quest (ยกเว้น ถุงเงินนำโชค id 40 — กันวนซื้อแล้วใช้ +150 ทอง)
  const bmExclusive = pick(ITEMS.filter((i) => i.exclusive && i.id !== 40));
  return [
    { ...scroll, ...bmDisc(scroll, 0.85), bmTag: 'คัมภีร์หายาก' },
    { ...rare, ...bmDisc(rare, 0.75), bmTag: 'ของหายาก' },
    { ...spec, ...bmDisc(spec, 0.55), bmTag: 'ของเถื่อน เก็งกำไร' },
    { ...bmExclusive, ...bmDisc(bmExclusive, 0.9), bmTag: 'ของพิเศษ (exclusive)' },
  ];
}

export function blackMarketStock(visit, c = null) {
  if (!visit || !blackMarketOpen(visit, bmExtraChance(c))) return null;
  return bmStockFor(visit);
}

// PRNG deterministic จาก string — ใช้สุ่มของที่ต้อง "เหมือนเดิมทุกครั้งที่เปิดหน้าเดิม" (ตลาดมืด)
export function seededRng(str) {
  let t = hashSeed(str);
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ราคาขายตอนค่ายพัก: โดยปกติขายถูกกว่าราคาซื้อ (x0.4–0.6 ของราคาฐาน)
// แต่พ่อค้าอาจ "ต้องการ" ของบางชิ้น → ยอมจ่ายแพงขึ้น (x1.1–1.6)
// จังหวะราคา = รายวัน (dayKey YYYY-MM-DD) — ราคาคงที่ทั้งวัน แล้วเปลี่ยนทุกวัน
// ทำให้ถือของรอวันทีพ่อค้าต้องการได้ คำนวณจาก seed ของ dayKey+itemId → หน้าจอแสดงและตอนขายได้ราคาเดียวกันเสมอ
export function campSellPrice(item, dayKey) {
  const base = item?.price || 0;
  const id = item?.item_id ?? item?.id ?? 0; // รองรับทั้งแถว inventory (item_id) และออบเจกต์ไอเทม (id)
  if (!dayKey) return { price: Math.round(base * 0.5), wanted: false, mult: 0.5 };
  const rng = mulberry32(hashSeed(`${dayKey}:sell:${id}`));
  const wanted = rng() < 0.25;
  const mult = wanted ? 1.1 + rng() * 0.5 : 0.4 + rng() * 0.2;
  return { price: Math.max(1, Math.round(base * mult)), wanted, mult };
}

// ราคาซื้อในร้านค้าค่ายพักตามวัน — เชื่อมกับระบบ demand เดียวกันกับราคาขาย (seed เดียวกัน)
// ของที่พ่อค้าต้องการวันนี้ → ราคาในร้านแพงขึ้น (x1.2–1.5) · ของส่วนใหญ่ราคาปกติ · มีสุ่มไม่กี่ชิ้นที่ลดราคา (x0.7–0.9)
export function marketPrice(item, dayKey) {
  const base = item?.price || 0;
  const id = item?.item_id ?? item?.id ?? 0;
  if (!dayKey) return { price: base, mult: 1, hot: false, sale: false };
  const rng = mulberry32(hashSeed(`${dayKey}:sell:${id}`)); // seed เดียวกับ campSellPrice → wanted ตรงกัน
  const wanted = rng() < 0.25; // ของที่พ่อค้าต้องการวันนี้ (สุ่มรายวัน — เปลี่ยนทุกวัน)
  if (wanted) {
    const mult = 1.2 + rng() * 0.3;
    return { price: Math.max(1, Math.round(base * mult)), mult, hot: true, sale: false };
  }
  // ไม่ใช่ของที่ต้องการ → ราคาปกติเป็นหลัก มีสุ่ม ~15% ที่พ่อค้าลดราคาล้างสต็อก
  const sale = rng() < 0.15;
  const mult = sale ? 0.7 + rng() * 0.2 : 1;
  return { price: Math.max(1, Math.round(base * mult)), mult, hot: false, sale };
}

export const xpToNext = (level) => Math.floor(80 * Math.pow(level, 1.6));

// ช่องสวมใส่ทั้งหมด (RPG: มือหลัก/มือรอง/หัว/ตัว/แขน/ขา/เท้า/เครื่องประดับ x4)
export const SLOT_COLS = [
  'weapon_id', 'offhand_id', 'head_id', 'armor_id', 'arms_id', 'legs_id', 'feet_id',
  'accessory_id', 'accessory_2_id', 'accessory_3_id', 'accessory_4_id',
];

// คำนวณค่าสถานะแสดงผล = สถานะฐาน/เติบโต + โบนัสจากอุปกรณ์ที่สวม
export function computeStats(c) {
  const eq = SLOT_COLS
    .map((col) => c[col])
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
  };
}

const itemOf = (id) => (id ? ITEM_BY_ID[id] || null : null);

// ข้อจำกัดการสวมใส่ — คืนเหตุผล (string) ถ้าใส่ไม่ได้, null ถ้าใส่ได้
// เช็ค: เลเวล / เฉพาะคลาส (classReq) / ค่าสถานะขั้นต่ำ (statReq — เทียบกับค่าที่รวมอุปกรณ์แล้ว)
const REQ_LABEL = { atk: '⚔️ ATK', def: '🛡️ DEF', spd: '👟 SPD', mp: '💧 MP', crit: '🎯 CRIT' };
export function equipBlockReason(c, item) {
  if (!item) return 'ไอเทมไม่พบ';
  if (item.type === 'consumable' || item.type === 'junk' || item.type === 'scroll') return null;
  // เรียง: เฉพาะคลาส (ข้ามไม่ได้) → เลเวล (อัปได้เร็วสุด) → ค่าสถานะ (ต้องสะสม)
  if (item.classReq && !item.classReq.includes(c.class)) {
    const names = item.classReq.map((k) => CLASSES[k]?.name || k).join('/');
    return `เฉพาะคลาส ${names}`;
  }
  if ((item.lvl || 1) > c.level) return `ต้องเลเวล ${item.lvl} ขึ้นไป`;
  if (item.statReq) {
    const stats = computeStats(c);
    const missing = Object.entries(item.statReq)
      .filter(([k, v]) => (stats[k] ?? 0) < v)
      .map(([k, v]) => `${REQ_LABEL[k] || k.toUpperCase()} ${v}+ (ตอนนี้ ${stats[k] ?? 0})`);
    if (missing.length) return `ต้องมี ${missing.join(' และ ')}`;
  }
  return null;
}

// ----- ระบบเลเวลสกิล -----
// สกิลสะสม XP ทุกครั้งที่ใช้ (สู้บอส/event อัตโนมัติ) — อัพเลเวลแล้วแรงขึ้น (+10% ต่อเลเวล)
export const SKILL_MAX_LEVEL = 5;
export const skillXpToNext = (level) => 30 * level; // 1→2 ต้อง 30, 2→3 ต้อง 60 …

// คำนวณพลังของสกิลตามเลเวล — คืนสกิลพร้อมค่าที่ scale แล้ว + ข้อมูล XP/เลเวล
export function skillPower(skill, level = 1, xp = 0, source = 'class') {
  const s = (level - 1) * 0.1; // +10% ต่อเลเวล
  const out = { ...skill, level, xp, xpNext: skillXpToNext(level), maxLevel: SKILL_MAX_LEVEL, source };
  if (skill.dmg != null) out.dmg = +(skill.dmg * (1 + s)).toFixed(2);
  if (skill.healPct != null) out.healPct = +(skill.healPct * (1 + s)).toFixed(3);
  if (skill.freeze != null) out.freeze = +(skill.freeze + (level - 1) * 0.02).toFixed(2);
  if (skill.poison != null) out.poison = +(skill.poison + (level - 1) * 0.01).toFixed(3);
  if (skill.buffAtk != null) out.buffAtk = +(skill.buffAtk + (level - 1) * 0.05).toFixed(2);
  if (skill.mpHeal != null) out.mpHeal = Math.round(skill.mpHeal * (1 + s));
  if (skill.shield != null) out.shield = +(skill.shield + (level - 1) * 0.05).toFixed(2);
  if (skill.hits != null) out.hits = skill.hits + Math.floor((level - 1) / 2); // +1 ครั้งทุก 2 เลเวล
  return out;
}

// รวมสกิลทั้งหมดของตัวละคร = สกิลคลาส (เลเวล 1 เสมอ) + สกิลที่เรียนจากคัมภีร์ — พร้อมเลเวล/XP จริง
export function getCharacterSkills(c) {
  const rows = getSkillRows(c.id);
  const leveled = Object.fromEntries(rows.map((r) => [r.skill_id, r]));
  const classSkills = (SKILLS[c.class] || []).map((s) => {
    const row = leveled[s.id];
    return skillPower(s, row?.level || 1, row?.xp || 0, row?.source || 'class');
  });
  const scrollSkills = rows
    .filter((r) => SCROLL_SKILL_BY_ID[r.skill_id])
    .map((r) => skillPower(SCROLL_SKILL_BY_ID[r.skill_id], r.level, r.xp, 'scroll'));
  return [...classSkills, ...scrollSkills];
}

// เติม XP ให้สกิล — อัพเลเวลอัตโนมัติ (สูงสุด SKILL_MAX_LEVEL) คืนผลว่าอัพเลเวลหรือยัง
export function grantSkillXp(c, skillId, amount) {
  const def = [...(SKILLS[c.class] || []), ...SCROLL_SKILLS].find((s) => s.id === skillId);
  if (!def) return { levelUp: false };
  const row = getSkillRow(c.id, skillId);
  let level = row?.level || 1;
  if (level >= SKILL_MAX_LEVEL) return { levelUp: false, level, maxed: true };
  let xp = (row?.xp || 0) + amount;
  let leveled = 0;
  while (level < SKILL_MAX_LEVEL && xp >= skillXpToNext(level)) {
    xp -= skillXpToNext(level);
    level += 1;
    leveled += 1;
  }
  const source = row?.source || (SCROLL_SKILL_BY_ID[skillId] ? 'scroll' : 'class');
  upsertSkillRow(c.id, skillId, level, xp, source);
  return { levelUp: leveled > 0, leveled, level };
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
    // รอบที่สำรวจเมืองเดิมต่อ (หลังชนะบอสเลือกอยู่ต่อ) — ความยาก/รางวัล/ตลาดมืดเพิ่มตามรอบ
    cityRound: c.city_rounds || 0,
    exploreMult: +(1 + 0.15 * (c.city_rounds || 0)).toFixed(2),
    exploreRewardMult: +(1 + 0.2 * (c.city_rounds || 0)).toFixed(2),
    altBossAtRound: altBossAt(c.city_index % CITIES.length),
    challengeMode: c.challenge_mode || '',
    skills: getCharacterSkills(c), // สกิลคลาส + สกิลจากคัมภีร์ พร้อมเลเวล/XP — ใช้ตอนสู้บอส
    equipment: {
      weapon: itemOf(c.weapon_id),
      offhand: itemOf(c.offhand_id),
      head: itemOf(c.head_id),
      body: itemOf(c.armor_id),
      arms: itemOf(c.arms_id),
      legs: itemOf(c.legs_id),
      feet: itemOf(c.feet_id),
      accessories: [c.accessory_id, c.accessory_2_id, c.accessory_3_id, c.accessory_4_id].map(itemOf),
    },
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

// โอกาสหลบหลีกจากความเร็ว (SPD) — ใช้ในสู้บอส: โจร (SPD สูงสุด) หลบได้บ่อยสุด สูงสุด 20%
export function dodgeChance(spd) {
  return Math.min(20, Math.round(spd * 0.8));
}

// ----- การสำรวจเมืองเดิมต่อ (หลังชนะบอสเลือก "อยู่ต่อ") -----
// แต่ละรอบที่สำรวจเมืองเดิม: ศัตรู/บอสแข็งขึ้น (x1.15/รอบ) แต่รางวัล XP/ทองก็เพิ่มขึ้น (x1.2/รอบ) +
// โอกาสเจอตลาดมืดเพิ่มขึ้น — ยิ่งอยู่ต่อ ยิ่งเสี่ยงแต่คุ้มค่า (เจอบอสลับเมื่อครบรอบของเมืองนั้น)
export const exploreRound = (c) => c?.city_rounds || 0;
export const exploreMult = (c) => 1 + 0.15 * exploreRound(c);            // ตัวคูณพลังศัตรู/บอส
export const exploreRewardMult = (c) => 1 + 0.2 * exploreRound(c);       // ตัวคูณรางวัล XP/ทอง

// ----- ระบบมอนสเตอร์ / ต่อสู้อัตโนมัติ (ช่วง work session — ไม่รบกวนสมาธิ) -----
export function rollMonster(level, c = null) {
  const m = pick(MONSTERS);
  const power = Math.round((12 + 5 * level) * m.power * enemyMult(c) * exploreMult(c));
  return { ...m, power };
}

// ----- โหมดท้าทาย (challenge mode) -----
// '' = ปกติ · 'hard' = โหด (มอนสเตอร์/บอสแรง + ดรอปยาก + ราคาแพง แต่รางวัลเพิ่ม)
// 'marathon' = มาราธอน (ห้ามพักระหว่างโฟกัส — พัก = เสีย session แต่ session ครบได้โบนัส)
// 'survival' = เอาชีวิตรอด (ค่ายพักไม่ฟื้นพลังฟรี + หมด HP เสียของ/เริ่มเมืองใหม่)
export const CHALLENGES = {
  hard:     { label: '⚔️ โหมดโหด',        rewardMult: 1.5,  enemyMult: 1.3,  dropMult: 0.6,  priceMult: 1.3 },
  marathon: { label: '⏱️ โหมดมาราธอน',   rewardMult: 1.5,  enemyMult: 1,    dropMult: 1,    priceMult: 1 },
  survival: { label: '🩸 โหมดเอาชีวิตรอด', rewardMult: 1.5,  enemyMult: 1,    dropMult: 1,    priceMult: 1 },
};
export const challengeOf = (c) => CHALLENGES[c?.challenge_mode] || null;

// ตัวคูณรางวัล (XP/ทอง) ตามโหมด — ทุกโหมดได้ +50% (เสี่ยงสูง รางวัลสูง)
export function rewardMult(c) {
  const ch = challengeOf(c);
  return ch?.rewardMult || 1;
}

// ตัวคูณพลังศัตรู (มอนสเตอร์/บอส) — โหมดโหดแรงขึ้น x1.3
export function enemyMult(c) {
  const ch = challengeOf(c);
  return ch?.enemyMult || 1;
}

// ตัวคูณโอกาสดรอปของ — โหมดโหดดรอปยากขึ้น x0.6
export function dropMult(c) {
  const ch = challengeOf(c);
  return ch?.dropMult || 1;
}

// ตัวคูณราคาในร้านค้า — โหมดโหดของแพงขึ้น x1.3
export function priceMult(c) {
  const ch = challengeOf(c);
  return ch?.priceMult || 1;
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
  const rMult = exploreRewardMult(c); // สำรวจเมืองเดิมต่อ → รางวัลสูงขึ้น
  let hpLoss = 0;
  let xp = 0;
  let gold = 0;
  let detail = '';
  if (win) {
    xp = Math.round((monster.xp + rand(0, 8) + c.level) * rMult);
    gold = Math.round((monster.gold + rand(0, 6)) * rMult);
    hpLoss = rand(3, 9);
    detail = `🗡️ กำราบ ${monster.name} ได้สำเร็จ! (+${xp} XP, +${gold} ทอง)`;
  } else {
    xp = Math.max(2, Math.round(monster.xp * 0.25 * rMult));
    hpLoss = Math.round(stats.maxHp * 0.08) + rand(2, 6);
    detail = `💨 โดน ${monster.name} ต้อนจนต้องหนี… (ได้ ${xp} XP แต่เสียพลังไป ${hpLoss})`;
  }
  c.hp = Math.max(1, c.hp - hpLoss);
  const ups = gainXp(c, xp);
  c.gold += gold;
  return { win, xp, gold, hpLoss, detail, monster, ups };
}

// ----- เหตุการณ์สุ่มระหว่าง session (forceKey = ระบุ event ให้เกิดตาม key — ใช้ใน dev test) -----
export function rollEvent(c, forceKey = null) {
  let ev;
  if (forceKey) {
    ev = EVENT_POOL.find((e) => e.key === forceKey);
    if (!ev) return null;
  } else {
    const total = EVENT_POOL.reduce((a, e) => a + e.weight, 0);
    let r = Math.random() * total;
    ev = EVENT_POOL[0];
    for (const e of EVENT_POOL) {
      r -= e.weight;
      if (r <= 0) { ev = e; break; }
    }
  }

  const city = CITIES[c.city_index % CITIES.length];
  const base = {
    key: ev.key,
    title: ev.title,
    flavor: ev.flavor.replace('{monster}', '???'),
    xp: 0, gold: 0, item: null, hpChange: 0, mpChange: 0,
  };

  if (ev.key === 'monster') {
    const m = rollMonster(c.level, c);
    // มีโอกาสเล็กน้อย (15%) ที่ตัวละครใช้สกิลอัตโนมัติ (รวมสกิลจากคัมภีร์) → ชนะง่ายขึ้น + รางวัลเพิ่ม
    const skills = getCharacterSkills(c);
    let skillUsed = null;
    if (skills.length && Math.random() < 0.15) {
      skillUsed = skills[Math.floor(Math.random() * skills.length)];
    }
    let res;
    if (skillUsed) {
      const powerMult = skillUsed.dmg ? 1 / (1 + skillUsed.dmg * 0.35) : 0.75; // ใช้สกิลโจมตี → มอนสเตอร์ต้านน้อยลง
      res = resolveCombat(c, { ...m, power: Math.round(m.power * powerMult) });
      // โบนัสสกิล 25% — ต้องเครดิตจริงให้ตรงกับที่แสดง (resolveCombat เครดิตค่าฐานไปแล้ว)
      const xpBonus = Math.round(res.xp * 0.25);
      const goldBonus = Math.round(res.gold * 0.25);
      res.xp += xpBonus;
      res.gold += goldBonus;
      c.gold += goldBonus;
      res.ups = (res.ups || 0) + gainXp(c, xpBonus);
      const sk = grantSkillXp(c, skillUsed.id, 15); // event อัตโนมัติก็สะสม XP ให้สกิล
      res.detail = `${skillUsed.icon} ${c.name} ใช้สกิล ${skillUsed.name}! ${res.detail} (โบนัสสกิล +${xpBonus} XP, +${goldBonus} ทอง)`;
      if (sk.levelUp) res.detail += ` ⭐ สกิล ${skillUsed.name} เลเวลขึ้นเป็น Lv.${sk.level}!`;
    } else {
      res = resolveCombat(c, m);
    }
    // ชนะ → มีโอกาส ~40% ได้ loot ประจำตัวมอนสเตอร์ (ขยะราคาไม่สูง — ขายได้ที่แคมป์) — โหมดโหดดรอปยากขึ้น
    let loot = null;
    if (res.win && m.loot) {
      if (Math.random() < 0.4 * dropMult(c)) {
        loot = ITEM_BY_ID[m.loot];
        res.detail += ` และได้ ${loot.icon} ${loot.name}!`;
      }
    }
    return {
      ...base,
      flavor: ev.flavor.replace('{monster}', `${m.icon} ${m.name} (พลัง ${m.power})`),
      xp: res.xp, gold: res.gold, hpChange: -res.hpLoss,
      detail: res.detail,
      skill: skillUsed ? { id: skillUsed.id, name: skillUsed.name, icon: skillUsed.icon } : null,
      monster: { name: m.name, icon: m.icon, win: res.win },
      item: loot ? { id: loot.id, name: loot.name, icon: loot.icon, lvl: loot.lvl || 1, type: loot.type } : null,
      logType: res.win ? 'battle_win' : 'battle_lose',
      ups: res.ups,
    };
  }

  if (ev.key === 'treasure') {
    const rMult = exploreRewardMult(c); // สำรวจเมืองเดิมต่อ → รางวัลสูงขึ้น
    const xp = Math.round((rand(10, 25) + c.level) * rMult);
    const gold = Math.round((rand(15, 45) + c.level * 2) * rMult);
    c.gold += gold;
    const ups = gainXp(c, xp);
    base.xp = xp; base.gold = gold;
    base.ups = ups;
    base.detail = `เปิดกล่องสมบัติ: ได้ทอง ${gold} และประสบการณ์ ${xp}`;
    // โอกาสได้ไอเทม 12% (แบบเดิม) — แต่ขยะที่วันนี้พ่อค้าไม่ค่อยต้องการ (ราคาต่ำ) จะเจอบ่อยกว่า
    if (Math.random() < 0.12) {
      let item;
      const roll = Math.random();
      if (roll < 0.03) {
        // คัมภีร์สกิลหายาก — โอกาสน้อยมาก (~0.36% ต่อสมบัติ) เรียนสกิลใหม่ได้
        item = ITEM_BY_ID[pick(SCROLL_ITEMS)];
        base.learnedSkill = SCROLL_SKILL_BY_ID[item.learn_skill]?.name || null;
      } else if (roll < 0.21) {
        item = ITEM_BY_ID[pick(RARE_JUNK)]; // ของขวัญหายาก — ดรอปยาก (ออกทางนี้ทางเดียว)
      } else {
        // เกียร์ที่เจอต้องสวมได้กับคลาสนี้ (ไม่ดรอปของคลาสอื่นให้รกกระเป๋า)
        const pool = Object.values(ITEM_BY_ID).filter((i) => !i.exclusive && !RARE_JUNK.includes(i.id) && i.type !== 'scroll' && (!i.classReq || i.classReq.includes(c.class)) && (i.type === 'consumable' || i.type === 'junk' || (i.lvl || 1) <= c.level + 1));
        // น้ำหนัก: ขยะที่วันนี้ขายถูก (พ่อค้าไม่ต้องการ) x4 — ของแพง/เป็นที่ต้องการเจอยากกว่า
        const dayKey = today();
        const weighted = [];
        for (const i of pool) {
          const w = i.type === 'junk' && !campSellPrice(i, dayKey).wanted ? 4 : 1;
          for (let k = 0; k < w; k++) weighted.push(i);
        }
        item = pick(weighted);
      }
      base.item = { id: item.id, name: item.name, icon: item.icon, lvl: item.lvl || 1, type: item.type, learn_skill: item.learn_skill || null };
      base.detail += ` — และพบ ${item.icon} ${item.name}!${base.learnedSkill ? ` (เรียนรู้สกิล ${base.learnedSkill})` : ''}`;
    }
    base.logType = 'treasure';
    return base;
  }

  if (ev.key === 'shrine') {
    const stats = computeStats(c);
    if (Math.random() < 0.5 || c.mp >= stats.maxMp) {
      const xp = Math.round((rand(20, 40) + c.level) * exploreRewardMult(c));
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
      const gold = Math.round(rand(5, 15) * exploreRewardMult(c));
      c.gold += gold;
      base.gold = gold;
      base.detail = `ซื้อของที่ระลึกจากพ่อค้าและขายต่อ ได้กำไร ${gold} ทอง`;
    } else {
      // ของแถมจากพ่อค้า: ยา/สมุนไพร/ของขวัญ — มีโอกาสน้อยที่แถมของขวัญหายาก
      const itemId = Math.random() < 0.1 ? pick(RARE_JUNK) : pick(COMMON_LOOT);
      base.item = { id: itemId, name: ITEM_BY_ID[itemId].name, icon: ITEM_BY_ID[itemId].icon };
      base.detail = `พ่อค้าใจดีแถม ${ITEM_BY_ID[itemId].icon} ${ITEM_BY_ID[itemId].name} ให้ฟรี!`;
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
      const xp = Math.round(rand(5, 12) * exploreRewardMult(c));
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
// บอสแต่ละเมืองมีสกิล (ท่าเด็ด) ของตัวเอง — ใช้แทนโจมตีปกติเป็นครั้งคราว
// สำรวจเมืองเดิมต่อ → บอสแข็งขึ้นตามรอบ · เจอบอสลับ (👁️/😈/🗿) เมื่อครบรอบของเมืองนั้น — ให้ของพิเศษ
export function generateBoss(level, cityIndex, c = null) {
  const round = exploreRound(c);
  const isAlt = round >= altBossAt(cityIndex);
  const boss = isAlt ? ALT_BOSSES[cityIndex % ALT_BOSSES.length] : BOSSES[cityIndex % BOSSES.length];
  const loadout = BOSS_LOADOUTS[cityIndex % BOSS_LOADOUTS.length] || [];
  const skills = loadout.map((k) => BOSS_SKILLS[k]).filter(Boolean);
  const em = enemyMult(c) * exploreMult(c) * (isAlt ? 1.15 : 1); // บอสลับโหดกว่าเล็กน้อย (ของพิเศษเป็นรางวัล ไม่ใช่กำแพง)
  const maxHp = Math.round((90 + 32 * level) * em);
  return {
    name: boss.name,
    icon: boss.icon,
    isAlt,
    loot: boss.loot || null, // ของรางวัลเฉพาะตัว — ดรอปตอนชนะ (routes จัดการ)
    maxHp,
    hp: maxHp,
    atk: Math.round((9 + 2.5 * level) * em),
    def: Math.round((3 + level) * em),
    crit: 10,
    skills,
  };
}

export function bossPlayerTurn(c, fight, action, itemId, skillId) {
  const stats = computeStats(c);
  const log = [];
  let outcome = null; // null = ยังสู้, 'win' | 'lose'

  // ดาเมจที่บอสได้รับ — ถ้าบอสใช้ "เกราะแข็ง" (ลดดาเมจ) ให้ลดก่อน
  const bossHit = (dmg) => {
    let d = dmg;
    if (fight.bossGuard) d = Math.round(d * fight.bossGuard.mult);
    fight.boss.hp = Math.max(0, fight.boss.hp - d);
    return d;
  };

  if (action === 'attack') {
    const buff = fight.buffAtk || 1; // อวยพร: โจมตีเทิร์นนี้ x1.5
    if (fight.buffAtk) { fight.buffAtk = null; log.push(`🙏 พลังอวยพรยังคุกรุ่น — โจมตี x${buff}!`); }
    const crit = isCrit(stats.crit);
    let dmg = attackDamage(stats.atk * buff, fight.boss.def);
    if (crit) dmg = Math.round(dmg * 1.7);
    const dealt = bossHit(dmg);
    log.push(`⚔️ ${c.name} โจมตี${crit ? ' — คริติคอล!!' : ''} โดน ${dealt} ดาเมจ`);
  } else if (action === 'skill') {
    // สกิลรวมคลาส + คัมภีร์ (พร้อมเลเวลที่ scale แล้ว)
    const skill = getCharacterSkills(c).find((s) => s.id === skillId);
    if (!skill) return { error: 'สกิลไม่พบ' };
    if (c.mp < skill.mp) return { error: `มานาไม่พอ! (ต้องใช้ ${skill.mp} MP)` };
    c.mp -= skill.mp;
    const buff = fight.buffAtk || 1;
    if (fight.buffAtk) { fight.buffAtk = null; log.push(`🙏 พลังอวยพรยังคุกรุ่น — สกิล x${buff}!`); }
    // โจมตีหลายครั้ง (วายุระบำ / สายฟ้าแลบ)
    if (skill.hits) {
      for (let h = 0; h < skill.hits; h++) {
        const dmg = attackDamage(stats.atk * (skill.dmg || 1) * buff, fight.boss.def);
        const dealt = bossHit(dmg);
        log.push(`${skill.icon} ${skill.name} ครั้งที่ ${h + 1}: โดน ${dealt} ดาเมจ`);
      }
    } else if (skill.dmg) {
      let dmg = attackDamage(stats.atk * skill.dmg * buff, fight.boss.def);
      const crit = isCrit(skill.critChance != null ? skill.critChance * 100 : stats.crit);
      if (crit) dmg = Math.round(dmg * (skill.critMult || 1.7));
      const dealt = bossHit(dmg);
      log.push(`${skill.icon} ใช้ ${skill.name} (-${skill.mp} MP) โดน ${dealt} ดาเมจ${crit ? ' — คริติคอล!!' : ''}`);
    }
    if (skill.healPct) {
      const heal = Math.round(stats.maxHp * skill.healPct);
      c.hp = clamp(c.hp + heal, 0, stats.maxHp);
      log.push(`${skill.icon} ${skill.name}: ฟื้น HP +${heal}`);
    }
    if (skill.mpHeal) {
      c.mp = clamp(c.mp + skill.mpHeal, 0, stats.maxMp);
      log.push(`${skill.icon} ${skill.name}: ฟื้น MP +${skill.mpHeal}`);
    }
    if (skill.freeze) {
      if (Math.random() < skill.freeze) {
        fight.bossFrozen = true;
        log.push(`❄️ ${skill.name} แช่แข็งบอส! บอสข้ามเทิร์นถัดไป`);
      } else {
        log.push(`❄️ บอสหลบการแช่แข็งได้…`);
      }
    }
    if (skill.poison) {
      fight.bossPoison = { pct: skill.poison, turns: 2 };
      log.push(`☠️ ${skill.name} — บอสจะเสีย ${Math.round(skill.poison * 100)}% HP ต่อเทิร์น (2 เทิร์น)`);
    }
    if (skill.buffAtk) {
      fight.buffAtk = skill.buffAtk;
      log.push(`${skill.icon} ${skill.name} — เทิร์นหน้าโจมตี x${skill.buffAtk}!`);
    }
    if (skill.shield) {
      fight.playerGuard = skill.shield; // โล่เวท (คัมภีร์) — ลดดาเมจเทิร์นนี้
      log.push(`${skill.icon} ${skill.name} — เทิร์นนี้ลดดาเมจที่ได้รับ ${Math.round(skill.shield * 100)}%!`);
    }
    // สะสม XP ให้สกิล (สู้บอส = 25 XP/ครั้ง) — อัพเลเวลแล้วแรงขึ้น
    const sk = grantSkillXp(c, skillId, 25);
    if (sk.levelUp) log.push(`⭐ ${skill.icon} ${skill.name} เลเวลขึ้นเป็น Lv.${sk.level}!`);
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
    if (item.use_gold) { c.gold += item.use_gold; used = true; log.push(`💰 ${item.name}: +${item.use_gold} ทอง!`); }
    if (item.use_xp) { gainXp(c, item.use_xp); used = true; log.push(`📜 ${item.name}: +${item.use_xp} XP!`); }
    if (!used) return { error: 'พลังยังเต็มอยู่ ไม่จำเป็นต้องใช้' };
    slot.qty -= 1;
    if (!item.use_xp && !item.use_gold) log.push(`🧪 ใช้ ${item.icon} ${item.name} — ฟื้นพลัง! (HP ${c.hp}/${stats.maxHp}, MP ${c.mp}/${stats.maxMp})`);
  }

  // เทิร์นบอส
  if (fight.boss.hp > 0) {
    // พิษผู้เล่น (สกิลบอส "พิษร้าย") — ผู้เล่นเสีย HP ก่อนบอสลงมือ
    if (fight.playerPoison) {
      const p = fight.playerPoison;
      const pd = Math.max(1, Math.round(stats.maxHp * p.pct));
      c.hp = Math.max(1, c.hp - pd);
      p.turns -= 1;
      if (p.turns <= 0) fight.playerPoison = null;
      log.push(`☠️ พิษร้ายกัดกินร่าง เสีย ${pd} HP${p.turns > 0 ? ` (เหลือ ${p.turns} เทิร์น)` : ''}`);
    }
    // พิษบอส (ยาพิษของโจร)
    if (fight.bossPoison) {
      const p = fight.bossPoison;
      const pd = Math.max(1, Math.round(fight.boss.maxHp * p.pct));
      const dealt = bossHit(pd);
      p.turns -= 1;
      if (p.turns <= 0) fight.bossPoison = null;
      log.push(`☠️ บอสโดนพิษ เสีย ${dealt} HP${p.turns > 0 ? ` (เหลือ ${p.turns} เทิร์น)` : ''}`);
    }
    // เกราะแข็งของบอส — นับถอยหลังเทิร์น (เริ่มนับตอนเทิร์นบอส)
    if (fight.bossGuard) {
      fight.bossGuard.turns -= 1;
      if (fight.bossGuard.turns <= 0) fight.bossGuard = null;
    }
    if (fight.boss.hp <= 0) {
      log.push('💀 บอสทรุดลงจากพิษ…');
    } else if (fight.bossFrozen) {
      fight.bossFrozen = false;
      log.push('❄️ บอสถูกแช่แข็ง — ข้ามเทิร์นโจมตี!');
    } else {
      // โอกาส 30% ที่บอสใช้ท่าเด็ด (สกิล) แทนโจมตีปกติ
      const bossSkill = fight.boss.skills?.length && Math.random() < 0.3 ? pick(fight.boss.skills) : null;
      const bossName = `${fight.boss.icon} ${fight.boss.name}`;
      const dodge = dodgeChance(stats.spd); // โอกาสหลบโจมตีบอส (SPD สูง = หลบเก่ง)
      const playerHit = (dmg) => {
        if (Math.random() * 100 < dodge) return 0; // 💨 หลบได้ — ไม่เสียดาเมจ
        let d = dmg;
        if (fight.playerGuard) { d = Math.max(1, Math.round(d * (1 - fight.playerGuard))); }
        c.hp = Math.max(1, c.hp - d);
        return d;
      };
      if (bossSkill) {
        const sk = bossSkill;
        if (sk.heal) {
          const h = Math.round(fight.boss.maxHp * sk.heal);
          fight.boss.hp = Math.min(fight.boss.maxHp, fight.boss.hp + h);
          log.push(`💚 ${bossName} ใช้สกิล ${sk.icon} ${sk.name} — ฟื้น HP +${h}!`);
        } else if (sk.poison) {
          fight.playerPoison = { pct: sk.poison, turns: 2 };
          log.push(`☠️ ${bossName} ใช้สกิล ${sk.icon} ${sk.name} — คุณจะเสีย ${Math.round(sk.poison * 100)}% HP ต่อเทิร์น (2 เทิร์น)!`);
        } else if (sk.guard) {
          fight.bossGuard = { mult: sk.guard, turns: 2 };
          log.push(`🛡️ ${bossName} ใช้สกิล ${sk.icon} ${sk.name} — ลดดาเมจที่ได้รับลง 2 เทิร์น!`);
        } else if (sk.drainMp) {
          const lost = Math.min(c.mp, Math.round(stats.maxMp * sk.drainMp));
          c.mp = Math.max(0, c.mp - lost);
          log.push(`🧿 ${bossName} ใช้สกิล ${sk.icon} ${sk.name} — มานาของคุณถูกดูดไป ${lost} MP!`);
        } else {
          const crit = Math.random() * 100 < fight.boss.crit;
          let dmg = attackDamage(fight.boss.atk * (sk.mult || 1), stats.def);
          if (crit) dmg = Math.round(dmg * 1.5);
          const dealt = playerHit(dmg);
          log.push(dealt === 0
            ? `💨 ${c.name} หลบสกิล ${sk.icon} ${sk.name} ได้!`
            : `💢 ${bossName} ใช้สกิล ${sk.icon} ${sk.name} โดน ${dealt} ดาเมจ${crit ? ' — คริติคอล!' : ''}`);
        }
      } else {
        const crit = Math.random() * 100 < fight.boss.crit;
        let dmg = attackDamage(fight.boss.atk, stats.def);
        if (crit) dmg = Math.round(dmg * 1.5);
        const dealt = playerHit(dmg);
        log.push(dealt === 0
          ? `💨 ${c.name} หลบการโจมตีได้!`
          : `💢 ${bossName} ตอบโต้ โดน ${dealt} ดาเมจ${crit ? ' — คริติคอล!' : ''}`);
      }
      fight.playerGuard = null; // โล่เวท (ผู้เล่น) คุ้มกันแค่เทิร์นนี้เท่านั้น
    }
  }

  if (fight.boss.hp <= 0) {
    outcome = 'win';
    const rMult = exploreRewardMult(c); // สำรวจเมืองเดิมต่อ → รางวัลบอสสูงขึ้น
    const xp = Math.round((250 + 60 * c.level) * rMult);
    const gold = Math.round((120 + 40 * c.level) * rMult);
    const ups = gainXp(c, xp);
    c.gold += gold;
    const drop = Math.random() < 0.35 ? pick(Object.values(ITEM_BY_ID).filter((i) => !i.exclusive && i.type !== 'consumable' && i.type !== 'junk' && i.type !== 'scroll' && (i.lvl || 1) <= c.level + 1)) : null;
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
      const i = pick(COMMON_LOOT); // ยา/สมุนไพร/ของขวัญ
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

// ----- ยศ (Rank) — ตามเวลาโฟกัสสะสม -----
export function rankOf(totalFocusSec) {
  const min = Math.round((totalFocusSec || 0) / 60);
  let cur = RANKS[0];
  let next = null;
  for (const r of RANKS) {
    if (min >= r.minMin) cur = r;
    else { next = r; break; }
  }
  return {
    name: cur.name, icon: cur.icon, min,
    nextName: next?.name || null, nextIcon: next?.icon || null,
    pct: next ? Math.min(100, Math.round(((min - cur.minMin) / (next.minMin - cur.minMin)) * 100)) : 100,
    nextIn: next ? next.minMin - min : 0,
  };
}

// ----- Companion — โตตามเวลาโฟกัสสะสม -----
export function companionOf(totalFocusSec) {
  const min = Math.round((totalFocusSec || 0) / 60);
  let cur = COMPANIONS[0];
  let next = null;
  for (const c of COMPANIONS) {
    if (min >= c.minMin) cur = c;
    else { next = c; break; }
  }
  return {
    name: cur.name, icon: cur.icon, desc: cur.desc, min,
    nextName: next?.name || null, nextIcon: next?.icon || null,
    pct: next ? Math.min(100, Math.round(((min - cur.minMin) / (next.minMin - cur.minMin)) * 100)) : 100,
    nextIn: next ? next.minMin - min : 0,
  };
}

// ----- ขวัญกำลังใจ (Morale) — ดูจากวันสุดท้ายที่โฟกัส -----
export function moraleOf(lastFocusDate) {
  if (!lastFocusDate) {
    return { level: 3, icon: '🥺', label: 'หม่นหมอง', msg: 'ยังไม่ได้โฟกัสเลย — ตัวละครเริ่มคิดถึงการผจญภัย' };
  }
  const days = Math.max(0, Math.floor((Date.now() - new Date(`${lastFocusDate}T00:00:00`).getTime()) / 86400000));
  if (days <= 1) return { level: 0, icon: '😄', label: 'สดใส', msg: 'พึ่งโฟกัสเสร็จ — พร้อมลุยต่อ!' };
  if (days <= 2) return { level: 1, icon: '🙂', label: 'สดชื่น', msg: 'เมื่อวานได้ผจญภัย — ยังไหว!' };
  if (days <= 4) return { level: 2, icon: '😐', label: 'เฉย ๆ', msg: `${days} วันไม่ได้โฟกัส — ตัวละครเริ่มเบื่อ` };
  return { level: 3, icon: '🥺', label: 'หม่นหมอง', msg: `${days} วันแล้วที่ไม่ได้ผจญภัย — กลับมาโฟกัสเถอะ!` };
}

// ----- เทศกาลประจำสัปดาห์ — เมืองหมุนเวียน (week % 12) -----
export function festivalFor(cityIndex) {
  const week = Math.floor(Date.now() / (7 * 86400000));
  const idx = cityIndex % CITIES.length;
  return week % CITIES.length === idx ? FESTIVALS[idx] : null;
}

// ----- เควสต์เนื้อเรื่อง -----
export function storyReqMet(q, c, prog) {
  const t = q.req.type;
  const v = q.req.value;
  if (t === 'boss') return (prog.bosses_defeated || 0) >= v;
  if (t === 'sessions') return (prog.sessions_completed || 0) >= v;
  if (t === 'level') return c.level >= v;
  if (t === 'city') return c.city_index >= q.req.city;
  return false;
}

export function storyReqLabel(q, c, prog = {}) {
  const v = q.req.value;
  if (q.req.type === 'boss') return `ชนะบอส ${v} ตัว (ตอนนี้ ${prog.bosses_defeated || 0})`;
  if (q.req.type === 'sessions') return `โฟกัสครบ ${v} session (ตอนนี้ ${prog.sessions_completed || 0})`;
  if (q.req.type === 'level') return `เลเวล ${v} (ตอนนี้ ${c.level})`;
  if (q.req.type === 'city') return `ไปถึงเมือง ${q.req.city}`;
  return '';
}
