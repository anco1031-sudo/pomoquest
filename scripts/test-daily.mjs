// ทดสอบระบบ Daily Quest (ใช้ DB ชั่วคราว ไม่แตะข้อมูลจริง)
process.env.POMOQUEST_DB = `/tmp/pq-daily-${Date.now()}.db`;

const { db } = await import('../server/db.js');
const { getDailyQuests, claimDailyQuest, claimDailyAll } = await import('../server/daily.js');
const { CLASSES } = await import('../server/data.js');
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

// ทำเควสให้ครบโดย bump counter ตาม key ของ quest ที่สุ่มได้
const date = today();
for (const q of quests) bumpDaily(c.id, q.key, q.target);

const after = getDailyQuests(c);
check('allDone = true หลังทำครบ', after.allDone);

// รับรางวัลแต่ละอัน
for (const q of after.quests) {
  const r = claimDailyQuest(c, q.id);
  check(`claim ${q.name}`, !r.error && r.gold > 0, `(+${r.gold} ทอง)`);
}
check('allClaimed ยังเป็น false (ยังไม่ได้โบนัส)', getDailyQuests(c).allClaimed === false);

// รับโบนัสครบทุกภารกิจ
const bonus = claimDailyAll(c);
check('โบนัสครบทุกภารกิจ', !bonus.error && bonus.gold > 0 && bonus.item, `(+${bonus.gold} ทอง, ได้ ${bonus.item?.icon} ${bonus.item?.name})`);
check('รับโบนัสซ้ำต้อง error', !!claimDailyAll(c).error);
check('allClaimed = true หลังรับโบนัส', getDailyQuests(c).allClaimed === true);

console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
