process.env.POMOQUEST_CLASS_PERKS = '0'; // ปิดค่าพิเศษคลาส (ทดสอบเฉพาะใน test-class-perks)

// ทดสอบระบบเหตุการณ์สุ่มระหว่าง session (rollEvent) แบบ deterministic — ใช้ DB แยก ไม่แตะของจริง
process.env.POMOQUEST_DB = `/tmp/pq-test-events-${Date.now()}.db`;

const { db } = await import('../server/db.js');
const { rollEvent } = await import('../server/game.js');
const { CLASSES, MONSTERS } = await import('../server/data.js');
const { addLog, getLog } = await import('../server/db.js');

// สร้างตัวละคร
const b = CLASSES.warrior.base;
const info = db.prepare(
  `INSERT INTO character (name, class, hp, max_hp, mp, max_mp, atk, def, spd, crit) VALUES (?,?,?,?,?,?,?,?,?,?)`
).run('เทสต์', 'warrior', b.hp, b.hp, b.mp, b.mp, b.atk, b.def, b.spd, b.crit);
let c = db.prepare('SELECT * FROM character WHERE id = ?').get(info.lastInsertRowid);

let pass = 0;
let fail = 0;

const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

// --- forceKey ---
expect('forceKey ที่ไม่มี → null', rollEvent(c, 'nonexistent') === null);
expect('forceKey ไม่ได้ระบุ (สุ่ม) → ได้ event', rollEvent(c) !== null);

// --- monster: สู้แบบอัตโนมัติ ---
{
  const goldBefore = c.gold;
  const xpBefore = c.xp;
  const levelBefore = c.level;
  const ev = rollEvent(c, 'monster');
  expect('monster: logType เป็น battle_win/battle_lose', ['battle_win', 'battle_lose'].includes(ev.logType), ev.logType);
  expect('monster: เสีย HP ไม่เกิน 0', ev.hpChange <= 0, `hpChange=${ev.hpChange}`);
  expect('monster: มีชื่อมอนสเตอร์ใน flavor', ev.monster?.name && ev.flavor.includes(ev.monster.name));
  expect('monster: ได้ XP ≥ 0', ev.xp >= 0, `xp=${ev.xp}`);
  expect('monster: ได้ทอง ≥ 0', ev.gold >= 0, `gold=${ev.gold}`);
  expect('monster: ทองในตัวละครเพิ่มตาม', c.gold === goldBefore + ev.gold);
  // XP อาจ reset เป็นเศษเหลือตอนเลเวลอัพ — ต้องได้ XP เพิ่ม หรือเลเวลเพิ่ม
  expect('monster: ตัวละครได้ XP หรือเลเวลเพิ่ม', c.xp > xpBefore || c.level > levelBefore, `xp=${c.xp} (ก่อน ${xpBefore}), lv=${c.level}`);
}

// --- treasure ---
{
  const ev = rollEvent(c, 'treasure');
  expect('treasure: logType = treasure', ev.logType === 'treasure');
  expect('treasure: ได้ XP และทอง', ev.xp > 0 && ev.gold > 0, `xp=${ev.xp}, gold=${ev.gold}`);
  expect('treasure: ไอเทมเป็น null หรือมี id', ev.item === null || typeof ev.item.id === 'number');
  expect('treasure: เก็บ logType ไว้สำหรับบันทึก log', !!ev.logType);
}

// --- shrine: XP หรือ MP อย่างใดอย่างหนึ่ง ---
{
  const ev = rollEvent(c, 'shrine');
  expect('shrine: logType = shrine', ev.logType === 'shrine');
  expect('shrine: ได้ XP หรือ MP อย่างใดอย่างหนึ่ง', ev.xp > 0 || ev.mpChange > 0, `xp=${ev.xp}, mpChange=${ev.mpChange}`);
}

