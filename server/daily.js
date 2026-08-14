import { DAILY_QUESTS, ITEM_BY_ID } from './data.js';
import { gainXp } from './game.js';
import { db, today, getDailyCounters, addLog, addItem, updateCharacter } from './db.js';

// PRNG แบบ seeded (mulberry32) — quest ของวันเดียวกันต้องเหมือนกันทั้งวัน
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rewardFor = (c) => ({ gold: 40 + c.level * 6, xp: 30 + c.level * 4 });

const yesterday = () => db.prepare("SELECT date('now','localtime','-1 day') AS d").get().d;

// streak การทำภารกิจครบติดต่อกัน
const getDailyStreak = (c) =>
  db.prepare('SELECT streak, last_date FROM daily_streak WHERE character_id = ?').get(c.id) || { streak: 0, last_date: null };

// ตัวคูณโบนัส: ทำครบติดต่อทุกวัน โบนัสเพิ่ม 20% ต่อวัน สูงสุด x2 (วันที่ 6+)
const bonusMult = (streak) => 1 + Math.min(Math.max(streak - 1, 0), 5) * 0.2;

// สถานะภารกิจประจำวันของตัวละคร (สุ่ม 3 อันตามวันที่ + id ตัวละคร)
export function getDailyQuests(c) {
  const date = today();
  const counters = getDailyCounters(c.id, date);
  const rand = mulberry32(hashStr(`${c.id}-${date}`));
  const pool = [...DAILY_QUESTS];
  const picked = [];
  while (picked.length < 3 && pool.length) {
    picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }

  const doneRows = db.prepare('SELECT quest_id, claimed_at, reward FROM daily_quest_done WHERE character_id = ? AND date = ?').all(c.id, date);
  const doneMap = new Map(doneRows.map((r) => [r.quest_id, r]));

  const quests = picked.map((q) => {
    const target = typeof q.target === 'function' ? q.target(c.level) : q.target;
    const current = Math.min(counters[q.key] ?? 0, target);
    return {
      id: q.id,
      name: q.name,
      icon: q.icon,
      key: q.key,
      unit: q.unit,
      target,
      current,
      display: q.unit === 'min' ? Math.round(target / 60) : target,
      displayCurrent: q.unit === 'min' ? Math.round(current / 60) : current,
      desc: q.desc.replace('{n}', q.unit === 'min' ? Math.round(target / 60) : target),
      complete: current >= target,
      claimed: doneMap.has(q.id),
      claimedReward: doneMap.get(q.id)?.reward || null,
    };
  });

  // ข้อมูล streak (สำหรับ UI): ถ้าอยากให้โบนัสวันนี้ = streak+1 ต้องทำวันต่อเนื่อง
  const st = getDailyStreak(c);
  const nextStreak = st.last_date === yesterday() ? st.streak + 1 : 1;

  return {
    date,
    streak: st.streak,
    nextStreak,
    bonusMult: bonusMult(nextStreak),
    quests,
    allDone: quests.length > 0 && quests.every((q) => q.complete),
    allClaimed: quests.every((q) => q.claimed) && doneMap.has('ALL_BONUS'),
  };
}

