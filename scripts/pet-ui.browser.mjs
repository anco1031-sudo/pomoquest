// ตรวจสอบ UI ระบบสัตว์เลี้ยง: ฟอง pet บน Home (ไข่/ตัวที่ active) + คอกสัตว์ใน CharacterSheet
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const db = new Database(process.env.POMOQUEST_DB || './server/data/pomoquest.db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const expect = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9332', '--user-data-dir=/tmp/pq-chrome-pet2', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
for (let i = 0; i < 30 && !ws; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9332/json');
    const list = await res.json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
        setTimeout(resolve, 3000);
      });
    }
  } catch { /* retry */ }
}
if (!ws) { console.log('❌ chrome ไม่ขึ้น'); chrome.kill(); process.exit(1); }

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
await sleep(3500);

// Home: มีฟอง pet (🥚 ถ้ายังไม่มี หรือ pet ที่ active)
const bubble = await evalJs(`document.querySelector('.companion-bubble')?.textContent?.trim() || ''`);
expect('Home: มีฟองสัตว์เลี้ยง (🥚/pet)', bubble.length > 0, `'${bubble}'`);

// ให้ตัวละคร active มี pet จริง (ถ้ายังไม่มี — ฟักไข่ผ่าน API; มีแล้วข้าม) แล้วรีโหลดดูฟอง pet + Lv + อารมณ์
const activeId = db.prepare('SELECT active_character_id FROM settings WHERE id = 1').get()?.active_character_id;
if (activeId) {
  const hasPet = db.prepare('SELECT COUNT(*) AS n FROM pet WHERE character_id = ?').get(activeId).n > 0;
  if (!hasPet) {
    // ใช้ไข่ = เริ่มฟัก (ยังไม่ฟักทันที — รอจบ 1 session)
    db.prepare('INSERT OR IGNORE INTO inventory (character_id, item_id, qty) VALUES (?, 170, 1)').run(activeId);
    await fetch('http://127.0.0.1:3001/api/inventory/use', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: 170 }) });
    // ป้าย "🥚 กำลังฟัก" ขึ้นบน Home (ยังไม่มี pet จนกว่าจะจบ session)
    await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
    await sleep(1500);
    const hatchBadge = await evalJs(`document.querySelector('.hatch-badge')?.textContent?.trim() || ''`);
    const noPetYet = await evalJs(`!document.querySelector('.pet-lv-tag')`);
    expect('pet: ใช้ไข่แล้ว → ป้าย "🥚 กำลังฟัก" ขึ้นบน Home + ยังไม่มี pet', hatchBadge.includes('กำลังฟัก') && noPetYet, `badge='${hatchBadge}'`);
    // จบ 1 session → ไข่ฟัก
    await fetch('http://127.0.0.1:3001/api/adventure/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ focusSec: 1500, events: [] }) });
  }
  await send('Page.navigate', { url: 'http://127.0.0.1:3001/' });
  await sleep(2500);
  const petBubble = await evalJs(`document.querySelector('.companion-bubble')?.textContent?.trim() || ''`);
  const hasLvTag = await evalJs(`!!document.querySelector('.pet-lv-tag')`);
  const hasMood = await evalJs(`!!document.querySelector('.pet-mood-emoji')`);
  expect('pet: ฟอง pet แสดง pet + Lv + อารมณ์', petBubble.length > 0 && hasLvTag && hasMood,
    `bubble='${petBubble}' lv=${hasLvTag} mood=${hasMood}`);
}

// เปิดแท็บ CharacterSheet (ไอคอน 👥/แผ่นตัวละครบน Home)
await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('👥') || b.textContent.includes('จัดการตัวละคร'))?.click()`);
await sleep(1200);
// ถ้ายังไม่เจอแท็บ sheet → ลองหาแท็บ "ตัวละคร"
let hasStable = await evalJs(`document.body.innerText.includes('คอกสัตว์')`);
if (!hasStable) {
  await evalJs(`[...document.querySelectorAll('button')].find(b => /ตัวละคร|จัดการ/.test(b.textContent))?.click()`);
  await sleep(1000);
  hasStable = await evalJs(`document.body.innerText.includes('คอกสัตว์')`);
}
expect('CharacterSheet: มีคอกสัตว์ (pet stable)', hasStable, '');

// ข้อความคอก (ห้ามมี $ หลุด — bug: `${slots}` ใน JSX text กลายเป็น $1/$4)
const pTexts = (await evalJs(`[...document.querySelectorAll('p')].map(p => p.textContent.trim())`)) || [];
const stableHint = pTexts.find((t) => /คอก \d+\/\d+/.test(t)) || '';
const noDollar = !stableHint.includes('$');
const rightFmt = /คอก \d+\/\d+/.test(stableHint);
expect('pet: ข้อความคอก "คอก 1/4" ไม่มี $ หลุด', noDollar && rightFmt, `'${stableHint}'`);

// กดเปิดแท็บตัวละคร (CharacterSheet)
const hasPetPanel = await evalJs(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('จัดการตัวละคร')) || document.body.innerText.includes('ไอเทมในกระเป๋า')`);
console.log(`${hasPetPanel ? '✅' : 'ℹ️'} เปิดหน้าแผ่นตัวละครได้`, '');

chrome.kill();
console.log(`\nผลลัพธ์: ${pass} ผ่าน, ${fail} ตก`);
process.exit(fail > 0 ? 1 : 0);