// --- merchant: ทองหรือไอเทม ---
{
  const ev = rollEvent(c, 'merchant');
  expect('merchant: logType = merchant', ev.logType === 'merchant');
  expect('merchant: ได้ทองหรือไอเทม', ev.gold > 0 || ev.item !== null, `gold=${ev.gold}, item=${ev.item?.name || '-'}`);
}

// --- egg: event พิเศษให้ไข่ปริศนา (ระบบสัตว์เลี้ยง) ---
{
  const ev = rollEvent(c, 'egg');
  expect('egg: logType = egg + ได้ไข่ (item 170)', ev.logType === 'egg' && ev.item?.id === 170, `item=${ev.item?.name || '-'}`);
}

// --- treasure: มีโอกาสเจอไข่แทนของปกติ (สุ่ม — ตรวจว่าโครงสร้างไม่พัง + ได้ของ) ---
{
  const ev = rollEvent(c, 'treasure');
  expect('treasure: ได้ทอง + XP เสมอ', ev.gold > 0 && ev.xp > 0, `gold=${ev.gold}, xp=${ev.xp}`);
}

// --- trap: เสีย HP ---
{
  const hpBefore = c.hp;
  const ev = rollEvent(c, 'trap');
  expect('trap: logType = trap', ev.logType === 'trap');
  expect('trap: เสีย HP', ev.hpChange < 0, `hpChange=${ev.hpChange}`);
  expect('trap: HP ในตัวละครลดตาม', c.hp === Math.max(1, hpBefore + ev.hpChange));
}

// --- บันทึก event ลง log (hp/mp ที่เปลี่ยนเก็บใน DB เพื่อดูย้อนหลัง) ---
{
  const id = addLog(c.id, { type: 'trap', title: 'กับดัก', detail: 'เสียพลัง', hpChange: -15, mpChange: 5 });
  const rows = getLog(c.id, 1);
  expect('addLog เก็บ hp_change/mp_change ลง DB', rows[0]?.hp_change === -15 && rows[0]?.mp_change === 5, `hp=${rows[0]?.hp_change}, mp=${rows[0]?.mp_change}`);
  expect('getLog เรียงล่าสุดก่อน (id ล่าสุดอยู่บนสุด)', rows[0]?.id === id);
}

// --- city: เก็บเมืองไว้กับ session summary (ใช้ dropdown กรองเมืองในหน้าประวัติ) ---
{
  addLog(c.id, { type: 'session_summary', title: '📋 Session 1/4 @ 09:00', detail: 'สรุป', city: 'แอสการ์ด', sessionKey: 'city-test' });
  addLog(c.id, { type: 'session_summary', title: '📋 Session 1/4 @ 10:00', detail: 'สรุป', city: 'ปราสาทมังกร', sessionKey: 'city-test-2' });
  const cities = db.prepare(
    "SELECT city, MIN(id) AS first_id FROM log WHERE character_id = ? AND type = 'session_summary' AND city IS NOT NULL GROUP BY city ORDER BY first_id"
  ).all(c.id).map((r) => r.city);
  expect('session_summary เก็บเมือง + รวมรายชื่อเมืองตามลำดับ session แรก', JSON.stringify(cities) === JSON.stringify(['แอสการ์ด', 'ปราสาทมังกร']), cities.join(','));
}

// --- monster loot: ชนะมอนสเตอร์มีโอกาส ~40% ได้ของประจำตัว (ขยะราคาต่ำ) ---
{
  let wins = 0, dropped = 0, bad = 0;
  for (let i = 0; i < 400; i++) {
    const ev = rollEvent(c, 'monster');
    if (!ev.monster?.win) continue;
    wins++;
    if (ev.item) {
      dropped++;
      const lootId = MONSTERS.find((m) => m.name === ev.monster.name)?.loot;
      // ของที่ดรอปต้องเป็น loot ของมอนสเตอร์ตัวนั้น + เป็นขยะ + ระบุในรายละเอียด
      if (ev.item.id !== lootId || ev.item.type !== 'junk' || !ev.detail.includes('และได้')) bad++;
    } else if (ev.detail.includes('และได้')) {
      bad++; // ไม่มีของแต่รายงานว่ามี
    }
  }
  expect('monster loot: ดรอปเฉพาะตอนชนะ + เป็นของประจำตัวมอนสเตอร์', wins > 0 && dropped > 0 && bad === 0, `win=${wins}, drop=${dropped}`);
}

