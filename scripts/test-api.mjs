// ทดสอบ API routes แบบ end-to-end — รัน server ชั่วคราวที่ port สุ่ม + DB แยก (ไม่แตะของจริง)
process.env.POMOQUEST_DB = `/tmp/pq-test-api-${Date.now()}.db`;

const express = (await import('express')).default;
const routes = (await import('../server/routes.js')).default;
const devRoutes = (await import('../server/dev.js')).default;
const { db, addItem } = await import('../server/db.js');
const { equipBlockReason } = await import('../server/game.js');
const { ITEM_BY_ID } = await import('../server/data.js');

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
    body: { focusSec: 1500, sessionIdx: 1, sessionsPerCycle: 4, sessionKey: 'api-test-key', events: [{ logType: 'battle_win', title: 'ชนะ', detail: 'กำราบ หมาป่า ได้สำเร็จ!', xp: 24, gold: 14 }] },
  });
  expect('complete: จบ session สำเร็จ (ได้ XP/ทอง)', r.status === 200 && r.json.character.xp > 0 && r.json.character.gold > 0, r.json.error || '');
  const done = db.prepare("SELECT COUNT(*) n FROM log WHERE character_id = ? AND type = 'session_done'").get(cid);
  expect('complete: มี log session_done 1 อัน', done.n === 1);
  const summ = db.prepare("SELECT * FROM log WHERE character_id = ? AND type = 'session_summary'").get(cid);
  expect('complete: มี session summary (พร้อม session_key)', !!summ && summ.session_key === 'api-test-key');

  // --- /session-history ---
  r = await api('/session-history');
  expect('session-history: คืน session ที่จบไป (มี session_key)', r.status === 200 && r.json.sessions?.length === 1 && r.json.sessions[0].session_key === 'api-test-key');

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
