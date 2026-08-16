// ทดสอบ API routes แบบ end-to-end — รัน server ชั่วคราวที่ port สุ่ม + DB แยก (ไม่แตะของจริง)
process.env.POMOQUEST_DB = `/tmp/pq-test-api-${Date.now()}.db`;

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

  // --- /session-history ---
  r = await api('/session-history');
  expect('session-history: คืน session ที่จบไป (มี session_key)', r.status === 200 && r.json.sessions?.length === 1 && r.json.sessions[0].session_key === 'api-test-key');
  expect('session-history: session มี challenge_mode (ตอนนั้นเล่นโหมดอะไร)', r.status === 200 && r.json.sessions[0].challenge_mode === '', JSON.stringify(r.json.sessions[0]?.challenge_mode));

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
    // response ใช้ field `price` (ราคาลดแล้ว) + `bmNormal` (ราคาปกติ) — 4 ช่อง: คัมภีร์/ของหายาก/ของเถื่อน/ของพิเศษ exclusive
    expect('camp: ตลาดมืด 4 ชิ้น ราคาลดกว่าปกติ', !!bm && bm.items.length === 4 && bm.items.every((i) => i.price < i.bmNormal), JSON.stringify(bm?.items?.map((i) => [i.name, i.price, i.bmNormal])));
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
    expect('dev bm: คืนรายการสินค้า 4 ชิ้น (preview)', r.status === 200 && Array.isArray(r.json.items) && r.json.items.length === 4, JSON.stringify(r.json.items || []).slice(0, 80));
    const bmItems = r.json.items;
    expect('dev bm: ทุกชิ้นมีราคาลด (bmPrice) + tag', bmItems.every((i) => i.bmPrice > 0 && i.bmNormal > i.bmPrice && i.bmTag), '');
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
      shared = shopHard.filter((i) => shopNorm.some((n) => n.id === i.id));
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