// --- dodgeChance (SPD → โอกาสหลบโจมตีบอส) ---
{
  const { dodgeChance } = await import('../server/game.js');
  expect('dodgeChance: warrior spd 8 → 6%', dodgeChance(8) === 6, `got ${dodgeChance(8)}`);
  expect('dodgeChance: rogue spd 14 → 11% (หลบเก่งสุด)', dodgeChance(14) === 11, `got ${dodgeChance(14)}`);
  expect('dodgeChance: cap ที่ 20%', dodgeChance(100) === 20, `got ${dodgeChance(100)}`);
}

// --- export/import JSON (data-io) — roundtrip + เช็คเวอร์ชัน ---
{
  const { exportJsonData, restoreFromJson, SCHEMA_VERSION } = await import('../server/data-io.js');
  // เตรียมข้อมูล: ตัวละคร + log
  const name = 'ไอโอ-' + Date.now();
  db.prepare('UPDATE character SET name = ? WHERE id = ?').run(name, c.id);
  addLog(c.id, { type: 'battle_win', title: 'ชนะ', detail: 'x', xp: 10, sessionKey: 'io-test' });

  const data = exportJsonData(db);
  expect('exportJsonData: มี header app/version + ข้อมูลตัวละคร', data.app === 'pomoquest' && data.version === SCHEMA_VERSION && data.character.length === 1);
  expect('exportJsonData: มี log ที่เพิ่งเพิ่ม', data.log.some((l) => l.session_key === 'io-test'));

  // ล้างข้อมูล แล้วกู้คืนจาก export — ต้องได้ตัวละครกลับมา
  db.prepare('DELETE FROM character').run();
  db.prepare('DELETE FROM log').run();
  expect('ล้างข้อมูลแล้ว (ก่อน restore)', db.prepare('SELECT COUNT(*) n FROM character').get().n === 0);
  restoreFromJson(db, data);
  const back = db.prepare('SELECT * FROM character WHERE name = ?').get(name);
  expect('restoreFromJson: ตัวละครกลับมาเหมือนเดิม', back && back.id === c.id && back.class === 'warrior');
  expect('restoreFromJson: log กลับมาเหมือนเดิม', db.prepare("SELECT COUNT(*) n FROM log WHERE session_key = 'io-test'").get().n === 1);

  // เวอร์ชันไม่ตรง → ต้อง reject
  let rejected = false;
  try { restoreFromJson(db, { ...data, version: SCHEMA_VERSION + 1 }); } catch { rejected = true; }
  expect('restoreFromJson: เวอร์ชันไม่ตรง → reject', rejected);
  // app ไม่ใช่ pomoquest → reject
  let rejected2 = false;
  try { restoreFromJson(db, { ...data, app: 'other' }); } catch { rejected2 = true; }
  expect('restoreFromJson: app ไม่ใช่ pomoquest → reject', rejected2);
}

// --- session_key: จับกลุ่มเหตุการณ์ของ session เดียวกัน (ใช้ในหน้าประวัติ session) ---
{
  const key = `test-${Date.now()}`;
  addLog(c.id, { type: 'battle_win', title: 'ชนะมอนสเตอร์', detail: 'กำราบได้', xp: 10, sessionKey: key });
  addLog(c.id, { type: 'treasure', title: 'พบสมบัติ', detail: 'เปิดกล่อง', gold: 5, sessionKey: key });
  addLog(c.id, { type: 'session_summary', title: '📋 Session 1/4 @ 09:00', detail: 'สรุป', sessionKey: key });
  addLog(c.id, { type: 'battle_win', title: 'session อื่น', detail: 'คนละกลุ่ม', sessionKey: 'other-key' });
  const rows = db.prepare(
    `SELECT * FROM log WHERE character_id = ? AND session_key = ? AND type NOT IN ('session_summary','session_done','llm_tale') ORDER BY id`
  ).all(c.id, key);
  expect('session_key: จับกลุ่มเหตุการณ์ของ session ได้ (ไม่รวมสรุป/คนละกลุ่ม)', rows.length === 2 && rows[0].type === 'battle_win' && rows[1].type === 'treasure', `count=${rows.length}`);
}

