// ทดสอบระบบสำรวจเมืองเดิมต่อ — ชนะบอสแล้วเลือกเดินทางต่อ/อยู่ต่อ + บอสลับ + ความยาก/รางวัล/ตลาดมืด + ราคาร้าน
process.env.POMOQUEST_DB = `/tmp/pq-test-explore-${Date.now()}.db`;
process.env.POMOQUEST_NO_WANDER = '1'; // ปิดบอสเร่ร่อนรายสัปดาห์ — กันผลขึ้นกับสัปดาห์จริง (ทดสอบบอสเมือง/บอสลับตรง ๆ)

const express = (await import('express')).default;
const routes = (await import('../server/routes.js')).default;
const { default: devRoutes } = await import('../server/dev.js');
const { db, addItem } = await import('../server/db.js');
const {
  generateBoss, marketPrice, campSellPrice, blackMarketOpen, bmExtraChance,
  exploreMult, exploreRewardMult,
} = await import('../server/game.js');
const { ITEM_BY_ID, SHOP_STOCK, ALT_BOSSES, altBossAt } = await import('../server/data.js');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use('/api', devRoutes);
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let pass = 0;
let fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

try {
  let r = await api('/character/create', { method: 'POST', body: { name: 'นักสำรวจ', class: 'warrior' } });
  const cid = r.json.character?.id;
  expect('create: สร้างตัวละครสำเร็จ', r.status === 200 && !!cid);

  // --- serializeCharacter: ข้อมูลรอบการสำรวจ ---
  r = await api('/state');
  const ch = r.json.character;
  expect('state: มี cityRound/exploreMult/altBossAtRound', ch.cityRound === 0 && ch.exploreMult === 1 && ch.exploreRewardMult === 1 && ch.altBossAtRound > 0,
    `cityRound=${ch.cityRound} exploreMult=${ch.exploreMult} altBossAtRound=${ch.altBossAtRound}`);
  expect('altBossAt: แต่ละเมืองรอบไม่เท่ากัน (city 0..3 = 3,4,2,3)', altBossAt(0) === 3 && altBossAt(1) === 4 && altBossAt(2) === 2 && altBossAt(3) === 3);

  // --- ราคาร้าน: ส่วนใหญ่ราคาปกติ, มีของที่ต้องการ (🔥) และสุ่มไม่กี่ชิ้นลดราคา ---
  const dayKey = '2026-08-16';
  const prices = SHOP_STOCK.map((i) => marketPrice(i, dayKey));
  const hot = prices.filter((p) => p.hot).length;
  const sale = prices.filter((p) => p.sale).length;
  const normal = prices.filter((p) => !p.hot && !p.sale && p.mult === 1).length;
  expect('marketPrice: มีสินค้าราคาปกติ (mult=1) เป็นส่วนใหญ่', normal > 0 && normal > sale, `ปกติ ${normal} · 🔥 ${hot} · 🏷️ ${sale} จาก ${prices.length}`);
  expect('marketPrice: ของที่ต้องการ (hot) ราคาแพงขึ้น >x1.15', prices.every((p) => !p.hot || p.mult >= 1.2));
  expect('marketPrice: ของที่ลดราคา ราคาถูกลง <x0.95', prices.every((p) => !p.sale || p.mult <= 0.9));
  expect('marketPrice: wanted ตรงกับราคาขาย (seed เดียวกัน)', (() => {
    const item = SHOP_STOCK[0];
    return marketPrice(item, dayKey).hot === campSellPrice(item, dayKey).wanted;
  })());

  // --- ชนะบอส: ไม่ย้ายเมืองอัตโนมัติ + รางวัลบอสมี exploreRewardMult ---
  db.prepare('UPDATE character SET city_rounds = 1, level = 5, max_hp = 500, hp = 500, mp = 100, atk = 60, def = 40 WHERE id = ?').run(cid);
  addItem(cid, 1, 20); // ยาเผื่อ
  r = await api('/boss');
  expect('boss: เริ่มสู้บอสได้', r.status === 200 && !!r.json.boss);
  const boss0 = r.json.boss;
  let guard = 0;
  let win = null;
  while (!win && guard < 80) {
    guard++;
    const act = await api('/boss/act', { method: 'POST', body: { action: 'attack' } });
    if (act.json.outcome === 'win') { win = act.json; break; }
    if (act.json.error) { console.log('boss/act error:', act.json.error); break; }
  }
  expect('boss/act: ชนะบอสได้', !!win && win.outcome === 'win');
  if (win) {
    expect('boss/act: ชนะแล้วเมืองยังไม่ย้าย (รอเลือก)', win.character.cityIndex === 0, `cityIndex=${win.character.cityIndex}`);
    expect('boss/act: cityRound ยังเท่าเดิม (ไม่เพิ่มตอนชนะ)', win.character.cityRound === 1);
    // รางวัลบอส x exploreRewardMult (รอบ 1 = x1.2): base Lv.5 = 250+300=550 → 660
    // (บังเอิญสลายท่าไม้ตายระหว่างรุมได้ → โบนัสฝีมือ +8%/ครั้ง สูงสุด +24% — ยอมรับช่วง 660..660x1.24 กันผล RNG)
    const xpMatch = win.log.find((l) => /\+\d+ XP/.test(l))?.match(/\+(\d+) XP/);
    const xpGot = xpMatch ? parseInt(xpMatch[1], 10) : 0;
    expect('boss/act: รางวัล XP คูณ exploreRewardMult (x1.2 ±โบนัสสลาย)', xpGot >= 660 && xpGot <= Math.round(660 * 1.24), `XP=${xpGot} (คาด 660–${Math.round(660 * 1.24)})`);

    // --- เลือก "สำรวจเมืองเดิมต่อ" ---
    r = await api('/boss/after', { method: 'POST', body: { choice: 'stay' } });
    expect('boss/after stay: รอบเพิ่มเป็น 2 + เมืองเดิม', r.json.character.cityRound === 2 && r.json.character.cityIndex === 0,
      `cityRound=${r.json.character.cityRound}`);

    // --- บอสรอบถัดไปแข็งขึ้น (exploreMult) ---
    r = await api('/boss');
    expect('boss: รอบ 2 แข็งขึ้นกว่าแรก (exploreMult x1.3)', r.json.boss.maxHp > boss0.maxHp, `maxHp ${boss0.maxHp} → ${r.json.boss.maxHp}`);

    // --- เจอบอสลับเมื่อครบรอบของเมือง ---
    db.prepare('UPDATE character SET city_rounds = 3 WHERE id = ?').run(cid); // altBossAt(0) = 3
    await api('/boss/retreat', { method: 'POST' }); // เคลียร์ fight ที่สร้างตอนรอบ 2 → บอสใหม่สร้างตามรอบปัจจุบัน
    r = await api('/boss');
    expect('boss: เจอบอสลับเมื่อครบรอบ (city 0 รอบ 3)', r.json.boss.isAlt === true && ALT_BOSSES.some((b) => b.name === r.json.boss.name),
      `${r.json.boss.icon} ${r.json.boss.name} isAlt=${r.json.boss.isAlt}`);

    // --- เลือก "เดินทางต่อ" — ย้ายเมือง + รีเซ็ตรอบ ---
    r = await api('/boss/after', { method: 'POST', body: { choice: 'travel' } });
    expect('boss/after travel: ย้ายเมืองถัดไป + รอบรีเซ็ต', r.json.character.cityIndex === 1 && r.json.character.cityRound === 0,
      `cityIndex=${r.json.character.cityIndex} cityRound=${r.json.character.cityRound}`);
  }

  // --- ตัวคูณตามรอบ ---
  const c2 = { city_rounds: 3 };
  expect('exploreMult: รอบ 3 = x1.45', exploreMult(c2) === 1.45);
  expect('exploreRewardMult: รอบ 3 = x1.6', exploreRewardMult(c2) === 1.6);
  expect('bmExtraChance: รอบ 3 = +0.3, รอบ 5 ถูกแคป +0.35', bmExtraChance({ city_rounds: 3 }) === 0.3 && bmExtraChance({ city_rounds: 5 }) === 0.35);
  expect('blackMarketOpen: โอกาสเพิ่มเมื่อสำรวจ (extra 0.4 → เปิด)', (() => {
    // หา visit ที่ rng > 0.25 แต่ < 0.65 — เดิมไม่เปิด แต่พอ extra 0.4 แล้วเปิด
    for (let v = 1; v < 300; v++) {
      const visit = `bm-${v}`;
      if (!blackMarketOpen(visit, 0) && blackMarketOpen(visit, 0.4)) return true;
    }
    return false;
  })());

  // --- generateBoss: บอสลับโหดกว่า ---
  db.prepare('UPDATE character SET city_rounds = 3 WHERE id = ?').run(cid);
  const alt = generateBoss(10, 0, { city_rounds: 3 });
  const norm = generateBoss(10, 0, { city_rounds: 0 });
  expect('generateBoss: บอสลับแข็งกว่าบอสปกติ (x1.25 เพิ่ม)', alt.isAlt && alt.maxHp > norm.maxHp, `maxHp ปกติ ${norm.maxHp} vs ลับ ${alt.maxHp}`);

  console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
} finally {
  server.close();
  db.close();
}
process.exit(fail > 0 ? 1 : 0);
