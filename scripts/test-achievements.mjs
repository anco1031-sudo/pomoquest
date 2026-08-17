process.env.POMOQUEST_CLASS_PERKS = '0'; // ปิดค่าพิเศษคลาส (ทดสอบเฉพาะใน test-class-perks)

// ทดสอบเงื่อนไขตราลับทั้งหมดแบบ deterministic (ใช้ DB แยก ไม่แตะของจริง)
process.env.POMOQUEST_DB = `/tmp/pq-test-${Date.now()}.db`;

const { db } = await import('../server/db.js');
const { checkAchievements, getAchievementList } = await import('../server/achievements.js');
const { ACHIEVEMENTS, CLASSES } = await import('../server/data.js');
const { getProgress } = await import('../server/db.js');

// สร้างตัวละคร
const b = CLASSES.warrior.base;
const info = db.prepare(
  `INSERT INTO character (name, class, hp, max_hp, mp, max_mp, atk, def, spd, crit) VALUES (?,?,?,?,?,?,?,?,?,?)`
).run('เทสต์', 'warrior', b.hp, b.hp, b.mp, b.mp, b.atk, b.def, b.spd, b.crit);
const c = db.prepare('SELECT * FROM character WHERE id = ?').get(info.lastInsertRowid);
let prog = getProgress(c.id);

let pass = 0;
let fail = 0;

const setProg = (patch) => {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE progress SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...patch, id: prog.id });
  prog = getProgress(c.id);
};

const expect = (label, res, wantIds) => {
  const got = res.fresh.map((a) => a.id).sort();
  const want = [...wantIds].sort();
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✅' : '❌'} ${label} — got [${got.join(', ')}] want [${want.join(', ')}]`);
  ok ? pass++ : fail++;
};

// --- หมวดเวลา ---
expect('owl (จบ session ตี 2)', checkAchievements(c, prog, { hour: 2 }), ['owl']);
expect('early_bird (จบ session ตี 6)', checkAchievements(c, prog, { hour: 6 }), ['early_bird']);
expect('owl ผิดเวลา (เที่ยง) ไม่ปลดล็อก', checkAchievements(c, prog, { hour: 12 }), []);
setProg({ daily_streak: 7 });
expect('seven_days (โฟกัส 7 วันติด)', checkAchievements(c, prog), ['seven_days']);
setProg({ best_streak: 10 });
expect('fenix (คอมโบ 10) + ตราปกติ streak_3/7', checkAchievements(c, prog), ['fenix', 'streak_3', 'streak_7']);

// --- หมวดโชค/เหตุการณ์ ---
expect('legend_treasure (ไอเทม lvl 5 จากสมบัติ)', checkAchievements(c, prog, { event: { item: { lvl: 5 } } }), ['legend_treasure']);
expect('legend_treasure ไอเทม lvl 1 ไม่ปลดล็อก', checkAchievements(c, prog, { event: { item: { lvl: 1 } } }), []);
setProg({ merchant_gifts: 3 });
expect('merchant_friend (พ่อค้าแจกของ 3 ครั้ง)', checkAchievements(c, prog), ['merchant_friend']);
setProg({ shrines: 5 });
expect('devotee (ศาลเจ้า 5 ครั้ง)', checkAchievements(c, prog), ['devotee']);
setProg({ traps: 10 });
expect('expensive_lesson (กับดัก 10 ครั้ง)', checkAchievements(c, prog), ['expensive_lesson']);

// --- หมวดความท้าทาย ---
expect('abyss (ชนะบอส HP=1)', checkAchievements(c, prog, { bossWin: { hp: 1 } }), ['abyss']);
expect('abyss HP=50 ไม่ปลดล็อก', checkAchievements(c, prog, { bossWin: { hp: 50 } }), []);
expect('bloodthirst (ชนะบอส HP < 15%)', checkAchievements(c, prog, { bossWin: { hp: 10, pct: 10 } }), ['bloodthirst']);
expect('bloodthirst 50% ไม่ปลดล็อก', checkAchievements(c, prog, { bossWin: { hp: 60, pct: 50 } }), []);
expect('saint (ชนะบอสไม่สวมอุปกรณ์)', checkAchievements(c, prog, { bossWin: { hp: 50, pct: 40, noEquip: true, cityIndex: 0 } }), ['saint']);
setProg({ boss_potions: 10 });
expect('alchemist (ใช้ยาในสู้บอส 10 ขวด)', checkAchievements(c, prog), ['alchemist']);

// --- หมวดการค้นพบ ---
setProg({ cycles_completed: 8 });
expect('explorer (ครบ 8 เมือง) + ตราปกติ traveler', checkAchievements(c, prog), ['explorer', 'traveler']);
expect('asgard_slayer (ชนะบอสที่แอสการ์ด)', checkAchievements(c, prog, { bossWin: { cityIndex: 7 } }), ['asgard_slayer']);
expect('asgard_slayer เมืองอื่นไม่ปลดล็อก', checkAchievements(c, prog, { bossWin: { cityIndex: 2 } }), []);

