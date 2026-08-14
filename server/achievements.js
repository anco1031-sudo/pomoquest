import { ACHIEVEMENTS } from './data.js';
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
    level: c.level,
    gold: c.gold,
    equip: c.weapon_id && c.armor_id && c.accessory_id ? 1 : 0,
  };
}

// ตรวจ + ปลดล็อก achievement ใหม่ — คืน { fresh, ups }
export function checkAchievements(c, prog) {
  const unlockedRows = db.prepare('SELECT achievement_id FROM achievement_unlock WHERE character_id = ?').all(c.id);
  const unlocked = new Set(unlockedRows.map((r) => r.achievement_id));
  const values = achievementValues(c, prog);
  const fresh = [];
  let ups = 0;

  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    if ((values[a.stat] ?? 0) >= a.target) {
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
    }
  }

  if (fresh.length) updateCharacter(c); // gold/xp/level เปลี่ยน
  return { fresh, ups };
}

// รายการ achievement พร้อมสถานะสำหรับ UI
export function getAchievementList(c, prog) {
  const rows = db.prepare('SELECT achievement_id, unlocked_at FROM achievement_unlock WHERE character_id = ?').all(c.id);
  const map = new Map(rows.map((r) => [r.achievement_id, r.unlocked_at]));
  const values = achievementValues(c, prog);
  return {
    total: ACHIEVEMENTS.length,
    unlocked: rows.length,
    list: ACHIEVEMENTS.map((a) => {
      const val = Math.min(values[a.stat] ?? 0, a.target);
      return {
        id: a.id,
        name: a.name,
        desc: a.desc,
        icon: a.icon,
        reward: a.reward,
        unlocked: map.has(a.id),
        unlockedAt: map.get(a.id) || null,
        progress: val,
        target: a.target,
      };
    }),
  };
}