// ไอเทมสำหรับตัวเลือก "ไอเทมสุ่ม" — 40% ได้ของพิเศษ (exclusive) ที่หาซื้อตามร้านไม่ได้
export function randomRewardItem(c) {
  if (Math.random() < 0.4) {
    const pool = Object.values(ITEM_BY_ID).filter((i) => i.exclusive);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const pool = Object.values(ITEM_BY_ID).filter(
    (i) => !i.exclusive && (i.type === 'consumable' ? [2, 4].includes(i.id) : (i.lvl || 1) <= c.level + 1)
  );
  return pool[Math.floor(Math.random() * pool.length)];
}

const REWARD_LABEL = { gold: 'ทอง', xp: 'XP', item: 'ไอเทม' };

// รับรางวัลภารกิจเดี่ยว — เลือกได้: 'gold' | 'xp' | 'item' (คืนสิ่งที่ได้จริง)
export function claimDailyQuest(c, questId, reward = 'gold') {
  const date = today();
  const daily = getDailyQuests(c);
  const q = daily.quests.find((x) => x.id === questId);
  if (!q) return { error: 'ไม่พบภารกิจ' };
  if (!q.complete) return { error: 'ภารกิจยังไม่เสร็จ — ทำต่ออีกนิด!' };
  const ins = db.prepare('INSERT OR IGNORE INTO daily_quest_done (character_id, date, quest_id) VALUES (?, ?, ?)').run(c.id, date, questId);
  if (!ins.changes) return { error: 'รับรางวัลไปแล้ว' };

  const base = rewardFor(c);
  let granted;
  if (reward === 'xp') {
    const ups = gainXp(c, base.xp);
    granted = { rewardType: 'xp', xp: base.xp, ups };
  } else if (reward === 'item') {
    const item = randomRewardItem(c);
    addItem(c.id, item.id);
    granted = { rewardType: 'item', item: { id: item.id, name: item.name, icon: item.icon } };
  } else {
    c.gold += base.gold;
    granted = { rewardType: 'gold', gold: base.gold };
  }

  db.prepare('UPDATE daily_quest_done SET reward = ? WHERE character_id = ? AND date = ? AND quest_id = ?')
    .run(granted.rewardType, c.id, date, questId);
  updateCharacter(c);
  const detail = granted.rewardType === 'item'
    ? `รางวัลภารกิจประจำวัน: ได้ ${granted.item.icon} ${granted.item.name}`
    : `รางวัลภารกิจประจำวัน: +${granted.xp ?? granted.gold} ${REWARD_LABEL[granted.rewardType]}`;
  addLog(c.id, { type: 'daily_quest', title: `📅 ${q.name}`, detail, xp: granted.xp || 0, gold: granted.gold || 0 });
  return granted;
}

// รับโบนัสทำครบทุกภารกิจของวัน — คืน { gold, xp, ups, item?, error? }
export function claimDailyAll(c) {
  const date = today();
  const daily = getDailyQuests(c);
  if (!daily.allDone) return { error: 'ยังทำภารกิจไม่ครบทุกอัน' };
  const ins = db.prepare('INSERT OR IGNORE INTO daily_quest_done (character_id, date, quest_id) VALUES (?, ?, ?)').run(c.id, date, 'ALL_BONUS');
  if (!ins.changes) return { error: 'รับโบนัสไปแล้ว' };

  // คำนวณ streak: ทำเมื่อวานติดต่อกันไหม?
  const st = getDailyStreak(c);
  const nextStreak = st.last_date === yesterday() ? st.streak + 1 : 1;
  const mult = bonusMult(nextStreak);
  const gold = Math.round((100 + c.level * 10) * mult);
  const xp = Math.round((60 + c.level * 6) * mult);
  const ups = gainXp(c, xp);
  c.gold += gold;
  db.prepare(`INSERT INTO daily_streak (character_id, streak, last_date) VALUES (?, ?, ?)
    ON CONFLICT(character_id) DO UPDATE SET streak = excluded.streak, last_date = excluded.last_date`)
    .run(c.id, nextStreak, today());

  // ของรางวัลพิเศษ: 35% ได้ไอเทม exclusive (หาซื้อไม่ได้), 30% ได้อุปกรณ์, ที่เหลือยาฟื้นฟูเต็ม
  let item = null;
  const roll = Math.random();
  if (roll < 0.35) {
    const pool = Object.values(ITEM_BY_ID).filter((i) => i.exclusive);
    item = pool[Math.floor(Math.random() * pool.length)];
  } else if (roll < 0.65) {
    const equips = Object.values(ITEM_BY_ID).filter((i) => !i.exclusive && i.type !== 'consumable' && (i.lvl || 1) <= c.level + 1);
    item = equips[Math.floor(Math.random() * equips.length)];
  } else {
    item = ITEM_BY_ID[4];
  }
  addItem(c.id, item.id);

  updateCharacter(c);
  addLog(c.id, {
    type: 'daily_quest', title: '🎁 โบนัสครบทุกภารกิจ', detail: `+${xp} XP, +${gold} ทอง และได้ ${item.icon} ${item.name}! (คอมโบภารกิจ ${nextStreak} วัน)`,
    xp, gold,
  });
  return { gold, xp, ups, item: { id: item.id, name: item.name, icon: item.icon }, streak: nextStreak, mult };
}