// --- จัดสรรแต้มอัตโนมัติ (src/alloc.js): น้ำหนักตามคลาส + ปรับตามอุปกรณ์ ---
{
  const { CLASS_WEIGHTS, gearAdjustedWeights, allocatePoints } = await import('../src/alloc.js');
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const a = allocatePoints(10, CLASS_WEIGHTS.warrior);
  expect('alloc: แจกครบจำนวนที่กำหนด', sum(a) === 10, JSON.stringify(a));
  expect('alloc: warrior เน้น HP/ATK > DEF > SPD > MP', a.hp >= a.def && a.atk >= a.def && a.def >= a.spd && a.spd >= a.mp, JSON.stringify(a));
  const wAdj = gearAdjustedWeights('warrior', { hp: 0, mp: 0, atk: 6, def: 0, spd: 0 }, { hp: 120, mp: 20, atk: 14, def: 10, spd: 8 });
  expect('alloc: สวมเกียร์ ATK → น้ำหนัก ATK ลดลง', wAdj.atk < CLASS_WEIGHTS.warrior.atk, `atk ${wAdj.atk}`);
  expect('alloc: เกียร์ไม่มีผลกับ HP → น้ำหนัก HP เท่าเดิม', wAdj.hp === CLASS_WEIGHTS.warrior.hp);
  const plain = allocatePoints(25, CLASS_WEIGHTS.warrior);
  const geared = allocatePoints(25, wAdj);
  expect('alloc: เกียร์ ATK → แต้ม ATK น้อยลง ไป DEF แทน', geared.atk <= plain.atk && geared.def >= plain.def, `plain=${JSON.stringify(plain)} gear=${JSON.stringify(geared)}`);

  // --- alloc แบบมีเป้าหมาย: เติม stat ให้ถึงเกณฑ์สวมของในกระเป๋า (equipGoals + allocateWithGoals) ---
  const { equipGoals, allocateWithGoals } = await import('../src/alloc.js');
  const stats = { hp: 120, mp: 20, atk: 14, def: 10, spd: 8 };
  const items = [
    { type: 'weapon', classReq: ['warrior'], lvl: 1, statReq: { atk: 20 }, name: 'ดาบเป้าหมาย', icon: '🗡️' },
    { type: 'armor', classReq: ['mage'], lvl: 1, statReq: { def: 12 }, name: 'ของคลาสอื่น', icon: '🛡️' },   // คลาสไม่ตรง → ไม่ใช่เป้าหมาย
    { type: 'armor', classReq: ['warrior'], lvl: 99, statReq: { def: 12 }, name: 'เลเวลยังไม่ถึง', icon: '🛡️' }, // เลเวลไม่พอ → ไม่ใช่เป้าหมาย
    { type: 'consumable', statReq: { atk: 99 }, name: 'ของใช้', icon: '🧪' },                                  // ไม่ใช่อุปกรณ์ → ไม่ใช่เป้าหมาย
  ];
  const g = equipGoals('warrior', 5, stats, items);
  expect('equipGoals: เจอเป้าหมายเฉพาะของที่สวมได้แต่ขาด stat (ATK 20)', JSON.stringify(g.goals) === '{"atk":20}', JSON.stringify(g.goals));
  expect('equipGoals: กรองคลาสอื่น/เลเวลไม่พอ/ของใช้ออก', g.items.length === 1, `items=${g.items.length}`);
  const withGoal = allocateWithGoals(10, CLASS_WEIGHTS.warrior, g.goals, stats);
  expect('allocateWithGoals: เติม ATK ให้ถึง 20 ก่อน (6 แต้ม)', withGoal.atk >= 6 && stats.atk + withGoal.atk >= 20, JSON.stringify(withGoal));
  expect('allocateWithGoals: แจกครบจำนวน', sum(withGoal) === 10, JSON.stringify(withGoal));
  const noGoal = allocateWithGoals(10, CLASS_WEIGHTS.warrior, {}, stats);
  expect('allocateWithGoals: ไม่มีเป้าหมาย = เหมือน allocatePoints', JSON.stringify(noGoal) === JSON.stringify(allocatePoints(10, CLASS_WEIGHTS.warrior)), JSON.stringify(noGoal));
  const small = allocateWithGoals(3, CLASS_WEIGHTS.warrior, { atk: 20 }, { ...stats, atk: 14 });
  expect('allocateWithGoals: แต้มไม่พอ → เอาไปเติมเป้าหมายที่ใกล้ที่สุดก่อน', small.atk === 3, JSON.stringify(small));
}

