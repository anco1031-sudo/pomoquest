import { ACHIEVEMENTS, SECRET_ACHIEVEMENTS } from './data.js';
import { gainXp } from './game.js';
import { db, addLog, updateCharacter } from './db.js';

// แปลง stat key -> ค่าปัจจุบัน (อ่านจาก character + progress)
export function achievementValues(c, prog) {
  return {
    sessions: prog.sessions_completed,
    cycles: prog.cycles_completed,
    bosses: prog.bosses_defeated,
    monsters: prog.monsters_slain,
    treasures: prog.treasures_found,
    quests: prog.quests_completed,
    focus_sec: prog.total_focus_sec,
    streak: prog.best_streak,
    gold_earned: prog.gold_earned,
    wanted_sales: prog.wanted_sales || 0,
    level: c.level,
    gold: c.gold,
    equip: c.head_id && c.armor_id && c.arms_id && c.legs_id && c.feet_id ? 1 : 0,
  };
}

// สร้าง context สำหรับตรวจเงื่อนไขตราลับ (extra = ข้อมูลเฉพาะจุดที่เรียก เช่น hour, bossWin, event)
export function buildCtx(c, prog, extra = {}) {
  const unlockedRows = db.prepare('SELECT achievement_id FROM achievement_unlock WHERE character_id = ?').all(c.id);
  const unlockedSet = new Set(unlockedRows.map((r) => r.achievement_id));
  const bossWin = extra.bossWin || {};
  return {
    // ค่าพื้นฐาน
    hour: extra.hour ?? -1,
    dailyStreak: prog.daily_streak,
    streak: prog.best_streak,
    cycles: prog.cycles_completed,
    merchantGifts: prog.merchant_gifts,
    shrines: prog.shrines,
    traps: prog.traps,
    bossPotions: prog.boss_potions,
    normalUnlocked: ACHIEVEMENTS.filter((a) => unlockedSet.has(a.id)).length,
    // ค่าจาก event
    eventItemLvl: extra.event?.item?.lvl ?? -1,
    // ค่าจากชัยชนะบอส
    bossPlayerHp: bossWin.hp ?? -1,
    bossHpPct: bossWin.pct ?? -1,
    bossNoEquip: bossWin.noEquip === true,
    bossCityIndex: bossWin.cityIndex ?? -1,
  };
}

// ตรวจ + ปลดล็อก achievement ใหม่ (ทั้งปกติและลับ) — คืน { fresh, ups }
export function checkAchievements(c, prog, extra = {}) {
  const unlockedRows = db.prepare('SELECT achievement_id FROM achievement_unlock WHERE character_id = ?').all(c.id);
  const unlocked = new Set(unlockedRows.map((r) => r.achievement_id));
  const values = achievementValues(c, prog);
  const ctx = buildCtx(c, prog, extra);
  const fresh = [];
  let ups = 0;

  const tryUnlock = (a) => {
    if (unlocked.has(a.id)) return;
    const ins = db.prepare('INSERT OR IGNORE INTO achievement_unlock (character_id, achievement_id) VALUES (?, ?)').run(c.id, a.id);
    if (ins.changes) {
      fresh.push(a);
      if (a.reward.gold) c.gold += a.reward.gold;
      if (a.reward.xp) ups += gainXp(c, a.reward.xp);
      addLog(c.id, {
        type: 'achievement',
        title: `🏅 ปลดล็อก: ${a.name}`,
        detail: a.desc,
        gold: a.reward.gold || 0,
        xp: a.reward.xp || 0,
      });
    }
  };

  // ตราปกติ (ตามค่าสถานะ)
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    if ((values[a.stat] ?? 0) >= a.target) tryUnlock(a);
  }

  // ตราลับ (check function)
  for (const a of SECRET_ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    let ok = false;
    try { ok = a.check(ctx); } catch { ok = false; }
    if (ok) tryUnlock(a);
  }

  if (fresh.length) updateCharacter(c); // gold/xp/level เปลี่ยน
  return { fresh, ups };
}

// รายการ achievement พร้อมสถานะสำหรับ UI (ตราลับซ่อนชื่อ/ความคืบหน้า)
export function getAchievementList(c, prog) {
  const rows = db.prepare('SELECT achievement_id, unlocked_at FROM achievement_unlock WHERE character_id = ?').all(c.id);
  const map = new Map(rows.map((r) => [r.achievement_id, r.unlocked_at]));
  const values = achievementValues(c, prog);

  const normal = ACHIEVEMENTS.map((a) => {
    const unlocked = map.has(a.id);
    const val = Math.min(values[a.stat] ?? 0, a.target);
    return {
      id: a.id, name: a.name, desc: a.desc, icon: a.icon, reward: a.reward,
      secret: false, unlocked, unlockedAt: map.get(a.id) || null,
      progress: val, target: a.target,
    };
  });

  const secret = SECRET_ACHIEVEMENTS.map((a) => ({
    id: a.id, name: a.name, hint: a.hint, desc: a.desc, icon: a.icon, reward: a.reward,
    secret: true, unlocked: map.has(a.id), unlockedAt: map.get(a.id) || null,
  }));

  return {
    total: ACHIEVEMENTS.length + SECRET_ACHIEVEMENTS.length,
    unlocked: rows.length,
    list: [...normal, ...secret],
  };
}
