process.env.POMOQUEST_CLASS_PERKS = '0'; // ปิดค่าพิเศษคลาส (ทดสอบเฉพาะใน test-class-perks)

// ทดสอบ API routes แบบ end-to-end — รัน server ชั่วคราวที่ port สุ่ม + DB แยก (ไม่แตะของจริง)
process.env.POMOQUEST_DB = `/tmp/pq-test-api-${Date.now()}.db`;
process.env.POMOQUEST_NO_DRAGON = '1'; // ปิดสุ่มจ้าวมังกรทอง (4%) — กันผลขึ้นกับดวงตอนเทสต์ generateBoss/บอสเร่ร่อน

const express = (await import('express')).default;
const routes = (await import('../server/routes.js')).default;
const { default: devRoutes, devDryRun } = await import('../server/dev.js');
const { db, addItem } = await import('../server/db.js');
const { equipBlockReason } = await import('../server/game.js');
const { ITEM_BY_ID } = await import('../server/data.js');

const app = express();
app.use(express.json());
app.use('/api', devDryRun); // dev test: request ที่มี x-dev-token → ลองเล่น (ไม่บันทึก)
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
  // --- เริ่มต้น: ยังไม่มีตัวละคร ---
  let r = await api('/state');
  expect('state: เริ่มต้นยังไม่มีตัวละคร', r.status === 200 && r.json.hasCharacter === false);

  // --- สร้างตัวละคร (warrior) ---
  r = await api('/character/create', { method: 'POST', body: { name: 'นักรบเทสต์', class: 'warrior' } });
  expect('create: สร้างตัวละครสำเร็จ', r.status === 200 && !!r.json.character?.id, r.json.error || '');
  const cid = r.json.character.id;

  r = await api('/state');
  expect('state: มีตัวละครแล้ว (warrior Lv.1)', r.status === 200 && r.json.hasCharacter === true && r.json.character.class === 'warrior');

  // --- ข้อจำกัดอุปกรณ์: เฉพาะคลาส ---
  addItem(cid, 15, 1); // ดาบสั้นคู่ใจ (rogue เท่านั้น)
  r = await api('/inventory/equip', { method: 'POST', body: { itemId: 15 } });
  expect('equip: ดาบของโจร → warrior สวมไม่ได้ (เฉพาะคลาส)', r.status === 400 && r.json.error.includes('เฉพาะคลาส'), r.json.error);

  // --- ข้อจำกัดอุปกรณ์: ค่าสถานะขั้นต่ำ (DEF 12+) — Lv.1 ยังโดนเกทเลเวลก่อน ---
  addItem(cid, 22, 1); // เกราะเหล็ก statReq def 12, lvl 3 — warrior base def 10
  r = await api('/inventory/equip', { method: 'POST', body: { itemId: 22 } });
  expect('equip: เกราะเหล็กต้องเลเวล 3 → Lv.1 สวมไม่ได้', r.status === 400 && r.json.error.includes('เลเวล 3'), r.json.error);

  // --- ข้อจำกัดอุปกรณ์: เลเวล ---
  addItem(cid, 11, 1); // ดาบเหล็ก lvl 2 — ตอนนี้ Lv.1
  r = await api('/inventory/equip', { method: 'POST', body: { itemId: 11 } });
  expect('equip: ดาบเหล็กต้องเลเวล 2 → Lv.1 สวมไม่ได้', r.status === 400 && r.json.error.includes('เลเวล 2'), r.json.error);

  // --- อัปเลเวล + เพิ่ม DEF → สวมได้สำเร็จ ---
  db.prepare('UPDATE character SET level = 2 WHERE id = ?').run(cid);
  r = await api('/inventory/equip', { method: 'POST', body: { itemId: 11 } });
  expect('equip: อัปเลเวล 2 แล้วสวมดาบเหล็กได้', r.status === 200 && r.json.character.equipment?.weapon?.id === 11, r.json.error || '');
  db.prepare('UPDATE character SET level = 3, def = 14 WHERE id = ?').run(cid);
  r = await api('/inventory/equip', { method: 'POST', body: { itemId: 22 } });
  expect('equip: เลเวล 3 + DEF 14 ผ่านเกณฑ์ → สวมเกราะเหล็กได้', r.status === 200 && r.json.character.equipment?.body?.id === 22, r.json.error || '');

  // --- ไอเทมเฉพาะคลาสชุดใหม่: โจร + มีดอาบพิษ (id 204, คลาสโจร, ATK 15+) ---
  await api('/character/create', { method: 'POST', body: { name: 'โจรเทสต์', class: 'rogue' } }); // สลับไปตัวโจร (active)
  const rcid = (await api('/state')).json.character.id;
  addItem(rcid, 204, 1);
  r = await api('/inventory/equip', { method: 'POST', body: { itemId: 204 } });
  expect('equip: มีดอาบพิษ — โจร Lv.1 (ยังไม่ถึง lvl 4) สวมไม่ได้', r.status === 400 && r.json.error.includes('เลเวล 4'), r.json.error);
  db.prepare('UPDATE character SET level = 4, atk = 18 WHERE id = ?').run(rcid); // ATK 18 ≥ 15
  r = await api('/inventory/equip', { method: 'POST', body: { itemId: 204 } });
  expect('equip: มีดอาบพิษ — โจร Lv.4 (ATK 18 ≥ 15) สวมได้', r.status === 200 && r.json.character.equipment?.weapon?.id === 204, r.json.error || '');
  await api('/character/select', { method: 'POST', body: { id: cid } }); // กลับไปเล่น warrior (เทสต์ถัดไปอ้างอิงตัวนี้)

  // --- data integrity: ไอเทมเฉพาะคลาส ---
  {
    const { ITEMS, CLASSES } = await import('../server/data.js');
    const ids = ITEMS.map((i) => i.id);
    expect('data: id ไอเทมไม่ซ้ำกัน', new Set(ids).size === ids.length);
    const classItems = ITEMS.filter((i) => i.classReq);
    const covered = new Set(classItems.flatMap((i) => i.classReq));
    expect('data: มีไอเทมเฉพาะคลาสครบทั้ง 4 คลาส', covered.size === 4 && [...covered].every((k) => !!CLASSES[k]), [...covered].join(','));
    expect('data: classReq ทุกอันเป็นคลาสจริง', classItems.every((i) => i.classReq.every((k) => !!CLASSES[k])));
  }

  // --- equipBlockReason (logic ล้วน) ---
  const w = db.prepare('SELECT * FROM character WHERE id = ?').get(cid);
  expect('equipBlockReason: คทาจอมเวท (mage) → warrior ถูกบล็อก', (equipBlockReason(w, ITEM_BY_ID[17]) || '').includes('เฉพาะคลาส นักเวทย์'));
  expect('equipBlockReason: โล่ศักดิ์สิทธิ์ (cleric) → warrior ถูกบล็อก', (equipBlockReason(w, ITEM_BY_ID[52]) || '').includes('เฉพาะคลาส'));
  expect('equipBlockReason: เกราะหนัง (ไม่มีข้อจำกัด) → null', equipBlockReason(w, ITEM_BY_ID[20]) === null);

  // --- จบ session → session_done log + progress เพิ่ม ---
  r = await api('/adventure/complete', {
    method: 'POST',
    body: { focusSec: 1500, pauseSec: 180, sessionIdx: 1, sessionsPerCycle: 4, sessionKey: 'api-test-key', events: [{ logType: 'battle_win', title: 'ชนะ', detail: 'กำราบ หมาป่า ได้สำเร็จ!', xp: 24, gold: 14 }] },
  });
  expect('complete: จบ session สำเร็จ (ได้ XP/ทอง)', r.status === 200 && r.json.character.xp > 0 && r.json.character.gold > 0, r.json.error || '');
  const done = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'session_done'").get(cid);
  expect('complete: มี log session_done 1 อัน', done.n === 1);
  const summ = db.prepare("SELECT * FROM log WHERE character_id = ? AND type = 'session_summary'").get(cid);
  expect('complete: มี session summary (พร้อม session_key)', !!summ && summ.session_key === 'api-test-key');
  const pauseSec = db.prepare('SELECT pause_sec FROM progress WHERE character_id = ?').get(cid)?.pause_sec || 0;
  expect('complete: พักกลาง session (pauseSec 180 วิ) นับแยกจาก break_sec', pauseSec === 180, `pause_sec=${pauseSec}`);
  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const storedPauseLog = db.prepare("SELECT pause_sec FROM log WHERE character_id = ? AND type = 'session_done' ORDER BY id DESC LIMIT 1").get(cid);
  expect('complete: บันทึก pause_sec ลง log session_done (สำหรับกราฟรายวัน)', storedPauseLog?.pause_sec === 180, JSON.stringify(storedPauseLog));
  r = await api('/stats');
  const todayPause = r.json.breakDays?.find((d) => d.date === today)?.pauseSec || 0;
  expect('stats: กราฟ 7 วันมีพักกลาง session (pauseSec วันนี้ = 180)', todayPause === 180, `pauseSec วันนี้=${todayPause}`);

  // --- /session-history ---
  r = await api('/session-history');
  expect('session-history: คืน session ที่จบไป (มี session_key)', r.status === 200 && r.json.sessions?.length === 1 && r.json.sessions[0].session_key === 'api-test-key');
  expect('session-history: session มี challenge_mode (ตอนนั้นเล่นโหมดอะไร)', r.status === 200 && r.json.sessions[0].challenge_mode === '', JSON.stringify(r.json.sessions[0]?.challenge_mode));

  // --- พักยาว 😴: แยกหมวดสถิติจากพักสั้น + เก็บชื่อเหตุผลใน log ---
  // (ใช้ตัวละครแยก — ไม่รบกวน cid ที่เทสต์อื่น ๆ อ้างถึง / เลเวล-relative xp ของ dev test)
  r = await api('/character/create', { method: 'POST', body: { name: 'พักยาวAPI', class: 'warrior' } });
  expect('create: สร้างตัวละครสำหรับเทสต์พักยาวได้', r.status === 200, r.json.error || '');
  const lpId = r.json.character.id;
  r = await api('/adventure/complete', {
    method: 'POST',
    body: { focusSec: 1500, pauseSec: 0, longPauseSec: 900, longPauseTitle: 'ไปกินข้าว', sessionIdx: 1, sessionsPerCycle: 4, sessionKey: 'api-test-long', events: [] },
  });
  expect('complete: จบ session หลังพักยาว (longPauseSec 900 วิ)', r.status === 200, r.json.error || '');
  const lpRow = db.prepare('SELECT pause_sec, long_pause_sec FROM progress WHERE character_id = ?').get(lpId);
  expect('progress: พักยาวแยกหมวด (long_pause_sec = 900, pause_sec = 0)', lpRow?.long_pause_sec === 900 && (lpRow?.pause_sec || 0) === 0, JSON.stringify(lpRow));
  const lpLog = db.prepare("SELECT long_pause_sec, long_pause_title, detail FROM log WHERE character_id = ? AND type = 'session_done' ORDER BY id DESC LIMIT 1").get(lpId);
  expect('log session_done: long_pause_sec = 900 + คอลัมน์ชื่อพักยาว', lpLog?.long_pause_sec === 900 && lpLog?.long_pause_title === 'ไปกินข้าว' && (lpLog?.detail || '').includes('ไปกินข้าว'), JSON.stringify(lpLog));
  r = await api('/stats');
  const todayLongPause = r.json.breakDays?.find((d) => d.date === today)?.longPauseSec || 0;
  expect('stats: กราฟ 7 วันมีพักยาว (longPauseSec วันนี้ = 900)', todayLongPause === 900, `longPauseSec วันนี้=${todayLongPause}`);
  const lpTitleRow = (r.json.longPauseTitles || []).find((t) => t.title === 'ไปกินข้าว');
  expect('stats: พักยาวแยกตามชื่อ (ไปกินข้าว = 900 วิ x1)', !!lpTitleRow && lpTitleRow.sec === 900 && lpTitleRow.times === 1, JSON.stringify(r.json.longPauseTitles));
  r = await api('/character/select', { method: 'POST', body: { id: cid } }); // กลับไป cid — เทสต์ถัด ๆ ไปใช้ cid เหมือนเดิม

  // --- เรื่องราว LLM ในประวัติ session: llm_tale เกาะกลุ่ม session ด้วย session_key (ค้นหา/อ่านได้) ---
  db.prepare("INSERT INTO log (character_id, type, title, detail, session_key, created_at) VALUES (?, 'llm_tale', '📖 เรื่องราวการผจญภัย', 'ทดสอบเรื่องราว: กำราบหมาป่าแล้วพบสมบัติกลางป่า', 'api-test-key', datetime('now','localtime'))").run(cid);
  r = await api('/session-history');
  const taleSess = r.json.sessions?.find((s) => s.session_key === 'api-test-key');
  expect('session-history: เรื่องราว LLM ถูกเก็บไว้ใน session (อ่านย้อนหลังได้)', !!taleSess && taleSess.events.some((e) => e.type === 'llm_tale' && e.detail.includes('กำราบหมาป่า')), JSON.stringify(taleSess?.events?.map((e) => e.type)));

  // --- ราคาร้าน: originalPrice = ราคาเดิมก่อนลด/ขึ้น (ใช้ขีดฆ่าในร้าน) ---
  r = await api('/camp?visit=v-price-test');
  const shopItems = r.json.shop || [];
  expect('camp: ไอเทมร้านมี originalPrice (ราคาเดิม) ครบทุกชิ้น', shopItems.length > 0 && shopItems.every((i) => typeof i.originalPrice === 'number' && i.originalPrice > 0), JSON.stringify(shopItems.slice(0, 2).map((i) => [i.name, i.price, i.originalPrice])));
  const priceDiff = shopItems.filter((i) => i.sale || i.hot);
  expect('camp: ของลด/ขึ้นราคา — originalPrice ต่างจากราคาจริง (เห็นการขีดฆ่า)', priceDiff.every((i) => i.originalPrice !== i.price));

  // --- /weekly-summary ---
  r = await api('/weekly-summary');
  expect('weekly-summary: คืนตัวเลขครบ (thisWeek/lastWeek)', r.status === 200 && r.json.thisWeek?.sessions === 1 && r.json.lastWeek?.sessions === 0, JSON.stringify(r.json));

  // --- /stats ---
  r = await api('/stats');
  expect('stats: คืน days + monthDays', r.status === 200 && Array.isArray(r.json.days) && Array.isArray(r.json.monthDays));

  // --- ตั้งค่า ---
  r = await api('/settings', { method: 'PUT', body: { work_min: 40 } });
  const st = await api('/state');
  expect('settings: บันทึก work_min 40 ได้', st.json.settings?.work_min === 40, String(st.json.settings?.work_min));

  // --- ของรางวัลบอส: ทุกบอสมี loot เป็นขยะ + generateBoss ส่ง loot ต่อ ---
  {
    const { BOSSES } = await import('../server/data.js');
    const { generateBoss } = await import('../server/game.js');
    expect('data: บอสทุกตัวมี loot เป็นขยะจริง', BOSSES.every((b) => { const i = ITEM_BY_ID[b.loot]; return i && i.type === 'junk' && i.price > 0; }));
    expect('generateBoss: บอสเมืองแรกมี loot 130 (ตราโจรป่า)', generateBoss(5, 0).loot === 130);
  }

  // --- ตลาดมืด: เจอสุ่ม ~25% (deterministic จาก visit) + ซื้อ/ขายราคาพิเศษ ---
  {
    const { seededRng, campSellPrice } = await import('../server/game.js');
    const { today } = await import('../server/db.js');
    // หา visit ที่ตลาดมืดเปิด / ไม่เปิด (deterministic — ลองจนเจอ)
    let bmVisit = null, normalVisit = null;
    for (let i = 0; i < 60 && (!bmVisit || !normalVisit); i++) {
      const v = `bm-test-${i}`;
      const open = seededRng(`bm-open-${v}`)() < 0.25;
      if (open && !bmVisit) bmVisit = v;
      if (!open && !normalVisit) normalVisit = v;
    }
    expect('black market: เจอ visit เปิด/ไม่เปิดตลาดมืด', !!bmVisit && !!normalVisit, `open=${bmVisit} closed=${normalVisit}`);

    r = await api(`/camp?visit=${encodeURIComponent(normalVisit)}`);
    expect('camp: ค่ายปกติไม่มีตลาดมืด', r.status === 200 && r.json.blackMarket === null);

    db.prepare('UPDATE character SET gold = 5000 WHERE id = ?').run(cid);
    r = await api(`/camp?visit=${encodeURIComponent(bmVisit)}`);
    const bm = r.json.blackMarket;
    // response ใช้ field `price` (ราคาลดแล้ว) + `bmNormal` (ราคาปกติ) — 5 ช่อง: คัมภีร์/ของหายาก/ของเถื่อน/ของพิเศษ exclusive + กล่องลึกลับ (ราคาเต็ม)
    expect('camp: ตลาดมืด 5 ชิ้น (4 ราคาลด + กล่องลึกลับราคาเต็ม)', !!bm && bm.items.length === 5 && bm.items.filter((i) => i.id !== 220).every((i) => i.price < i.bmNormal) && bm.items.some((i) => i.id === 220 && i.price === i.bmNormal), JSON.stringify(bm?.items?.map((i) => [i.name, i.price, i.bmNormal])));
    expect('black market: มีของพิเศษ exclusive หลุดมา (ไม่ใช่ถุงเงินนำโชค 40)', !!bm?.items.some((i) => i.exclusive && i.id !== 40), JSON.stringify(bm?.items?.map((i) => i.name)));
    const r2 = await api(`/camp?visit=${encodeURIComponent(bmVisit)}`);
    expect('black market: เปิดหน้าเดิมซ้ำ ของ/ราคาเหมือนเดิม (deterministic)', JSON.stringify(r.json.shop) === JSON.stringify(r2.json.shop));

    const scroll = bm.items.find((i) => i.type === 'scroll');
    const goldBefore = r.json.character.gold;
    r = await api('/shop/buy', { method: 'POST', body: { itemId: scroll.id, visit: bmVisit } });
    expect('black market: ซื้อคัมภีร์ราคาลดได้', r.status === 200 && r.json.character.gold === goldBefore - scroll.price, r.json.error || '');
    const bb = db.prepare('SELECT bm_buys FROM progress WHERE character_id = ?').get(cid)?.bm_buys || 0;
    expect('black market: นับ bm_buys +1 หลังซื้อ (ตรา)', bb === 1, `bm_buys=${bb}`);
    r = await api('/shop/buy', { method: 'POST', body: { itemId: scroll.id, visit: bmVisit } });
    expect('black market: ซื้อซ้ำไม่ได้ (ครั้งเดียวต่อค่ายพัก)', r.status === 400);

    // ขาย junk ให้ตลาดมืด = ราคาปกติ x1.25 (ใช้ item 123 — ไม่ชนกับเคส daily quest ที่ขาย 122)
    addItem(cid, 123, 1);
    const normalPrice = campSellPrice(ITEM_BY_ID[123], today()).price;
    const goldBefore2 = (await api('/state')).json.character.gold;
    r = await api('/shop/sell', { method: 'POST', body: { itemId: 123, qty: 1, visit: bmVisit } });
    const expected = Math.round(normalPrice * 1.25);
    expect('black market: ขาย junk ให้ตลาดมืดแพงกว่า +25%', r.status === 200 && r.json.character.gold === goldBefore2 + expected, `expect +${expected}, got +${r.json.character.gold - goldBefore2}`);
    const trades = db.prepare("SELECT value FROM daily_counter WHERE character_id = ? AND date = ? AND key = 'bm_trades'").get(cid, db.prepare("SELECT date('now','localtime') AS d").get().d)?.value || 0;
    expect('daily quest: bm_trades นับ 2 (ซื้อ + ขายตลาดมืด)', trades === 2, `bm_trades=${trades}`);
    // สถิติในหน้า Stats: ซื้อ 1 (เสียทอง) + ขาย 1 (ได้ทอง) → กำไร = ได้ - เสีย
    r = await api('/stats');
    const bs = r.json.bmStats;
    expect('stats: bmStats นับซื้อ 1 / ขาย 1', bs?.buys === 1 && bs?.sells === 1, JSON.stringify(bs));
    expect('stats: bmStats กำไร = รายได้ขาย - ทองที่ใช้ซื้อ', bs?.profit === bs.sellGold - bs.buyGold && bs.sellGold > 0 && bs.buyGold > 0, JSON.stringify(bs));
  }

  // --- ของแถม (พ่อค้า/ตลาดมืดไม่อยากได้ — ราคา 0) — สุ่มรายค่ายพัก deterministic จาก visit ---
  {
    const { campFreebieId } = await import('../server/game.js');
    const rows = [{ item_id: 1, qty: 0, market: 'camp' }, { item_id: 2, qty: 0, market: 'camp' }, { item_id: 3, qty: 0, market: 'camp' }];
    // deterministic: visit เดียวกัน + stock เดียวกัน → ของแถมคนเดิม (เปิดซ้ำหน้าเดิมได้ของเดิม)
    expect('freebie: deterministic จาก visit (เปิดซ้ำได้ของเดิม)', campFreebieId('freebie-unit-1', cid, rows) === campFreebieId('freebie-unit-1', cid, rows));
    // มีโอกาสเจอของแถมจริง (35%) — สแกน seed หลายค่า
    let anyFree = false;
    for (let i = 0; i < 40 && !anyFree; i++) anyFree = campFreebieId(`freebie-scan-${i}`, cid, rows) !== null;
    expect('freebie: มีโอกาสเจอของแถมจริง (35%)', anyFree);
    // ของพิเศษ exclusive ไม่สุ่มให้ฟรี (กันลดคุณค่ารางวัล daily quest)
    const exclId = Object.values(ITEM_BY_ID).find((i) => i.exclusive)?.id;
    expect('freebie: ของพิเศษ exclusive ไม่สุ่มให้ฟรี', campFreebieId('freebie-unit-2', cid, [{ item_id: exclId, qty: 0, market: 'camp' }]) === null);
    // ของเทศกาลไม่สุ่มให้ฟรี (ลด 20% อยู่แล้ว)
    expect('freebie: ของเทศกาลไม่สุ่มให้ฟรี', campFreebieId('freebie-unit-3', cid, [{ item_id: 1, qty: 0, market: 'festival' }]) === null);
    // มีตลาดมืด → สุ่มจากของตลาดมืดเท่านั้น (พ่อค้าทั่วไปปิดร้าน)
    const picked = campFreebieId('freebie-unit-4', cid, [{ item_id: 1, qty: 0, market: 'camp' }, { item_id: 2, qty: 0, market: 'black' }]);
    expect('freebie: มีตลาดมืด → สุ่มจากของตลาดมืดเท่านั้น', picked === null || picked === 2, `picked=${picked}`);

    // API: หาค่ายพักที่มีของแถม (สแกน visit — deterministic) → ราคา 0 + ซื้อฟรีได้ ทองไม่ลด
    let freeVisit = null, freeItem = null;
    for (let i = 0; i < 80 && !freeVisit; i++) {
      const v = `freebie-api-${i}`;
      const d = await api(`/camp?visit=${encodeURIComponent(v)}`);
      const fi = d.json.shop?.find((x) => x.free);
      if (fi) { freeVisit = v; freeItem = fi; }
    }
    expect('freebie api: เจอค่ายพักที่มีของแถม', !!freeVisit && !!freeItem);
    if (freeVisit && freeItem) {
      expect('freebie api: ราคาของแถมเป็น 0', freeItem.price === 0, `${freeItem.name} price=${freeItem.price}`);
      const d2 = await api(`/camp?visit=${encodeURIComponent(freeVisit)}`);
      const fi2 = d2.json.shop?.find((x) => x.free);
      expect('freebie api: เปิดซ้ำของแถมคนเดิม (deterministic)', fi2?.id === freeItem.id && fi2?.price === 0);
      const goldBefore = (await api('/state')).json.character.gold;
      r = await api('/shop/buy', { method: 'POST', body: { itemId: freeItem.id, visit: freeVisit } });
      expect('freebie api: ซื้อของแถมได้ฟรี (ทองไม่ลด) + ข้อความของแถม', r.status === 200 && r.json.character.gold === goldBefore && (r.json.message || '').includes('ของแถม'), r.json.error || r.json.message);
      const freebies = db.prepare('SELECT freebies FROM progress WHERE character_id = ?').get(cid)?.freebies || 0;
      expect('freebie api: นับ freebies +1 หลังซื้อของแถม (ตรา)', freebies === 1, `freebies=${freebies}`);
      r = await api('/shop/buy', { method: 'POST', body: { itemId: freeItem.id, visit: freeVisit } });
      expect('freebie api: ซื้อของแถมซ้ำไม่ได้ (ครั้งเดียวต่อค่ายพัก)', r.status === 400);
    }
  }

  // --- ของใหม่: กล่องลึกลับตลาดมืด / คราฟต์จากแบบแปลน / ราคาขายตามเมือง / ถ้วยรางวัล / บอสเร่ร่อน ---
  {
    const { mysteryBoxRoll, wanderingBossAt, campSellPrice, generateBoss } = await import('../server/game.js');
    const { WANDERING_BOSSES, ITEM_BY_ID } = await import('../server/data.js');

    // ราคาขายตามเมือง: เมืองไกลขายแพงกว่า (x1.05/เมือง — เมือง index 11 ≈ x1.55)
    const p0 = campSellPrice(ITEM_BY_ID[102], '2026-08-16', 0).price;
    const p11 = campSellPrice(ITEM_BY_ID[102], '2026-08-16', 11).price;
    expect('city sell: เมืองไกลขายแพงกว่า (~x1.05/เมือง)', p11 > p0 && p11 >= Math.round(p0 * 1.5) && p11 <= Math.round(p0 * 1.6), `p0=${p0} p11=${p11}`);
    expect('city sell: deterministic (วัน+เมืองเดียวกัน ราคาเท่ากัน)', campSellPrice(ITEM_BY_ID[102], '2026-08-16', 5).price === campSellPrice(ITEM_BY_ID[102], '2026-08-16', 5).price);

    // กล่องลึกลับ: deterministic จาก visit + สุ่มได้ไอเทมจริง (ไม่ใช่กล่องเอง)
    const b1 = mysteryBoxRoll('box-test-1', { id: cid, level: 3, class: 'warrior' });
    const b2 = mysteryBoxRoll('box-test-1', { id: cid, level: 3, class: 'warrior' });
    expect('box: deterministic จาก visit (เปิดซ้ำได้ของเดิม)', b1?.id === b2?.id);
    expect('box: ผลสุ่มเป็นไอเทมจริง (ไม่ใช่กล่อง 220)', !!b1 && b1.id !== 220 && !!ITEM_BY_ID[b1.id]);
    // API: ซื้อกล่องลึกลับจากตลาดมืด → ได้ของ 1 ชิ้น ไม่ได้กล่องเข้าสู่กระเป๋า
    let boxVisit = null;
    for (let i = 0; i < 60 && !boxVisit; i++) {
      const v = `box-api-${i}`;
      const d = await api(`/camp?visit=${encodeURIComponent(v)}`);
      if (d.json.shop?.some((x) => x.id === 220)) boxVisit = v;
    }
    expect('box api: เจอค่ายพักที่มีกล่องลึกลับ', !!boxVisit);
    if (boxVisit) {
      const boxPrice = (await api(`/camp?visit=${encodeURIComponent(boxVisit)}`)).json.shop.find((x) => x.id === 220).price;
      const goldBefore = (await api('/state')).json.character.gold;
      const sumQty = (inv) => (inv || []).reduce((a, i) => a + i.qty, 0);
      const qtyBefore = sumQty((await api('/state')).json.inventory);
      r = await api('/shop/buy', { method: 'POST', body: { itemId: 220, visit: boxVisit } });
      const hasBox = r.json.inventory?.some((i) => i.item_id === 220);
      expect('box api: ซื้อกล่อง (ทองลด) + เปิดได้ของ (ไม่ใช่กล่องเข้าช่อง)', r.status === 200 && r.json.character.gold === goldBefore - boxPrice && !hasBox && (r.json.message || '').includes('กล่อง'), r.json.error || r.json.message);
      expect('box api: ได้ของ 1 ชิ้นเข้าสู่กระเป๋า', sumQty(r.json.inventory) === qtyBefore + 1, `before=${qtyBefore} after=${sumQty(r.json.inventory)}`);
    }

    // คราฟต์: เรียนรู้จากแบบแปลน (เหมือนสกิลจากคัมภีร์) → คราฟต์ต้องมีวัสดุ
    addItem(cid, 210, 1); // แบบแปลน: ยาบำบัดใหญ่
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 210 } });
    expect('craft: ใช้แบบแปลนเรียนรู้สูตรได้', r.status === 200 && (r.json.message || '').includes('เรียนรู้สูตร'), r.json.error || r.json.message);
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 210 } });
    expect('craft: แบบแปลนใช้ซ้ำไม่ได้ (เรียนรู้แล้ว)', r.status === 400);
    r = await api('/craft', { method: 'POST', body: { recipeId: 'rc_potion_big' } });
    expect('craft: ไม่มีวัสดุ → คราฟต์ไม่ได้', r.status === 400 && (r.json.error || '').includes('วัสดุไม่พอ'), r.json.error || '');
    addItem(cid, 122, 2); addItem(cid, 123, 2); // ขนหมาป่า x2 + เจลสไลม์ x2
    r = await api('/craft', { method: 'POST', body: { recipeId: 'rc_potion_big' } });
    expect('craft: มีวัสดุ → คราฟต์ ยาบำบัดใหญ่ ได้', r.status === 200 && r.json.inventory?.some((i) => i.item_id === 2) && (r.json.message || '').includes('ยาบำบัดใหญ่'), r.json.error || r.json.message);
    const q122 = db.prepare('SELECT qty FROM inventory WHERE character_id = ? AND item_id = 122').get(cid)?.qty || 0;
    const q123 = db.prepare('SELECT qty FROM inventory WHERE character_id = ? AND item_id = 123').get(cid)?.qty || 0;
    expect('craft: วัสดุถูกใช้ไป (ขนหมาป่า/เจลสไลม์ หมด)', q122 === 0 && q123 === 0, `122=${q122} 123=${q123}`);
    r = await api('/craft', { method: 'POST', body: { recipeId: 'rc_dragon_armor' } });
    expect('craft: สูตรที่ยังไม่เรียน → คราฟต์ไม่ได้', r.status === 400 && (r.json.error || '').includes('แบบแปลน'), r.json.error || '');

    // ถ้วยรางวัล: ชนะบอสครั้งแรกของบอสนั้น → เก็บถ้วย (ซ้ำไม่เพิ่ม)
    db.prepare("INSERT OR IGNORE INTO trophy (character_id, boss_key, icon) VALUES (?, 'หัวหน้าโจรป่า', '🏴')").run(cid);
    db.prepare("INSERT OR IGNORE INTO trophy (character_id, boss_key, icon) VALUES (?, 'หัวหน้าโจรป่า', '🏴')").run(cid);
    r = await api('/camp?visit=trophy-test');
    expect('trophy: /camp คืนรายการถ้วยรางวัล (ซ้ำไม่เพิ่ม)', r.json.trophies?.length === 1 && r.json.trophies[0].boss_key === 'หัวหน้าโจรป่า', JSON.stringify(r.json.trophies));

    // บอสเร่ร่อน: deterministic จากสัปดาห์+ตัวละคร+เมือง + generateBoss รับบอส override
    expect('wander: deterministic จากสัปดาห์+ตัวละคร+เมือง', JSON.stringify(wanderingBossAt('2026-W33', { id: cid }, 0)) === JSON.stringify(wanderingBossAt('2026-W33', { id: cid }, 0)));
    let wBoss = null;
    outer: for (let wk = 30; wk < 45; wk++) for (let ci = 0; ci < 12; ci++) { const b = wanderingBossAt(`2026-W${wk}`, { id: cid }, ci); if (b) { wBoss = b; break outer; } }
    expect('wander: เจอบอสเร่ร่อนในสัปดาห์/เมืองที่สแกน', !!wBoss && WANDERING_BOSSES.includes(wBoss));
    if (wBoss) {
      const g = generateBoss(5, 3, null, wBoss);
      expect('wander: generateBoss รับบอสเร่ร่อน (isWander + loot + ult)', g.isWander === true && g.name === wBoss.name && g.loot === wBoss.loot && !!g.ult, JSON.stringify({ name: g.name, isWander: g.isWander, loot: g.loot }));
      const g2 = generateBoss(5, 3, null, null);
      expect('wander: ไม่ override → บอสปกติ (isWander=false)', g2.isWander === false);
    }
  }

  // --- loot มอนสเตอร์ → นับ daily quest "คนเก็บขยะ" (ขาย junk เพิ่ม counter) ---
  {
    addItem(cid, 122, 1); // ขนหมาป่า (loot ของหมาป่าเถื่อน)
    const d = db.prepare("SELECT date('now','localtime') AS d").get().d;
    const before = db.prepare("SELECT value FROM daily_counter WHERE character_id = ? AND date = ? AND key = 'junk_sold'").get(cid, d)?.value || 0;
    r = await api('/shop/sell', { method: 'POST', body: { itemId: 122, qty: 1 } });
    expect('sell: ขายขนหมาป่า (loot มอนสเตอร์) ได้', r.status === 200, r.json.error || '');
    const counter = db.prepare("SELECT value FROM daily_counter WHERE character_id = ? AND date = ? AND key = 'junk_sold'").get(cid, d);
    expect('daily quest: junk_sold เพิ่ม +1 เมื่อขาย loot มอนสเตอร์', counter?.value === before + 1, `before=${before}, after=${counter?.value}`);
  }

  // --- dev test: โหมดลองเล่น — แสดงผลเหมือนจริงแต่ไม่บันทึกลง DB ---
  {
    r = await api('/dev/login', { method: 'POST', body: { user: 'admin', pass: 'admin' } });
    expect('dev login: admin/admin ได้ token', r.status === 200 && !!r.json.token);
    const token = r.json.token;
    const devPost = async (path, body) => {
      const res = await fetch(`${base}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dev-token': token }, body: JSON.stringify(body || {}) });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };
    const goldBefore = (await api('/state')).json.character.gold;
    const levelBefore = (await api('/state')).json.character.level;
    r = await devPost('/dev/gold', { amount: 5000 });
    expect('dev gold: ตอบ +5000 (ลองเล่น)', r.status === 200 && r.json.character.gold === goldBefore + 5000, r.json.error || '');
    const goldAfter = (await api('/state')).json.character.gold;
    expect('dev gold: DB ไม่บันทึก (ทองเท่าเดิม)', goldAfter === goldBefore, `before=${goldBefore}, after=${goldAfter}`);
    r = await devPost('/dev/xp', { amount: 999999 });
    expect('dev xp: แสดงเลเวลอัพเยอะ (ลองเล่น)', r.status === 200 && r.json.character.level > levelBefore);
    const stateAfter = (await api('/state')).json.character;
    expect('dev xp: DB ไม่บันทึก (เลเวลเท่าเดิม)', stateAfter.level === levelBefore, `before=${levelBefore}, after=${stateAfter.level}`);
    const devLogs = db.prepare("SELECT COUNT(*) n FROM log WHERE type = 'dev'").get().n;
    expect('dev: ไม่มี log dev เข้า DB', devLogs === 0);

    // --- dev: ปุ่มที่เรียกระบบจริงของเกม (จบ session) ก็เป็นลองเล่น — ไม่บันทึก/ไม่นับ XP ---
    const stB = await api('/state');
    const xpB = stB.json.character.xp;
    const goldB = stB.json.character.gold;
    const levelB = stB.json.character.level;
    const sessB = stB.json.progress.sessions_completed;
    const doneB = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'session_done'").get(cid).n;
    r = await devPost('/adventure/complete', { focusSec: 1500 });
    expect('dev complete: ตอบเหมือนจบ session จริง (ได้ XP/ทอง/เลเวลอัพ)', r.status === 200 && r.json.reward?.xp > 0 && r.json.character.xp > xpB, `xp=${r.json.character?.xp} (ก่อน ${xpB})`);
    const stA = await api('/state');
    expect('dev complete: DB ไม่บันทึก (XP/ทอง/เลเวลเท่าเดิม)', stA.json.character.xp === xpB && stA.json.character.gold === goldB && stA.json.character.level === levelB, `xp=${stA.json.character.xp} gold=${stA.json.character.gold} lv=${stA.json.character.level}`);
    expect('dev complete: ไม่นับ session/คอมโบใน progress', stA.json.progress.sessions_completed === sessB && stA.json.progress.streak === stB.json.progress.streak, `sessions=${stA.json.progress.sessions_completed} (ก่อน ${sessB})`);
    const doneA = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'session_done'").get(cid).n;
    expect('dev complete: ไม่มี log session_done เข้า DB', doneA === doneB, `before=${doneB} after=${doneA}`);

    // --- dev: ตัวอย่างตลาดมืด (preview ล้วน — ไม่มีผลกับเกมจริง) ---
    const bmVisit = `bm-preview-${Date.now()}`;
    r = await devPost('/dev/black-market', { visit: bmVisit });
    expect('dev bm: คืนรายการสินค้า 5 ชิ้น (preview — +กล่องลึกลับ)', r.status === 200 && Array.isArray(r.json.items) && r.json.items.length === 5 && r.json.items.some((i) => i.id === 220), JSON.stringify(r.json.items || []).slice(0, 80));
    const bmItems = r.json.items;
    expect('dev bm: 4 ชิ้นแรกมีราคาลด (bmPrice) + tag · กล่องลึกลับราคาเต็ม', bmItems.filter((i) => i.id !== 220).every((i) => i.bmPrice >= 1 && (i.bmNormal === 0 || i.bmNormal > i.bmPrice) && i.bmTag) && bmItems.find((i) => i.id === 220)?.bmNormal === bmItems.find((i) => i.id === 220)?.bmPrice, '');
    expect('dev bm: junkMult = 1.25', r.json.junkMult === 1.25, String(r.json.junkMult));
    // deterministic: เรียกซ้ำ visit เดียวกัน → ของเหมือนเดิม
    const r2 = await devPost('/dev/black-market', { visit: bmVisit });
    expect('dev bm: deterministic จาก visit (เรียกซ้ำได้ของเดิม)', JSON.stringify(r2.json.items.map((i) => i.id)) === JSON.stringify(bmItems.map((i) => i.id)), '');
    // ไม่มีผลกับเกมจริง: ค่ายพักนี้ไม่บังคับให้เจอตลาดมืด
    const campR = await api(`/camp?visit=${bmVisit}`);
    expect('dev bm: ค่ายพักจริงไม่ถูกบังคับ (ตลาดมืดยังสุ่มตามปกติ)', campR.status === 200, campR.json.error || '');
  }

  // --- โหมดท้าทาย: hard (ราคาแพง + XP/ทอง x1.5) ---
  {
    r = await api('/character/create', { method: 'POST', body: { name: 'ฮาร์ดโหมด', class: 'rogue', challengeMode: 'hard' } });
    expect('challenge: สร้างตัวละครโหมดโหดได้', r.status === 200 && r.json.character.challengeMode === 'hard', r.json.error || '');
    const hardId = r.json.character.id;
    r = await api('/character/select', { method: 'POST', body: { id: hardId } });
    // เทียบราคากับตัวละครปกติ: เปิดร้านด้วย visit เดียวกัน → ราคา hard ควรแพงกว่า (x1.3)
    // stock ร้านสุ่มต่อตัวละคร — ลองหลาย visit จนเจอชิ้นที่ขายทั้ง 2 ร้าน (กัน flaky จาก Math.random)
    r = await api('/character/create', { method: 'POST', body: { name: 'โหมดปกติ', class: 'rogue' } });
    const normId = r.json.character.id;
    let shopHard = [], shopNorm = [], shared = [];
    for (let i = 0; i < 40 && shared.length === 0; i++) {
      const sameVisit = `same-visit-price-${i}`;
      await api('/character/select', { method: 'POST', body: { id: normId } });
      const shopNormRes = await api(`/camp?visit=${sameVisit}`); // ตัวปกติ
      await api('/character/select', { method: 'POST', body: { id: hardId } });
      const shopHardRes = await api(`/camp?visit=${sameVisit}`); // ตัวโหมดโหด
      shopHard = shopHardRes.json.shop || [];
      shopNorm = shopNormRes.json.shop || [];
      // กรองของแถม (ราคา 0 — สุ่มคนละชิ้นต่อตัวละคร) ออก — เทียบราคาเฉพาะของที่ขายจริงทั้ง 2 ร้าน
      shared = shopHard.filter((i) => i.price > 0 && shopNorm.some((n) => n.id === i.id && n.price > 0));
    }
    expect('challenge: hard ราคาแพงกว่าปกติ (x1.3) — เทียบ item เดียวกัน', shared.length > 0 && shared.every((i) => { const n = shopNorm.find((x) => x.id === i.id); return i.price > n.price; }), `shared=${shared.length} hard=${shared[0]?.price} norm=${shopNorm.find((x) => x.id === shared[0]?.id)?.price}`);
    // กลับไป hard → complete session → XP/ทอง x1.5
    r = await api('/character/select', { method: 'POST', body: { id: hardId } });
    const beforeGold = (await api('/state')).json.character.gold;
    const beforeXp = (await api('/state')).json.character.xp;
    r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500 } });
    expect('challenge: hard mode ได้รางวัล x1.5 (XP/ทองเพิ่ม)', r.status === 200 && r.json.reward.xp >= 150 && r.json.reward.gold >= 37, `xp=${r.json.reward?.xp} gold=${r.json.reward?.gold}`);
  }

  // --- โหมดท้าทาย: marathon (พักกลาง session = เสีย session) ---
  {
    r = await api('/character/create', { method: 'POST', body: { name: 'มาราธอน', class: 'cleric', challengeMode: 'marathon' } });
    const mId = r.json.character.id;
    r = await api('/character/select', { method: 'POST', body: { id: mId } });
    const xpBefore = (await api('/state')).json.character.xp;
    r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 300 } }); // โฟกัสแค่ 5 นาที (ควร 25)
    expect('challenge: marathon โฟกัสไม่ครบ (พัก) → เสีย session', r.status === 200 && r.json.failed === true && r.json.reward === undefined, JSON.stringify(r.json.reward));
    const xpAfter = (await api('/state')).json.character.xp;
    expect('challenge: marathon เสีย session → ไม่ได้ XP', xpAfter === xpBefore, `before=${xpBefore} after=${xpAfter}`);
    r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 2400 } }); // work_min 40 นาที (settings ถูกตั้งจากเทสต์ก่อน) → 2400 ≥ 90%×2400
    expect('challenge: marathon โฟกัสครบ → session ปกติ (x1.5)', r.status === 200 && !r.json.failed && r.json.reward?.xp >= 150, `status=${r.status} err=${r.json.error || ''} xp=${r.json.reward?.xp}`);
  }

  // --- โหมดท้าทาย: survival (พักแคมป์ไม่ฟรี + HP ต่ำ = เสียของ) ---
  {
    r = await api('/character/create', { method: 'POST', body: { name: 'เซอร์ไววัล', class: 'warrior', challengeMode: 'survival' } });
    const sId = r.json.character.id;
    r = await api('/character/select', { method: 'POST', body: { id: sId } });
    r = await api('/camp/rest', { method: 'POST' });
    expect('challenge: survival พักแคมป์ไม่ฟรี (ถูก reject)', r.status === 400 && r.json.error.includes('เอาชีวิตรอด'), r.json.error || '');
    // ใส่ไอเทม + ตั้ง HP = 1 แล้วจบ session → เสียของสุ่ม
    addItem(sId, 122, 1); // ขนหมาป่า
    const invBefore = (await api('/state')).json.inventory.find((i) => i.item_id === 122)?.qty || 0;
    db.prepare('UPDATE character SET hp = 1 WHERE id = ?').run(sId);
    r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500 } });
    expect('challenge: survival HP=1 จบ session → มี survivalFall (เสียของ)', r.status === 200 && !!r.json.survivalFall, r.json.survivalFall || '');
    const invAfter = (await api('/state')).json.inventory.find((i) => i.item_id === 122)?.qty || 0;
    expect('challenge: survival ของในกระเป๋าลดลง (เสียของสุ่ม)', invAfter < invBefore, `before=${invBefore} after=${invAfter}`);
  }

  // --- เปลี่ยนโหมดท้าทายระหว่างเล่น (เสียค่าปรับทอง + คอมโบรีเซ็ต) ---
  {
    r = await api('/character/create', { method: 'POST', body: { name: 'สลับโหมด', class: 'warrior' } });
    const swId = r.json.character.id;
    r = await api('/character/select', { method: 'POST', body: { id: swId } });
    // ทำ session ครบให้มีคอมโบ
    await api('/adventure/complete', { method: 'POST', body: { focusSec: 2400 } });
    const stateBefore = await api('/state');
    const goldBefore = stateBefore.json.character.gold;
    const streakBefore = stateBefore.json.progress.streak;
    const cost = 50 + 30 * stateBefore.json.character.level; // Lv.1 → 80
    r = await api('/character/challenge', { method: 'POST', body: { mode: 'hard' } });
    expect('challenge-switch: เปลี่ยนเป็น hard ได้', r.status === 200 && r.json.character.challengeMode === 'hard', r.json.error || '');
    const goldAfter = (await api('/state')).json.character.gold;
    expect('challenge-switch: เสียค่าปรับทอง (50+30×เลเวล)', goldAfter === goldBefore - cost, `before=${goldBefore} after=${goldAfter} cost=${cost}`);
    const streakAfter = (await api('/state')).json.progress.streak;
    expect('challenge-switch: คอมโบรีเซ็ตเป็น 0', streakBefore > 0 && streakAfter === 0, `before=${streakBefore} after=${streakAfter}`);
    r = await api('/character/challenge', { method: 'POST', body: { mode: 'hard' } });
    expect('challenge-switch: เปลี่ยนเป็นโหมดเดิม → reject', r.status === 400, r.json.error || '');
    r = await api('/character/challenge', { method: 'POST', body: { mode: 'xx' } });
    expect('challenge-switch: โหมดไม่ถูกต้อง → reject', r.status === 400, r.json.error || '');
    // เติมทองให้พอค่าปรับ (เปลี่ยนอีกครั้ง)
    db.prepare('UPDATE character SET gold = 500 WHERE id = ?').run(swId);
    r = await api('/character/challenge', { method: 'POST', body: { mode: 'survival' } });
    expect('challenge-switch: เปลี่ยนโหมดซ้ำได้ (เสียค่าปรับอีก)', r.status === 200 && r.json.character.challengeMode === 'survival', r.json.error || '');
    // กลับเป็นปกติ — reset ตอนท้ายเทสต์
    await api('/character/challenge', { method: 'POST', body: { mode: '' } });
  }

  // --- ตั้งชื่องาน (focus task) + สถิติแยกตามงาน ---
  {
    const aid = (await api('/state')).json.character.id;
    r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500, focusTask: 'งานทดสอบ' } });
    expect('focusTask: จบ session พร้อมชื่องานได้', r.status === 200, r.json.error || '');
    const ft = db.prepare("SELECT focus_task FROM log WHERE character_id = ? AND type = 'session_done' ORDER BY id DESC LIMIT 1").get(aid);
    expect('focusTask: บันทึกชื่องานใน log session_done', ft?.focus_task === 'งานทดสอบ', JSON.stringify(ft));
    r = await api('/stats');
    const myTask = (r.json.tasks || []).find((t) => t.task === 'งานทดสอบ');
    expect('focusTask: สถิติแยกตามงานมีรายการ', !!myTask && myTask.sessions >= 1, JSON.stringify(r.json.tasks));
  }

  // --- 🛡️ โล่โฟกัส — ใช้แล้วกันคอมโบหาย 1 ครั้ง ---
  {
    const aid = (await api('/state')).json.character.id;
    await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500 } }); // ให้มีคอมโบ
    const streakBefore = (await api('/state')).json.progress.streak;
    db.prepare('INSERT INTO inventory (character_id, item_id, qty) VALUES (?, 150, 1) ON CONFLICT(character_id, item_id) DO UPDATE SET qty = qty + 1').run(aid);
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 150 } });
    expect('shield: ใช้โล่โฟกัสได้', r.status === 200, r.json.error || '');
    expect('shield: progress.combo_shield = 1', (await api('/state')).json.progress.combo_shield === 1, JSON.stringify((await api('/state')).json.progress.combo_shield));
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 150 } });
    expect('shield: ใช้ซ้ำตอนติดตั้งแล้ว → reject', r.status === 400, r.json.error || '');
    r = await api('/adventure/abort', { method: 'POST' });
    expect('shield: ทิ้ง session → โล่กันคอมโบ (shieldUsed)', r.status === 200 && r.json.shieldUsed === true, JSON.stringify(r.json));
    const st = await api('/state');
    expect('shield: คอมโบไม่หาย (streak เท่าเดิม) + โล่แตก', st.json.progress.streak === streakBefore && st.json.progress.combo_shield === 0, `streak=${st.json.progress.streak} shield=${st.json.progress.combo_shield}`);
  }

  // --- 💨 ทิ้ง session พร้อมเหตุผล — บันทึกสถิติ + ดูย้อนหลัง ---
  {
    const aid = (await api('/state')).json.character.id;
    await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500 } }); // ให้มีคอมโบ (แล้วทิ้งจะได้ streak 0)
    r = await api('/adventure/abort', { method: 'POST', body: { reason: '📞 รับสาย/ธุระด่วน', focusSec: 600 } });
    expect('abort: ทิ้ง session พร้อมเหตุผลได้', r.status === 200, r.json.error || '');
    const al = db.prepare("SELECT abort_reason, focus_sec, detail FROM log WHERE character_id = ? AND type = 'abort' ORDER BY id DESC LIMIT 1").get(aid);
    expect('abort: บันทึกเหตุผล + เวลาที่โฟกัสไปใน log', al?.abort_reason === '📞 รับสาย/ธุระด่วน' && al?.focus_sec === 600 && (al?.detail || '').includes('📞 รับสาย/ธุระด่วน'), JSON.stringify(al));
    r = await api('/stats');
    const myAb = (r.json.abortReasons || []).find((x) => x.reason === '📞 รับสาย/ธุระด่วน');
    expect('abort: สถิติแยกตามเหตุผลมีรายการ (30 วัน)', !!myAb && myAb.times >= 1, JSON.stringify(r.json.abortReasons));
    expect('abort: stats นับ session ที่ทิ้งรวม', (r.json.abortsTotal || 0) >= 2, `abortsTotal=${r.json.abortsTotal}`);
    // ทิ้ง session แยกตามช่วงเวลา — abort ทุกตัวต้องจัดลงช่วงใดช่วงหนึ่ง (เช้า/กลางวัน/เย็น/ดึก) + จำนวนรวมตรงกับ abortsTotal
    const periodSum = (r.json.abortByPeriod || []).reduce((a, p) => a + p.times, 0);
    const validPeriods = ['เช้า', 'กลางวัน', 'เย็น', 'ดึก'];
    expect('abort: สถิติแยกตามช่วงเวลามีรายการ (30 วัน)', (r.json.abortByPeriod || []).length > 0 && (r.json.abortByPeriod || []).every((p) => validPeriods.includes(p.period) && p.times >= 1), JSON.stringify(r.json.abortByPeriod));
    expect('abort: จำนวนรวมตามช่วงเวลา = session ที่ทิ้งรวม', periodSum === (r.json.abortsTotal || 0), `periodSum=${periodSum} abortsTotal=${r.json.abortsTotal}`);
    // ทิ้ง session แยกตามวัน (จ-อา) — dow 0-6 (อาทิตย์=0) · รวมทุกวันต้องเท่ากับยอดรวม
    const dowSum = (r.json.abortByWeekday || []).reduce((a, d) => a + d.times, 0);
    expect('abort: สถิติแยกตามวันมีรายการ (30 วัน)', (r.json.abortByWeekday || []).length > 0 && (r.json.abortByWeekday || []).every((d) => d.dow >= 0 && d.dow <= 6 && d.times >= 1), JSON.stringify(r.json.abortByWeekday));
    expect('abort: จำนวนรวมตามวัน = session ที่ทิ้งรวม', dowSum === (r.json.abortsTotal || 0), `dowSum=${dowSum} abortsTotal=${r.json.abortsTotal}`);
    // เตือนเมื่อทิ้งบ่อยเกิน: /state + /stats ส่ง abortsThisWeek + abortWeekLimit
    const st = await api('/state');
    expect('abort: /state ส่ง abortsThisWeek + เกณฑ์เตือน (settings)', (st.json.abortsThisWeek || 0) >= 1 && (st.json.settings?.abort_week_limit ?? 3) >= 1, `thisWeek=${st.json.abortsThisWeek} limit=${st.json.settings?.abort_week_limit}`);
    expect('abort: /stats ส่ง abortsThisWeek + เกณฑ์เตือนตรงกัน', (r.json.abortsThisWeek || 0) === (st.json.abortsThisWeek || 0) && (r.json.settings?.abort_week_limit ?? 3) === (st.json.settings?.abort_week_limit ?? 3), JSON.stringify({ stats: r.json.abortsThisWeek, state: st.json.abortsThisWeek, limit: r.json.settings?.abort_week_limit }));
    // ทิ้งเพิ่มจนเกินเกณฑ์ → response บอก abortsThisWeek อัปเดตทันที
    const before = (st.json.abortsThisWeek || 0);
    const need = Math.max(0, ((st.json.settings?.abort_week_limit ?? 3)) - before + 1);
    for (let i = 0; i < need; i++) await api('/adventure/abort', { method: 'POST', body: { reason: '📱 เผลอไปอย่างอื่น' } });
    const after = await api('/state');
    expect('abort: ทิ้งเกินเกณฑ์ → abortsThisWeek อัปเดตเกินเกณฑ์', (after.json.abortsThisWeek || 0) >= (after.json.settings?.abort_week_limit ?? 3), `thisWeek=${after.json.abortsThisWeek} limit=${after.json.settings?.abort_week_limit}`);
    // ตั้งเกณฑ์เตือนเองได้ (หน้า Settings) — 0 = ปิดเตือน · clamp 0-20
    r = await api('/settings', { method: 'PUT', body: { abort_week_limit: 5 } });
    expect('abort: ตั้งเกณฑ์เตือนเองได้ (5)', r.status === 200 && r.json.settings.abort_week_limit === 5, JSON.stringify(r.json.settings));
    r = await api('/settings', { method: 'PUT', body: { abort_week_limit: 99 } });
    expect('abort: เกณฑ์เกิน 20 → clamp 20', r.json.settings.abort_week_limit === 20, JSON.stringify(r.json.settings));
    r = await api('/settings', { method: 'PUT', body: { abort_week_limit: -1 } });
    expect('abort: เกณฑ์ติดลบ → clamp 0 (ปิดเตือน)', r.json.settings.abort_week_limit === 0, JSON.stringify(r.json.settings));
    r = await api('/settings', { method: 'PUT', body: { abort_week_limit: 3 } });
    expect('abort: คืนเกณฑ์เป็นค่าเริ่มต้น (3)', r.json.settings.abort_week_limit === 3, JSON.stringify(r.json.settings));
  }

  // --- 📖 เควสต์เนื้อเรื่อง (story quest) ---
  {
    const aid = (await api('/state')).json.character.id;
    r = await api('/story');
    expect('story: คืนเควสต์ครบ 12 (พร้อม status/reqLabel)', r.status === 200 && r.json.quests?.length === 12 && r.json.quests.every((q) => q.status && q.reqLabel), JSON.stringify(r.json.quests?.length));
    db.prepare('UPDATE progress SET bosses_defeated = 1 WHERE character_id = ?').run(aid); // ปลดล็อกเควสต์แรก
    r = await api('/story');
    expect('story: ชนะบอส 1 → เควสต์แรกปลดล็อก (claimable)', r.json.quests[0].status === 'claimable', r.json.quests[0].status);
    const goldBefore = (await api('/state')).json.character.gold;
    r = await api('/story/claim', { method: 'POST', body: { questId: 'sq_0' } });
    expect('story: รับรางวัลได้ (+ทอง)', r.status === 200 && r.json.character.gold > goldBefore, `${r.json.error || ''} gold=${r.json.character?.gold}`);
    r = await api('/story/claim', { method: 'POST', body: { questId: 'sq_0' } });
    expect('story: รับรางวัลซ้ำไม่ได้', r.status === 400, r.json.error || '');
    r = await api('/story/claim', { method: 'POST', body: { questId: 'sq_1' } });
    expect('story: เควสต์ที่ยังไม่ปลดล็อก → reject', r.status === 400, r.json.error || '');
  }

  // --- 🔥 ชาเลนจ์รายสัปดาห์ (async) ---
  {
    const aid = (await api('/state')).json.character.id;
    await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500 } });
    r = await api('/challenge/progress');
    const p = r.json;
    expect('challenge: คืนข้อมูลโครงสร้างครบ (weekStart/End, days 7, prevWeeks 8)',
      r.status === 200 && !!p.weekStart && !!p.weekEnd && p.days?.length === 7 && p.prevWeeks?.length === 8,
      JSON.stringify({ weekStart: p.weekStart, days: p.days?.length, prev: p.prevWeeks?.length }));
    expect('challenge: นับ session + นาทีโฟกัสของสัปดาห์นี้ได้', p.sessions >= 1 && p.focusSec >= 1500, JSON.stringify({ sessions: p.sessions, focusSec: p.focusSec }));
    expect('challenge: 7 วันเรียงตามสัปดาห์ (จ-อา) มีค่าไม่ติดลบ', p.days.every((d) => d.weekday && d.sessions >= 0 && d.focusSec >= 0), JSON.stringify(p.days));
  }

  // --- 🎁 ของขวัญจ้าวมังกรทอง: เปิดที่ค่าย (ใช้จากกระเป๋า) → สุ่มรางวัลพิเศษ (🏆/💛/👑 หรือ +250 ทอง) ---
  {
    const gid = (await api('/state')).json.character.id;
    let ok = 0, bad = 0;
    for (let i = 0; i < 25; i++) {
      addItem(gid, 193, 1);
      const before = (await api('/state')).json.character.gold;
      r = await api('/inventory/use', { method: 'POST', body: { itemId: 193 } });
      const inv = r.json.inventory || [];
      const after = (await api('/state')).json.character.gold;
      const gotItem = inv.some((x) => [190, 191, 192].includes(x.item_id));
      const gotGold = after >= before + 250;
      if (r.status === 200 && (gotItem || gotGold) && (r.json.message || '').includes('🎁')) ok++;
      else bad++;
    }
    expect('gift: เปิดของขวัญทุกครั้งได้รางวัลถูกต้อง (🏆/💛/👑 หรือ +250 ทอง)', ok === 25 && bad === 0, `ok=${ok} bad=${bad}`);
    // เปิดแล้ว 🎁 หายจากกระเป๋า
    addItem(gid, 193, 1);
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 193 } });
    const inv2 = r.json.inventory || [];
    expect('gift: เปิดแล้ว 🎁 หายจากกระเป๋า', r.status === 200 && !inv2.some((x) => x.item_id === 193), JSON.stringify(inv2.map((x) => x.item_id)));
  }

  // --- 🐾 ระบบสัตว์เลี้ยง: ใช้ไข่ = เริ่มฟัก (รอจบ 1 session) / บัตรขยายคอก / สลับ / ปล่อย ---
  {
    const petCid = (await api('/state')).json.character.id;
    // เริ่ม: ยังไม่มี pet, คอก 1 ช่อง
    r = await api('/state');
    expect('pet: เริ่มต้นมีคอก 1 ช่อง ไม่มีสัตว์เลี้ยง', r.json.character.petSlots === 1 && r.json.character.pets.length === 0, JSON.stringify(r.json.character.pets));
    // ใช้ไข่ → เริ่มฟัก (ยังไม่ฟักทันที — รอจบ 1 session) + ป้าย hatchPending
    addItem(petCid, 170, 1);
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 170 } });
    expect('pet: ใช้ไข่ → เริ่มฟัก (hatchPending, ยังไม่มี pet)', r.status === 200 && r.json.character.hatchPending === true && r.json.character.pets.length === 0, r.json.message || r.json.error);
    // ใช้ไข่ใบที่ 2 ตอนกำลังฟัก → บล็อก
    addItem(petCid, 170, 1);
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 170 } });
    expect('pet: มีไข่กำลังฟัก → ใช้ใบใหม่ไม่ได้', r.status === 400 && r.json.error.includes('กำลังฟัก'), r.json.error || '');
    // จบ 1 session → ไข่ฟัก ได้ pet + active อัตโนมัติ
    r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500, events: [] } });
    expect('pet: จบ session → ไข่ฟักได้ pet + active', r.status === 200 && r.json.hatch && !r.json.hatch.dup && r.json.character.pets.length === 1 && r.json.character.pets[0].active === true,
      r.json.message || r.json.error || JSON.stringify(r.json.hatch));
    const petId = r.json.character.pets[0].id;
    expect('pet: serialize มีค่าพิเศษ + เลเวล + XP', !!r.json.character.pets[0].desc && r.json.character.pets[0].level === 1 && r.json.character.pets[0].xpNext > 0, JSON.stringify(r.json.character.pets[0]));
    expect('pet: ฟักแล้ว hatchPending กลับเป็น false', r.json.character.hatchPending === false, String(r.json.character.hatchPending));
    // คอกเต็ม 1/1 → ใช้ไข่ฟองใหม่ไม่ได้ (เช็คตอนเริ่มฟัก)
    addItem(petCid, 170, 1);
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 170 } });
    expect('pet: คอกเต็ม → ใช้ไข่ไม่ได้', r.status === 400 && r.json.error.includes('คอก'), r.json.error || '');
    // บัตรขยายคอก → 2 ช่อง
    addItem(petCid, 171, 1);
    r = await api('/inventory/use', { method: 'POST', body: { itemId: 171 } });
    expect('pet: บัตรขยายคอก → 2/4 ช่อง', r.status === 200 && r.json.character.petSlots === 2, r.json.message || r.json.error);
    // ฟักไข่ฟองที่ 2 (ใช้ไข่ → จบ session) — อาจฟักเจอตัวเดิม (ค่าปลอบใจ) หรือตัวใหม่ — ลองจนได้ตัวใหม่
    let hatched2 = false;
    for (let attempt = 0; attempt < 10 && !hatched2; attempt++) {
      addItem(petCid, 170, 1);
      r = await api('/inventory/use', { method: 'POST', body: { itemId: 170 } });
      r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500, events: [] } });
      hatched2 = r.status === 200 && r.json.character.pets.length === 2;
    }
    expect('pet: ฟักไข่ฟองที่ 2 สำเร็จ (2/2)', hatched2, r.json.message || r.json.error || JSON.stringify(r.json.hatch));
    // สลับตัวที่ใช้งาน
    const other = r.json.character.pets.find((p) => p.id !== petId);
    r = await api('/pet/swap', { method: 'POST', body: { petId: other.id } });
    expect('pet: สลับตัวที่ใช้งานได้', r.status === 200 && r.json.character.pets.find((p) => p.id === other.id).active === true && r.json.character.pets.find((p) => p.id === petId).active === false, r.json.message || r.json.error);
    // ปล่อย pet → ได้ทองปลอบใจ + ช่องว่าง
    const goldBefore = r.json.character.gold;
    r = await api('/pet/release', { method: 'POST', body: { petId: petId } });
    expect('pet: ปล่อย pet → ทองปลอบใจ + เหลือ 1 ตัว', r.status === 200 && r.json.character.pets.length === 1 && r.json.character.gold > goldBefore, r.json.message || r.json.error);
    // event → pet ได้ XP
    r = await api('/adventure/event', { method: 'POST', body: { key: 'treasure' } });
    expect('pet: event → pet สะสม XP', r.status === 200 && r.json.character.pets[0].xp > 0, JSON.stringify(r.json.character.pets));
    // adventure complete → pet ได้ XP จากโฟกัส
    r = await api('/adventure/complete', { method: 'POST', body: { focusSec: 1500, events: [] } });
    expect('pet: โฟกัส → pet สะสม XP (25 นาที = 25 XP)', r.status === 200 && r.json.character.pets[0].xp >= 25, JSON.stringify(r.json.character.pets[0]));
  }

  // --- 🎭 จุดเด่น/จุดด้อยคลาสตามช่วงเวลา ☀️/🌙 (เปิดค่าพิเศษคลาส — บังคับเวลาผ่าน POMOQUEST_HOUR) ---
  {
    const { classPerks, rollMonster } = await import('../server/game.js');
    const origPerks = process.env.POMOQUEST_CLASS_PERKS;
    const origHour = process.env.POMOQUEST_HOUR;
    process.env.POMOQUEST_CLASS_PERKS = '1';
    // ☀️ กลางวัน 12:00
    process.env.POMOQUEST_HOUR = '12';
    let cp = classPerks({ class: 'warrior' });
    expect('perk: นักรบ ☀️ มอนสเตอร์อ่อนลง 15% + เจอถี่ขึ้น x1.15 + ตีบอส +10% (สกิล event 1x)', cp.monster === 0.85 && cp.monsterW === 1.15 && cp.bossAtk === 1.1 && cp.skillUse === 1 && cp.night === false, JSON.stringify(cp));
    cp = classPerks({ class: 'mage' });
    expect('perk: เวทย์ ☀️ XP -10% + ตีบอส -10% (จุดด้อย) + สกิล event 2.5x', cp.xp === 0.9 && cp.bossAtk === 0.9 && cp.skillUse === 2.5, JSON.stringify(cp));
    cp = classPerks({ class: 'rogue' });
    expect('perk: โจร ☀️ ไม่มีค่าพิเศษ (ช่วงปกติ)', cp.gold === 1 && cp.active === null, JSON.stringify(cp));
    // 🌙 กลางคืน 22:00
    process.env.POMOQUEST_HOUR = '22';
    cp = classPerks({ class: 'rogue' });
    expect('perk: โจร 🌙 ทอง +30% + สมบัติ x1.25 + กับดัก x1.3 + ตีบอส +10%', cp.gold === 1.3 && cp.treasure === 1.25 && cp.trap === 1.3 && cp.bossAtk === 1.1 && cp.night === true, JSON.stringify(cp));
    cp = classPerks({ class: 'mage' });
    expect('perk: เวทย์ 🌙 XP +25% + ตีบอส +10% (จุดเด่น) + สกิล event 2.5x', cp.xp === 1.25 && cp.bossAtk === 1.1 && cp.skillUse === 2.5, JSON.stringify(cp));
    cp = classPerks({ class: 'cleric' });
    expect('perk: นักบวช 🌙 มอนสเตอร์แข็งขึ้น 10% (จุดด้อย)', cp.monster === 1.1, JSON.stringify(cp));
    // rollMonster: นักรบกลางคืนพลังมอนสเตอร์สูงกว่ากลางวัน (สุ่มตัวเดียวกัน x0.5)
    const realRandom = Math.random;
    Math.random = () => 0.5;
    process.env.POMOQUEST_HOUR = '12';
    const dayPower = rollMonster(5, { class: 'warrior' }).power;
    process.env.POMOQUEST_HOUR = '22';
    const nightPower = rollMonster(5, { class: 'warrior' }).power;
    Math.random = realRandom;
    expect('perk: นักรบ 🌙 มอนสเตอร์พลังสูงกว่า ☀️ (x1.35)', nightPower >= Math.round(dayPower * 1.3), `day=${dayPower} night=${nightPower}`);
    // API: /state ส่ง classPerk + event กลางคืนได้โบนัสทอง 🌙
    process.env.POMOQUEST_HOUR = '22';
    r = await api('/character/create', { method: 'POST', body: { name: 'โจรราตรี', class: 'rogue' } });
    expect('perk: /state ส่ง classPerk (โจร 🌙 ทอง x1.3 + ข้อความ)', r.status === 200 && r.json.character.classPerk?.gold === 1.3 && r.json.character.classPerk?.night === true && r.json.character.classPerk?.active?.text.includes('🌙'), JSON.stringify(r.json.character.classPerk));
    r = await api('/adventure/event', { method: 'POST', body: { key: 'treasure' } });
    expect('perk: โจร 🌙 กล่องสมบัติได้โบนัสทอง (+30%)', r.status === 200 && (r.json.event.detail || '').includes('🌙 🗡️ +'), (r.json.event.detail || '').slice(0, 60));
    process.env.POMOQUEST_CLASS_PERKS = origPerks;
    process.env.POMOQUEST_HOUR = origHour;
  }

  // --- 🎒 ระบบกระเป๋า: ลิมิต 20 ช่อง + ของรางวัลขายอัตโนมัติ + บล็อกซื้อ/คราฟต์ ---
  {
    const bcid = (await api('/state')).json.character.id;
    db.prepare('DELETE FROM inventory WHERE character_id = ?').run(bcid); // ล้างกระเป๋าเก่า (ตัวละครนี้ผ่านเทสต์อื่นมาแล้ว)
    r = await api('/state');
    expect('bag: เริ่มต้น 20 ช่อง ใช้ 0', r.json.character.bagSize === 20 && r.json.character.bagUsed === 0,
      `${r.json.character.bagUsed}/${r.json.character.bagSize}`);
    // เติม 20 ชนิด (ไอเทมซ้ำรวมกอง ไม่กินช่องเพิ่ม)
    const fillIds = [1, 3, 4, 5, 6, 7, 10, 12, 14, 15, 20, 21, 30, 31, 45, 46, 47, 48, 49, 150];
    for (const id of fillIds) addItem(bcid, id, 1);
    r = await api('/state');
    expect('bag: เติม 20 ชนิด → ใช้ 20/20', r.json.character.bagUsed === 20, `${r.json.character.bagUsed}/${r.json.character.bagSize}`);
    // ของซ้ำ (ชนิดเดิม) → รวมกอง ไม่เกินลิมิต
    addItem(bcid, 1, 5);
    r = await api('/state');
    expect('bag: ไอเทมซ้ำรวมกอง ไม่กินช่องเพิ่ม', r.json.character.bagUsed === 20, `${r.json.character.bagUsed}/${r.json.character.bagSize}`);
    // 🔄 สลับของในกระเป๋าเป็นชนิดที่พ่อค้าไม่แจก (COMMON_LOOT ถูกถอดออกทั้งหมด) — ทำให้ของแถมจากพ่อค้า
    // เป็นของชนิดใหม่เสมอ → ขายอัตโนมัติแบบ deterministic (เดิมพึ่งดวง 10% ของขวัญหายาก = เทสต์เด้งบ่อย)
    // ไม่เอา 23 (เกราะมังกร) — เป็นผลลัพธ์คราฟต์ที่เทสต์ถัดไปต้องบล็อก
    const refillIds = [2, 11, 13, 16, 22, 51, 61, 62, 71, 81];
    db.prepare('DELETE FROM inventory WHERE character_id = ? AND item_id IN (1,3,5,6,7,45,46,47,48,49)').run(bcid);
    for (const id of refillIds) addItem(bcid, id, 1);
    r = await api('/state');
    expect('bag: สลับเป็นของที่ไม่ใช่ของแถมพ่อค้า → ยังเต็ม 20/20', r.json.character.bagUsed === 20, `${r.json.character.bagUsed}/${r.json.character.bagSize}`);
    // ของรางวัลจาก event (ของชนิดใหม่) → ขายอัตโนมัติราคาพื้นฐานเมื่อเต็ม (ของแถมพ่อค้า = ชนิดใหม่เสมอ → ขายแน่นอน)
    let sold = null;
    for (let i = 0; i < 30 && !sold; i++) {
      r = await api('/adventure/event', { method: 'POST', body: { key: 'merchant' } });
      if (r.json.event?.item && r.json.event?.detail?.includes('ขาย')) sold = r.json;
    }
    // ของแถมราคา 0 เข้ากระเป๋าได้เสมอ (by design) → bagUsed อาจเป็น 21 — สิ่งที่ต้องตรวจคือขายอัตโนมัติเกิดขึ้น
    expect('bag: ของรางวัลเต็ม → ขายอัตโนมัติราคาพื้นฐาน + ทองเพิ่ม', !!sold && sold.event.detail.includes('กระเป๋าเต็ม') && sold.character.bagUsed >= 20,
      sold?.event?.detail?.slice(0, 90) || 'no auto-sell');
    // ซื้อของที่ยังไม่มีในร้าน → บล็อก
    let target = null, bvisit = null;
    for (let v = 1; v <= 10 && !target; v++) {
      bvisit = `bag-buy-${v}`;
      r = await api(`/camp?visit=${bvisit}`);
      target = (r.json.shop || []).filter((s) => !s.bm).find((s) => !fillIds.includes(s.id) && !refillIds.includes(s.id));
    }
    db.prepare('UPDATE character SET gold = 5000 WHERE id = ?').run(bcid);
    r = await api('/shop/buy', { method: 'POST', body: { itemId: target.id, visit: bvisit } });
    expect('bag: กระเป๋าเต็ม → ซื้อไม่ได้ (บล็อก)', r.status === 400 && r.json.error.includes('กระเป๋าเต็ม'), r.json.error || '');
    // คราฟต์ของที่ยังไม่มี → บล็อก
    db.prepare("INSERT OR IGNORE INTO character_recipe (character_id, recipe_id) VALUES (?, 'rc_dragon_armor')").run(bcid);
    addItem(bcid, 127, 3); addItem(bcid, 125, 2); // เกล็ดมังกร x3 + ไม้กวาดแม่มด x2 (วัสดุ — ชนิดที่ยังไม่มี)
    r = await api('/craft', { method: 'POST', body: { recipeId: 'rc_dragon_armor' } });
    expect('bag: กระเป๋าเต็ม → คราฟต์ไม่ได้ (บล็อก)', r.status === 400 && r.json.error.includes('กระเป๋าเต็ม'), r.json.error || '');
  }

  // --- export/backup ---
  const backupRes = await fetch(`${base}/api/backup`);
  const buf = Buffer.from(await backupRes.arrayBuffer());
  expect('backup: เป็นไฟล์ SQLite จริง', backupRes.status === 200 && buf.subarray(0, 15).toString() === 'SQLite format 3', `${buf.length} bytes`);

  // --- restore: ไฟล์ขยะ → reject ---
  const junkRes = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('not a database at all') });
  const junk = await junkRes.json().catch(() => ({}));
  expect('restore: ไฟล์ขยะถูก reject', junkRes.status === 400 && !!junk.error, junk.error || '');

  // --- reset: ล้างทันที ---
  r = await api('/reset', { method: 'POST' });
  r = await api('/state');
  expect('reset: ล้างข้อมูลหมด → ไม่มีตัวละคร', r.status === 200 && r.json.hasCharacter === false);
} finally {
  server.close();
  db.close();
}

console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