// --- ชิปข้อจำกัดไอเทม (src/itemreq.js): แสดง "ขาด X" เมื่อ stat ยังไม่ถึงเกณฑ์ ---
{
  const { itemReqParts } = await import('../src/itemreq.js');
  const sword = { type: 'weapon', statReq: { atk: 20 }, lvl: 1 };
  const weak = itemReqParts(sword, { atk: 14, def: 10 });
  expect('itemReq: stat ไม่ถึงเกณฑ์ → แสดง "ขาด X"', weak.some((p) => p.text.includes('ATK 20+ (ขาด 6)')), JSON.stringify(weak));
  const strong = itemReqParts(sword, { atk: 22, def: 10 });
  expect('itemReq: stat ถึงเกณฑ์แล้ว → ไม่โชว์ "ขาด"', strong.some((p) => p.text === 'ATK 20+'), JSON.stringify(strong));
  const noChar = itemReqParts(sword, null);
  expect('itemReq: ไม่มี character → ไม่โชว์ "ขาด" (แบบเดิม)', noChar.some((p) => p.text === 'ATK 20+'), JSON.stringify(noChar));
  // โหมดวางแผน (dry-run): สถานะหลัง alloc = character + alloc*ค่าต่อแต้ม → เช็คว่าจะสวมของได้ไหม
  const { itemReqMissing } = await import('../src/itemreq.js');
  const weakChar = { level: 5, class: 'warrior', atk: 14, def: 10, spd: 8, mp: 20 };
  const gear = { type: 'weapon', item_id: 1, statReq: { atk: 20 }, lvl: 1 };
  expect('plan: ก่อน alloc สวมไม่ได้ (ขาด ATK)', itemReqMissing(gear, weakChar).length === 1, JSON.stringify(itemReqMissing(gear, weakChar)));
  const afterChar = { ...weakChar, atk: weakChar.atk + 6 }; // alloc ATK 6 แต้ม (+1/แต้ม)
  expect('plan: alloc ATK 6 แต้มแล้ว → สวมได้', itemReqMissing(gear, afterChar).length === 0, JSON.stringify(itemReqMissing(gear, afterChar)));
  const afterChar2 = { ...weakChar, atk: weakChar.atk + 3 }; // alloc ไม่พอ
  expect('plan: alloc ไม่พอ → ยังสวมไม่ได้', itemReqMissing(gear, afterChar2).length === 1, JSON.stringify(itemReqMissing(gear, afterChar2)));
}

// --- ทุก event ต้องมี title/flavor/detail สำหรับแสดงผล ---
for (const key of ['monster', 'treasure', 'shrine', 'merchant', 'trap']) {
  const ev = rollEvent(c, key);
  expect(`${key}: มี title/flavor/detail ครบ`, !!ev.title && !!ev.flavor && !!ev.detail);
}

console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
