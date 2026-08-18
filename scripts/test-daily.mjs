process.env.POMOQUEST_CLASS_PERKS = '0'; // ปิดค่าพิเศษคลาส (ทดสอบเฉพาะใน test-class-perks)

// ทดสอบระบบ Daily Quest (ใช้ DB ชั่วคราว ไม่แตะข้อมูลจริง)
process.env.POMOQUEST_DB = `/tmp/pq-daily-${Date.now()}.db`;

const { db } = await import('../server/db.js');
const { getDailyQuests, claimDailyQuest, claimDailyAll, randomRewardItem } = await import('../server/daily.js');
const { CLASSES, SHOP_STOCK } = await import('../server/data.js');
const { bumpDaily, today } = await import('../server/db.js');

const b = CLASSES.warrior.base;
const info = db.prepare(`INSERT INTO character (name, class, hp, max_hp, mp, max_mp, atk, def, spd, crit) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run('ลุย', 'warrior', b.hp, b.hp, b.mp, b.mp, b.atk, b.def, b.spd, b.crit);
const c = db.prepare('SELECT * FROM character WHERE id = ?').get(info.lastInsertRowid);

let pass = 0;
let fail = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label} ${extra}`);
  cond ? pass++ : fail++;
};

const quests = getDailyQuests(c).quests;
check('สุ่ม quest 3 อัน', quests.length === 3);

// --- ภารกิจใหม่ "นักล่าตำนานเมือง" (ชนะมอนสเตอร์ประจำเมือง — ตรวจ definition + counter) ---
const { DAILY_QUESTS } = await import('../server/data.js');
const cityQuestDef = DAILY_QUESTS.find((q) => q.id === 'dq_city_monster');
check('มีภารกิจ "นักล่าตำนานเมือง" (key=city_monsters, target 1)', !!cityQuestDef && cityQuestDef.key === 'city_monsters' && cityQuestDef.target() === 1, cityQuestDef?.name);
const q0 = getDailyQuests(c).quests.find((q) => q.id === 'dq_city_monster');
if (q0) {
  bumpDaily(c.id, 'city_monsters', 1);
  const q1 = getDailyQuests(c).quests.find((q) => q.id === 'dq_city_monster');
  check('bump city_monsters → ความคืบหน้าภารกิจอัปเดต (1/1)', !!q1 && q1.progress >= q1.target && q1.done === true, JSON.stringify(q1));
}
check('ร้านค้าไม่มีไอเทม exclusive', SHOP_STOCK.every((i) => !i.exclusive));
check('randomRewardItem มีโอกาสได้ exclusive', (() => {
  for (let i = 0; i < 30; i++) {
    if (randomRewardItem(c).exclusive) return true;
  }
  return false;
})());

// ทำเควสให้ครบโดย bump counter ตาม key ของ quest ที่สุ่มได้
const date = today();
for (const q of quests) bumpDaily(c.id, q.key, q.target);

const after = getDailyQuests(c);
check('allDone = true หลังทำครบ', after.allDone);

// รับรางวัลแต่ละอัน — ทดสอบเลือกทั้ง 3 แบบ: ทอง / XP / ไอเทม
const choice = ['gold', 'xp', 'item'];
after.quests.forEach((q, i) => {
  const r = claimDailyQuest(c, q.id, choice[i % 3]);
  if (choice[i % 3] === 'gold') check(`claim ${q.name} (ทอง)`, !r.error && r.gold > 0 && !r.xp, `(+${r.gold} ทอง)`);
  else if (choice[i % 3] === 'xp') check(`claim ${q.name} (XP)`, !r.error && r.xp > 0 && !r.gold, `(+${r.xp} XP)`);
  else check(`claim ${q.name} (ไอเทม)`, !r.error && r.item, `(ได้ ${r.item?.icon} ${r.item?.name})`);
});
const afterClaim = getDailyQuests(c);
check('allClaimed ยังเป็น false (ยังไม่ได้โบนัส)', afterClaim.allClaimed === false);
check('บันทึกประเภทที่เลือก (claimedReward)', afterClaim.quests.every((q) => q.claimed && q.claimedReward));

// รับโบนัสครบทุกภารกิจ (วันแรก → streak 1, คูณ x1.0)
const bonus = claimDailyAll(c);
check('โบนัสครบทุกภารกิจ (วันแรก)', !bonus.error && bonus.gold > 0 && bonus.item && bonus.streak === 1 && bonus.mult === 1,
  `(+${bonus.gold} ทอง, streak ${bonus.streak}, x${bonus.mult.toFixed(1)}, ได้ ${bonus.item?.icon} ${bonus.item?.name})`);
check('รับโบนัสซ้ำต้อง error', !!claimDailyAll(c).error);
check('allClaimed = true หลังรับโบนัส', getDailyQuests(c).allClaimed === true);

// จำลองวันถัดไป: ลบแถวโบนัสของวันนี้ แล้วย้าย last_date เป็นเมื่อวาน → ควร streak 2, x1.2
const clearBonus = () => {
  db.prepare("DELETE FROM daily_quest_done WHERE character_id = ? AND quest_id = 'ALL_BONUS'").run(c.id);
};
clearBonus();
db.prepare("UPDATE daily_streak SET last_date = date('now','localtime','-1 day') WHERE character_id = ?").run(c.id);
const bonus2 = claimDailyAll(c);
check('วันต่อเนื่อง → streak 2 และโบนัสสูงขึ้น', bonus2.streak === 2 && bonus2.mult === 1.2 && bonus2.gold > bonus.gold,
  `(+${bonus2.gold} ทอง, streak ${bonus2.streak}, x${bonus2.mult.toFixed(1)})`);

// จำลองข้ามวันไป 3 วัน → ควรรีเซ็ต streak เป็น 1, x1.0
clearBonus();
db.prepare("UPDATE daily_streak SET last_date = date('now','localtime','-3 day') WHERE character_id = ?").run(c.id);
const bonus3 = claimDailyAll(c);
check('ข้ามวัน → streak รีเซ็ตเป็น 1 และโบนัสลดลง', bonus3.streak === 1 && bonus3.mult === 1 && bonus3.gold < bonus2.gold,
  `(+${bonus3.gold} ทอง, streak ${bonus3.streak}, x${bonus3.mult.toFixed(1)})`);

// getDailyQuests ต้องคืน streak และ bonusMult
const q = getDailyQuests(c);
check('getDailyQuests คืน streak/bonusMult', typeof q.streak === 'number' && q.bonusMult >= 1);

console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