// --- ตราใหม่: เต็มยศประจำคลาส (สวมอุปกรณ์เฉพาะคลาส 2 ชิ้น) ---
db.prepare('UPDATE character SET weapon_id = 200, armor_id = 201 WHERE id = ?').run(c.id); // ขวานมังกรเพลิง + เกราะไททัน (ของนักรบ)
const c2 = db.prepare('SELECT * FROM character WHERE id = ?').get(c.id);
expect('class_set (สวมของนักรบ 2 ชิ้น)', checkAchievements(c2, prog), ['class_set']);

db.prepare('UPDATE character SET weapon_id = NULL, armor_id = NULL WHERE id = ?').run(c.id);
const c3 = db.prepare('SELECT * FROM character WHERE id = ?').get(c.id);
expect('class_set ถอดแล้วไม่ปลดล็อก', checkAchievements(c3, prog), []);

// --- ตราตลาดมืด: ซื้อของจากตลาดมืด ---
setProg({ bm_buys: 3 });
expect('bm_deal (ซื้อตลาดมืด 3 ครั้ง)', checkAchievements(c, prog), ['bm_deal']);
setProg({ bm_buys: 10 });
expect('bm_king (ซื้อตลาดมืด 10 ครั้ง — bm_deal ปลดไปแล้วจากเคสก่อน)', checkAchievements(c, prog), ['bm_king']);

// --- ตราของแถม: เก็บของแถม (ซื้อของราคา 0 จากพ่อค้า/ตลาดมืด) ---
setProg({ freebies: 5 });
expect('freebie_5 (เก็บของแถม 5 ชิ้น)', checkAchievements(c, prog), ['freebie_5']);
setProg({ freebies: 15 });
expect('freebie_15 (เก็บของแถม 15 ชิ้น)', checkAchievements(c, prog), ['freebie_15']);

// --- ตราโหมดท้าทาย (รอบเมืองที่จบในโหมดนั้น) ---
c.challenge_mode = 'hard';
prog.hard_cycles = 1;
expect('challenge_hard (จบ 1 รอบในโหมดโหด)', checkAchievements(c, prog), ['challenge_hard']);
c.challenge_mode = 'marathon';
prog.marathon_cycles = 0;
expect('challenge_marathon: ยังไม่จบรอบ → ไม่ปลดล็อก', checkAchievements(c, prog), []);
prog.marathon_cycles = 1;
expect('challenge_marathon (จบ 1 รอบในโหมดมาราธอน)', checkAchievements(c, prog), ['challenge_marathon']);
c.challenge_mode = 'survival';
prog.survival_cycles = 1;
expect('challenge_survival (จบ 1 รอบในโหมดเอาชีวิตรอด)', checkAchievements(c, prog), ['challenge_survival']);
c.challenge_mode = '';

// --- ระบบต่อสู้บอส: สลายท่าไม้ตาย (จอมสลาย) + ชนะด้วยฝีมือ/อดทน ---
setProg({ charge_breaks: 5 });
expect('break_5 (สลายท่าไม้ตาย 5 ครั้ง)', checkAchievements(c, prog), ['break_5']);
setProg({ charge_breaks: 15 });
expect('break_15 (สลายท่าไม้ตาย 15 ครั้ง)', checkAchievements(c, prog), ['break_15']);
expect('break_win (ชนะโดยสลายท่าไม้ตาย ≥1 ในไฟต์)', checkAchievements(c, prog, { bossWin: { breaks: 1 } }), ['break_win']);
expect('break_win ไม่สลายไม่ปลดล็อก', checkAchievements(c, prog, { bossWin: { breaks: 0 } }), []);
expect('fury_win (ชนะตอนบอสสุดทน)', checkAchievements(c, prog, { bossWin: { fury: true } }), ['fury_win']);
expect('fury_win ปกติไม่ปลดล็อก', checkAchievements(c, prog, { bossWin: { fury: false } }), []);

// --- จ้าวแห่งการโฟกัส (ต้องปลดล็อกตราปกติครบ 25) ---
for (const a of ACHIEVEMENTS) {
  db.prepare('INSERT OR IGNORE INTO achievement_unlock (character_id, achievement_id) VALUES (?,?)').run(c.id, a.id);
}
expect('master (ปลดล็อกตราปกติครบทุกอัน)', checkAchievements(c, prog), ['master']);

// --- รายการสำหรับ UI ---
const list = getAchievementList(c, prog);
const secretCount = list.list.filter((a) => a.secret).length;
const lockedSecret = list.list.filter((a) => a.secret && !a.unlocked);
const okSecretCount = secretCount === 20 && lockedSecret.length === 0;
console.log(`${okSecretCount ? '✅' : '❌'} รายการ UI: ตราลับ ${secretCount} อัน (ปลดล็อกครบ ${list.list.filter((a) => a.secret && a.unlocked).length})`);
okSecretCount ? pass++ : fail++;

console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
